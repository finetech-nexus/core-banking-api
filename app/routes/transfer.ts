import { Router, Request, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { channelRequest } from "../middlewares/channelRequest";
import { logger } from "../logger";
import { getClients } from "../services/fineractClient";
import { getAccounts } from "../services/fineractAccount";
import {
  TRANSFERS_DATATABLE,
  insertDatatableRow,
  listDatatableRowsForUser,
  resolveOwnedAccountId,
  rowId,
} from "../services/clientDatatable";
import { transferGlobal } from "../services/paymentPlafond";
import { beneficiaryObjectId, fineractClientIdForUser, notifyTransaction } from "../services/marbleNotify";

export const route = Router();

function compactId(value: unknown): string {
  return String(value || "").replace(/\s/g, "").toUpperCase();
}

/** First two digits of a Tunisian RIB. IBAN form is TN + 2 check digits + that RIB. */
function tunisianBankCode(value: unknown): string | undefined {
  const compact = compactId(value);
  return compact.startsWith("TN") && compact.length === 24 ? compact.slice(4, 6) : undefined;
}

/** Local Tunisian bank transfers clear on SIBTEL. International transfers use SWIFT. Nexus-to-Nexus stays on Fineract. */
function paymentScheme(req: Request): string | undefined {
  const header = String(req.headers["x-payment-scheme"] || "").trim().toLowerCase();
  if (header === "sibtel" || header === "swift" || header === "mt") return header;
  const body = req.body || {};
  const explicit = String(body.paymentScheme || body.transferType || "").trim().toLowerCase();
  if (explicit === "sibtel" || explicit === "bank" || explicit === "local") return "sibtel";
  if (explicit === "swift" || explicit === "international") return "swift";
  if (explicit === "mt" || explicit === "card") return "mt";
  const payerBank = tunisianBankCode(body.payer?.partyIdInfo?.partyIdentifier);
  const payeeBank = tunisianBankCode(body.payee?.partyIdInfo?.partyIdentifier);
  if (payerBank && payeeBank && payerBank !== payeeBank) return "sibtel";
  return undefined;
}

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

async function accountIdForTransfer(userId: string, tenantId: string, body: any): Promise<number | null> {
  const explicit = await resolveOwnedAccountId(userId, tenantId, body?.accountId ?? body?.savingsAccountId);
  if (explicit != null) return explicit;
  const iban = compactId(body?.payer?.partyIdInfo?.partyIdentifier || body?.clientRefId);
  if (!iban) return null;
  const clients = await getClients(userId, tenantId);
  if (!Array.isArray(clients) || clients.length !== 1) return null;
  const accounts = await getAccounts(String(clients[0].id), tenantId);
  const match = (Array.isArray(accounts) ? accounts : []).find(
    (account: any) => compactId(account?.externalId) === iban
  );
  const id = Number(match?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function mapTransferRow(row: Record<string, unknown>, tenantId: string, accountId: number) {
  return {
    id: String(rowId(row) ?? ""),
    createdAt: String(row.createdAt || ""),
    amount: String(row.amount ?? ""),
    currency: String(row.currency || ""),
    motif: String(row.motif || ""),
    status: String(row.status || "success"),
    contactName: String(row.contactName || ""),
    contactMeta: row.contactMeta ? String(row.contactMeta) : undefined,
    contactId: row.contactId ? String(row.contactId) : undefined,
    transferType: row.transferType ? String(row.transferType) : undefined,
    tenantId,
    accountId: String(accountId),
  };
}

/** Best-effort: a failed history write must not fail the transfer itself. */
async function recordTransferHistory(req: any, tenantId: string) {
  const userId = req.userInfo?.sub;
  if (!userId) return;
  const body = req.body || {};
  const accountId = await accountIdForTransfer(userId, tenantId, body);
  if (accountId == null) {
    logger.warn("Transfer history skipped, account not resolved", { userId, tenantId });
    return;
  }
  const payee = body.payee?.partyIdInfo || {};
  const amount = body.amount || {};
  const payload = Object.fromEntries(
    Object.entries({
      contactName: clip(payee.partySubIdOrType, 120),
      contactMeta: clip(payee.partyIdentifier, 80),
      contactId: clip(body.contactId, 64),
      amount: clip(amount.amount, 32),
      currency: clip(amount.currency, 8),
      motif: clip(body.note, 160),
      transferType: clip(body.transferType || body.paymentScheme, 40),
      createdAt: new Date().toISOString(),
      status: "success",
    }).filter(([, value]) => value !== "")
  );
  const saved = await insertDatatableRow(TRANSFERS_DATATABLE, accountId, tenantId, payload);
  if ((saved as any)?.error) {
    logger.error("Transfer history insert failed", { message: (saved as any).message });
  }
}

function transferObjectId(response: unknown, body: any): string {
  const source = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const id = source.transactionId || source.transferId || source.resourceId || source.id;
  if (id != null && String(id).trim()) return `transfer:${String(id).trim()}`;
  const payer = body?.payer?.partyIdInfo?.partyIdentifier || "payer";
  const payee = body?.payee?.partyIdInfo?.partyIdentifier || "payee";
  return `transfer:${payer}:${payee}:${body?.amount?.amount}:${Date.now()}`;
}

/** Best-effort: Marble monitoring must not fail the transfer. */
async function notifyTransfer(req: any, tenantId: string, response: unknown) {
  const userId = req.userInfo?.sub;
  if (!userId) return;
  const body = req.body || {};
  const rawAmount = body?.amount;
  const amount = Number(rawAmount && typeof rawAmount === "object" ? rawAmount.amount : rawAmount);
  const customerId = await fineractClientIdForUser(userId, tenantId);
  const accountId = await accountIdForTransfer(userId, tenantId, body);
  const contactId = body.contactId ? String(body.contactId).trim() : "";
  const payee = body.payee?.partyIdInfo || {};
  await notifyTransaction({
    objectId: transferObjectId(response, body),
    direction: "out",
    amount,
    currency: body?.amount?.currency,
    country: payee.country || body.country,
    customerId: customerId || undefined,
    accountId: accountId ?? undefined,
    counterpartyName: payee.partySubIdOrType,
    counterpartyId: contactId ? beneficiaryObjectId(accountId ?? undefined, contactId) : undefined,
    transactionType: body.transferType || body.paymentScheme || paymentScheme(req),
    channel: paymentScheme(req) || "app",
    paymentReference: body.note,
    status: "booked",
    occurredAt: new Date().toISOString(),
  });
}

/**
 * @swagger
 * components:
 *   schemas:
 *     TransferRequest:
 *       type: object
 *       required:
 *         - fromAccountId
 *         - toAccountId
 *         - amount
 *       properties:
 *         fromAccountId:
 *           type: string
 *           description: Source account ID
 *         toAccountId:
 *           type: string
 *           description: Destination account ID
 *         amount:
 *           type: number
 *           description: Amount to transfer
 *         note:
 *           type: string
 *           description: Optional note for the transfer
 *
 *     TransferResponse:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           description: The ID of the transfer transaction
 *         status:
 *           type: string
 *           description: Status of the transfer (e.g., SUCCESS, FAILED)
 *         message:
 *           type: string
 *           description: Optional message
 */

/**
 * @swagger
 * /transfers:
 *   post:
 *     summary: Make a transfer between accounts
 *     tags:
 *       - Transfers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: Transfer details
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransferRequest'
 *     responses:
 *       200:
 *         description: Transfer successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferResponse'
 *       401:
 *         description: Unauthorized (invalid or missing token)
 *       500:
 *         description: Transfer failed due to server error
 */
/*
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  try {
    const tenantId = req.headers['Fineract-Platform-TenantId'];
    const auth = req.headers['Authorization'];
    const response = await makeRequest({method:'POST', endpoint:'/self/accounttransfers?type="tpt"', data: req.body, auth: auth, tenant: tenantId});
    res.json(response);
  } catch (err) {
    return res.status(500).json({ error: "Transfer failed" });
  }
});*/
route.get("/history", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  try {
    const rows = await listDatatableRowsForUser(
      TRANSFERS_DATATABLE,
      userId,
      tenantId,
      req.query.accountId ?? req.query.savingsAccountId
    );
    const transfers = rows
      .map((row) => mapTransferRow(row, tenantId, row._accountId))
      .filter((item) => item.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ transfers });
  } catch (err) {
    logger.error("GET /transfer/history failed", { error: err });
    return res.status(500).json({ error: "Failed to list transfers" });
  }
});

route.post("/request", keycloakProtect, async (req: any, res: Response) => {

    const tenantId = req.headers["fineract-platform-tenantid"];

    logger.debug("POST /transfer/request", { body: req.body });
    const auth = req.headers["authorization"];
    if (!tenantId) {
      return res.status(400).json({ error: "Missing Fineract headers" });
    }
    const scheme = paymentScheme(req);
    if (scheme === "sibtel" && req.body?.amount && typeof req.body.amount === "object") {
      req.body.amount.currency = "TND";
    }
    const transferAmount = Number(req.body?.amount?.amount);
    const transferCurrency = String(req.body?.amount?.currency || "").trim().toUpperCase();
    if (transferCurrency && Number.isFinite(transferAmount)) {
      try {
        const cap = await transferGlobal(transferCurrency);
        if (cap != null && transferAmount > cap) {
          return res.status(400).json({
            error: `Transfer exceeds the ${transferCurrency} plafond of ${cap}`,
          });
        }
      } catch (err) {
        logger.error("Transfer plafond lookup failed", { error: err });
        return res.status(503).json({ error: "Transfer plafond is unavailable" });
      }
    }
    const { accountId: _accountId, savingsAccountId: _savingsAccountId, contactId: _contactId, ...channelBody } = req.body || {};
    const headers: Record<string, string> = {};
    if (scheme) headers["X-Payment-Scheme"] = scheme;
    if (scheme === "sibtel") headers["X-PayeeDFSP-ID"] = "sibtel";
    try {
      const response = await channelRequest({
        method:'POST',
        endpoint:'/channel/transfer',
        data: channelBody,
        auth: auth,
        tenant: tenantId,
        headers,
      });
      if (response && typeof response === "object" && (response as { error?: boolean }).error) {
        const failed = response as { status?: number; message?: unknown };
        return res.status(failed.status || 500).json({ error: "Failed request transfer", details: failed.message });
      }
      try {
        await recordTransferHistory(req, tenantId);
      } catch (err) {
        logger.error("Transfer history not saved", { error: err });
      }
      try {
        await notifyTransfer(req, tenantId, response);
      } catch (err) {
        logger.error("Marble transfer notify failed", { error: err });
      }
      return res.json(response);
    } catch (err) {
      logger.error("Error transfer request", { error: err });
      if (res.headersSent) return;
      return res.status(500).json({ error: "Failed request transfer" });
    }

 
});