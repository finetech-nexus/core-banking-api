import { Router, Request, Response } from "express";

import { makeRequest } from "../middlewares/fineractRequest";
import { body, validationResult } from "express-validator";
import { getAdminAccessToken, getUserByEmail, getFineractAccessToken, updateUserContact } from "../services/keycloak-admin";
import axios from "axios";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import jwt from "jsonwebtoken";
import emailValidator from "@validators/email-exist-validator";
import registrationValidator from "../validators/registration-validator";
import resetPasswordValidator from "../validators/reset-password-validator";
import { partyRegistration } from '../services/paymentService';
import { assignIBAN , generateIBAN, createIBANTable} from '../services/assignIBAN';

import { getClient, getClients, updateClientContact } from "../services/fineractClient";
import { getAccounts, getTransactions, creditAccount, debitAccount, createSavingsAccountWithPolling, parseFineractDate, recordRejectedDebit } from "../services/fineractAccount";
import {
  applyAndPayChargeByName,
  attachMonthlyChargeByName,
  findChargeByName,
  listCharges,
} from "../services/fineractCharges";
import { cardLedgerNote, parseCardNote } from "../services/cardNote";
import { CARDS_DATATABLE, listDatatableRows } from "../services/clientDatatable";
import { logger } from "../logger";

export const route = Router();

const CARD_PAYMENT_TYPE_ID = process.env.CARD_PAYMENT_TYPE_ID || process.env.FINERACT_PAYMENT_TYPE_ID || "1";

async function findOwnedSavings(userId: string, savingsAccountId: string, tenantId: string) {
  const clients = await getClients(userId, tenantId);
  if (!Array.isArray(clients) || clients.length === 0) return null;
  for (const client of clients) {
    const accounts = await getAccounts(String(client.id), tenantId);
    const account = (accounts || []).find((a: any) => String(a.id) === String(savingsAccountId));
    if (account) return { client, account };
  }
  return null;
}

function isDebit(t: any): boolean {
  const type = t?.transactionType || {};
  if (type.withdrawal === true) return true;
  if (type.deposit === true) return false;
  const value = String(type.value || t?.entryType || "").toUpperCase();
  return value.includes("WITHDRAW") || value === "DEBIT";
}

function isRejectOffset(t: any): boolean {
  const raw = typeof t?.note === "string" ? t.note.trim() : "";
  if (!raw.startsWith("{")) return false;
  try {
    return JSON.parse(raw)?.type === "card-reject-offset";
  } catch {
    return false;
  }
}

function isHoldLine(t: any): boolean {
  const type = t?.transactionType || {};
  if (type.amountHold === true || type.amountRelease === true) return true;
  const id = Number(type.id);
  return id === 20 || id === 21;
}

/** Real card booking. The payer on these lines is the account IBAN, so the card is matched separately. */
function realCardMovement(raw: string): { merchant: string; last4?: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const kind = /payment|refund|void/i;
  if (!text.startsWith("{")) {
    if (!kind.test(text) || /sent from nexus/i.test(text)) return null;
    return { merchant: text };
  }
  try {
    const parsed = JSON.parse(text);
    if (String(parsed?.type || "").toLowerCase() === "card") return null;
    const note = String(parsed?.note || "").trim();
    const payee = String(parsed?.payee || "").trim();
    const blob = `${note} ${payee}`;
    if (!kind.test(blob) || /sent from nexus/i.test(blob)) return null;
    const payer = String(parsed?.payer || "").replace(/\s/g, "");
    const generic = /card payment|card refund|monétique|monetique/i.test(note);
    return {
      merchant: generic ? payee || note : note || payee,
      last4: /^\d{13,19}$/.test(payer) ? payer.slice(-4) : undefined,
    };
  } catch {
    return null;
  }
}

type CardUse = { amount: number; operation: string; merchant: string; used: boolean };

async function cardLast4(accountId: string, cardId: string, tenantId: string): Promise<string> {
  const rows = await listDatatableRows(CARDS_DATATABLE, Number(accountId), tenantId);
  const found = rows.find((row) => String(row.card_id || row.cardId || "") === cardId);
  return String(found?.last4 || "").replace(/\D/g, "").slice(-4);
}

/** Card operations recorded for this PAN tail. The clear PAN is not kept. */
async function cardUses(last4: string): Promise<CardUse[]> {
  if (!last4) return [];
  const base = String(process.env.MT_API_URL || "http://core-api-mt-api.api.svc.cluster.local").replace(/\/$/, "");
  try {
    const response = await axios.get(`${base}/api/transactions`, {
      params: { q: last4, size: 100, page: 0 },
      timeout: 4000,
      validateStatus: () => true,
    });
    const content = Array.isArray(response.data?.content) ? response.data.content : [];
    return content
      .filter((row: any) => String(row?.panToken || "").replace(/\D/g, "").endsWith(last4))
      .filter((row: any) => ["AUTHORIZE", "CAPTURE", "REFUND", "VOID"].includes(String(row?.operation || "").toUpperCase()))
      .map((row: any) => ({
        amount: Math.abs(Number(row.amount) || 0),
        operation: String(row.operation || "").toUpperCase(),
        merchant: String(row.merchantId || "").trim(),
        used: false,
      }));
  } catch (err: any) {
    logger.warn("Card operation lookup failed", { message: err?.message });
    return [];
  }
}

function claimUse(amount: number, credit: boolean, merchant: string, uses: CardUse[]): boolean {
  const text = merchant.toLowerCase();
  const hit = uses.find((use) => {
    if (use.used || Math.abs(use.amount - Math.abs(amount)) > 0.02) return false;
    const refund = use.operation === "REFUND";
    if (refund !== credit && use.operation !== "VOID") return false;
    if (use.merchant && text && !text.includes(use.merchant.toLowerCase())) {
      if (!/card payment|card refund|monétique|monetique/.test(text)) return false;
    }
    return true;
  });
  if (!hit) return false;
  hit.used = true;
  return true;
}

function transactionTitle(t: any): string {
  const note = typeof t?.note === "string" ? t.note.trim() : "";
  const reason = typeof t?.reasonForBlock === "string" ? t.reasonForBlock.trim() : "";
  const raw = note || reason;
  if (!raw) return String(t?.transactionType?.value || "Transaction");
  // Keep structured JSON notes intact so the app can show merchant + card last4 / FX meta.
  if (raw.startsWith("{")) return raw;
  return raw;
}



/**
 * @swagger
 * /:
 *   post:
 *     summary: Get account - get client info
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Successfully retrieved client info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Client information
 *       500:
 *         description: Could not create account
 */

route.get("/", keycloakProtect, async (req: any, res: Response) => {

    const tenantId = req.headers["fineract-platform-tenantid"];
    const auth = req.headers["authorization"];
    const userId = req.userInfo?.sub;
    if (!tenantId || !auth) {
      return res.status(400).json({ error: "Missing Fineract headers" });
    }
    logger.debug("GET /account", { userId, tenantId });
    try {
    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }
    // 2️. Fetch accounts + transactions for each client
    const results = await Promise.all(
      clients.map(async (client) => {
        const accounts: any[] = await getAccounts(client.id, tenantId)
        const accountsWithTransactions = await Promise.all(
          accounts.map(async (account: any) => {
            // Fetch last 5 transactions
            const transactions: any[] = await getTransactions(account.id)
             
            const last = transactions.filter((t: any) => !isRejectOffset(t)).map((t: any) => ({
              id: t.id,
              amount: t.amount,
              date: t.date,
              title: transactionTitle(t),
              transactionType: t.transactionType?.value || "Transaction",
              entryType: t.entryType || (isDebit(t) ? "DEBIT" : "CREDIT"),
              currency: t.currency.code,
              country: t.locale || "FR",
              reversed: t.reversed,
              amountHold: t.transactionType?.amountHold || false,
              amountRelease: t.transactionType?.amountRelease || false,
              releaseTransactionId: t.releaseTransactionId || null,
            }));

            return {
              id: account.id,
              name: account.accountNo,
              balance: account.accountBalance || 0,
              currency: account.currency.code,
              externalId: account.externalId, // IBAN or identifier
              swift: process.env.SWIFT_BIC,
              transactions: last,
            };
          })
        );

        return {
          clientId: client.id,
          clientName: client.displayName || client.accountNo || "Unnamed Client",
          clientType: client.clientType || "PERSON",
          accounts: accountsWithTransactions,
        };
      })
    );
    logger.debug("Account results", { clientCount: results?.length });
    return res.json(results);
  } catch (err: any) {
    logger.error("GET /account failed", { userId, tenantId });
    return res.status(500).json({
      error: "Could not fetch /accounts",
      details: err.message,
    });
  }
});

/**
 * PATCH /profile — update phone/email on tenant Keycloak and Fineract client
 * (looked up by JWT sub as Fineract externalId).
 */
route.patch("/profile", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : undefined;
  const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone.trim() : undefined;

  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  if (!userId) {
    return res.status(401).json({ error: "invalid user from token" });
  }
  if (!emailRaw && !phoneRaw) {
    return res.status(400).json({ error: "email or phone is required" });
  }

  logger.debug("PATCH /account/profile", { userId, tenantId, hasEmail: !!emailRaw, hasPhone: !!phoneRaw });

  try {
    try {
      await updateUserContact(userId, { email: emailRaw, phone: phoneRaw });
    } catch (kcErr: any) {
      const status = kcErr?.response?.status;
      if (status === 404) {
        logger.warn("Tenant Keycloak user not found for profile update", { userId, tenantId });
      } else {
        throw kcErr;
      }
    }

    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const updated = await Promise.all(
      clients.map(async (client: any) => {
        const firstname =
          client.firstname ||
          String(client.displayName || "").split(/\s+/)[0] ||
          "Client";
        const lastname =
          client.lastname ||
          String(client.displayName || "").split(/\s+/).slice(1).join(" ") ||
          "User";
        await updateClientContact(
          client.id,
          {
            firstname,
            lastname,
            email: emailRaw,
            phone: phoneRaw,
          },
          tenantId
        );
        return { clientId: client.id };
      })
    );

    return res.json({ ok: true, clients: updated });
  } catch (err: any) {
    logger.error("PATCH /account/profile failed", {
      userId,
      tenantId,
      message: err?.message,
      details: err?.response?.data || err?.message,
    });
    return res.status(500).json({
      error: "Could not update profile",
      details: err?.response?.data || err?.message,
    });
  }
});


 route.post("/", keycloakProtect, async (req: any, res: Response) => {

    const tenantId = req.headers["fineract-platform-tenantid"];
    const auth = req.headers["authorization"];
    const userId = req.userInfo?.sub;
    const {productId} = req.body;
    if (!tenantId || !auth) {
      return res.status(400).json({ error: "Missing Fineract headers" });
    }
    logger.debug("POST /account", { productId, userId, tenantId });
    try {
    // 1.getClients
    const clients =  await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length !== 1) {
      return res.status(404).json({ error: "Client not found" });
    }
    // 2️. Fetch products 
    //const products: Record<string, string> = JSON.parse(process.env.SAVING_PRODUCTS!);
    // if (!products[currency]) {
     // console.log("Product not found for currency " + currency)
    // return res.status(404).json({ error: "Product not found for currency" });
    //}
     // 2. get Fineract token 
    const token = await getFineractAccessToken(); 
    let authToken = 'Bearer ' + token;
     // 3. Generate virtual IBAN (you can use bank code as needed)
    const virtualIBAN = generateIBAN('');
    // 4. create Account
    const account = await createSavingsAccountWithPolling(clients[0].id, productId,virtualIBAN, authToken,  tenantId);
    // 5.PartyRegistration 
    //MSISDN, EMAIL, PERSONAL_ID, BUSINESS, DEVICE, ACCOUNT_ID, IBAN, ALIAS;
    const accountId = account.id;
    const accountNo = account.accountNo
    await partyRegistration(accountNo, 'IBAN', virtualIBAN , tenantId);
    await partyRegistration(accountNo, "EMAIL", clients[0].emailAddress, tenantId);
    //await partyRegistration(accountNo, "MSISDN", clients[0].??, tenantId)

    return res.json(account);
  } catch (err: any) {
    logger.error("GET /account failed", { userId, tenantId });
    return res.status(500).json({
      error: "Could not post /accounts",
      details: err.message,
    });
  }
});

route.post("/deposit", async (req: any, res: Response) => {//TODO add security
  const tenantId = req.headers["fineract-platform-tenantid"];
  const auth = req.headers["authorization"];
  //const userId = req.userInfo?.sub;
  const { savingsAccountId, amount, note, clientId , paymentTypeId, receiptNumber} = req.body;

  if (!tenantId  ) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }

  if (!savingsAccountId || !amount || amount <= 0) {
    return res.status(400).json({ error: "Missing or invalid accountId/amount" });
  }
 
  try {
    // 1️⃣ Get clients associated with user
    const client = await getClient(clientId, tenantId);
    logger.debug("Client found", { clientId: client?.id });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // 2️⃣ Optionally verify the savings account belongs to this client
    const accounts = await getAccounts(clientId.toString(), tenantId);
    const account = accounts.find((a: any) => a.id.toString() === savingsAccountId);
    if (!account) {
      return res.status(404).json({ error: "Savings account not found for client" });
    }
 
    // 3️⃣ Credit the savings account
    const creditResponse = await creditAccount(savingsAccountId, account.accountNo , paymentTypeId, receiptNumber, amount,note, tenantId, clientId);
    logger.info("Credit success", { savingsAccountId });

    res.status(200).json({
      message: "Account credited successfully",
      data: creditResponse,
    });
  } catch (err: any) {
    logger.error("Transaction error", { error: err?.message || err });
    res.status(500).json({ error: "Transaction failed" });
  }
});

/**
 * Debit a savings account for a card authorization.
 * Note stores cardId so home + card history can attribute the spend to card 1 vs card 2.
 */
route.post("/card-spend", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const savingsAccountId = String(req.body?.savingsAccountId || req.body?.accountId || "").trim();
  const amount = Math.abs(Number(req.body?.amount));
  const merchant = String(req.body?.merchant || "").trim();
  const cardId = String(req.body?.cardId || "").trim();
  const last4 = String(req.body?.last4 || "").replace(/\D/g, "").slice(-4);
  const scheme = String(req.body?.scheme || "").trim();
  const authId = String(req.body?.authId || req.body?.receiptNumber || "").trim();
  const paymentTypeId = String(req.body?.paymentTypeId || CARD_PAYMENT_TYPE_ID);

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!savingsAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "savingsAccountId and amount are required" });
  }
  if (!cardId || !merchant) {
    return res.status(400).json({ error: "cardId and merchant are required" });
  }

  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const receipt = authId || `card-${cardId.slice(0, 8)}-${Date.now()}`;
    const note = cardLedgerNote({ cardId, last4, scheme, merchant, authId: receipt });
    const data = await debitAccount(
      savingsAccountId,
      owned.account.accountNo,
      paymentTypeId,
      receipt,
      amount,
      note,
      tenantId
    );
    return res.status(201).json({
      ok: true,
      savingsAccountId,
      cardId,
      amount,
      receiptNumber: receipt,
      note,
      data,
    });
  } catch (err: any) {
    logger.error("POST /account/card-spend failed", { message: err?.message });
    return res.status(500).json({ error: "Card spend failed", details: err?.message });
  }
});

/**
 * Records a card debit that could not be taken, then marks it undone.
 * The balance is unchanged and the line stays visible, barred, in the transaction list.
 */
/** The card stores the savings id. Interop is registered on the account IBAN, kept as externalId. */
route.get("/internal/savings/:id", async (req: any, res: Response) => {
  const tenantId = String(req.headers["fineract-platform-tenantid"] || process.env.FINERACT_TENANT || "tn");
  const accountId = String(req.params.id || "").trim();
  if (!accountId) return res.status(400).json({ error: "accountId is required" });
  try {
    const token = await getFineractAccessToken();
    const account = await makeRequest({
      method: "GET",
      endpoint: `/savingsaccounts/${encodeURIComponent(accountId)}`,
      auth: `Bearer ${token}`,
      tenant: tenantId,
    });
    if ((account as any)?.error || !(account as any)?.accountNo) {
      return res.status(404).json({ error: "Savings account not found" });
    }
    return res.json({
      id: (account as any).id,
      accountNo: String((account as any).accountNo),
      externalId: (account as any).externalId ? String((account as any).externalId) : "",
    });
  } catch (err: any) {
    logger.error("GET /account/internal/savings failed", { message: err?.message });
    return res.status(500).json({ error: "Savings account was not read" });
  }
});

route.post("/internal/rejected-debit", async (req: any, res: Response) => {
  const tenantId = String(req.headers["fineract-platform-tenantid"] || process.env.FINERACT_TENANT || "tn");
  const accountId = String(req.body?.accountId || "").trim();
  const amount = Math.abs(Number(req.body?.amount));
  const merchant = String(req.body?.merchant || "Card payment").trim();
  const reference = String(req.body?.reference || req.body?.clientReference || req.body?.transactionId || "").trim();
  const cardId = String(req.body?.cardId || "card").trim();
  const last4 = String(req.body?.last4 || "").replace(/\D/g, "").slice(-4);
  if (!accountId || !reference || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "accountId, reference and amount are required" });
  }
  try {
    const note = cardLedgerNote({ cardId, last4, merchant, authId: reference });
    const data = await recordRejectedDebit(accountId, amount, note, reference, tenantId);
    return res.status(201).json({ ok: true, ...data });
  } catch (err: any) {
    logger.error("POST /account/internal/rejected-debit failed", { message: err?.message });
    return res.status(500).json({ error: "Rejected debit was not recorded", details: err?.message });
  }
});

/** Account ledger for card history filters (`cardId` optional). */
route.get("/transactions", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const accountId = String(req.query.accountId || req.query.savingsAccountId || "").trim();
  const cardId = String(req.query.cardId || "").trim();
  const last4 = String(req.query.last4 || "").replace(/\D/g, "").slice(-4);

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!accountId) return res.status(400).json({ error: "accountId is required" });

  try {
    const owned = await findOwnedSavings(userId, accountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const raw = await getTransactions(accountId, tenantId);
    const tail = cardId ? (await cardLast4(accountId, cardId, tenantId)) || last4 : "";
    const uses = cardId ? await cardUses(tail) : [];
    const transactions = (Array.isArray(raw) ? raw : [])
      .filter((t: any) => !isRejectOffset(t))
      .filter((t: any) => !cardId || !isHoldLine(t))
      .filter((t: any) => !t?.reversed || parseCardNote(typeof t?.note === "string" ? t.note : ""))
      .map((t: any) => {
        const note = typeof t?.note === "string" ? t.note : "";
        const card = parseCardNote(note);
        const real = card ? null : realCardMovement(note);
        const synthetic = Boolean(card?.authId && String(card.authId).startsWith("card-"));
        const debit = isDebit(t);
        const amountAbs = Math.abs(Number(t.amount) || 0);
        const date = parseFineractDate(t.date) || parseFineractDate(t.submittedOnDate) || new Date();
        return {
          id: String(t.id),
          amount: debit ? -amountAbs : amountAbs,
          currency: t?.currency?.code || owned.account?.currency?.code,
          date: date.toISOString(),
          title: real?.merchant || transactionTitle(t),
          note,
          cardId: card?.cardId || null,
          last4: card?.last4 || real?.last4 || null,
          merchant: real?.merchant || card?.merchant || null,
          synthetic,
          receiptNumber: t?.paymentDetailData?.receiptNumber || card?.authId || null,
          transactionType: t?.transactionType?.value || (debit ? "Debit" : "Credit"),
          entryType: t?.entryType,
          reversed: Boolean(t?.reversed),
        };
      })
      .filter((t: any) => {
        if (!cardId) return true;
        if (t.synthetic) return false;
        if (t.cardId) return t.cardId === cardId;
        if (tail && t.last4 && t.last4 === tail) return true;
        if (!t.merchant) return false;
        return claimUse(Number(t.amount) || 0, Number(t.amount) > 0, String(t.merchant), uses);
      })
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
    return res.json({ accountId, cardId: cardId || null, transactions });
  } catch (err: any) {
    logger.error("GET /account/transactions failed", { message: err?.message });
    return res.status(500).json({ error: "Could not fetch transactions", details: err?.message });
  }
});

/**
 * List Fineract charge definitions (admin token via core banking).
 * Optional ?name= exact match.
 */
route.get("/charges", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  try {
    const name = String(req.query.name || "").trim();
    if (name) {
      const charge = await findChargeByName(name, tenantId);
      return res.json({ charge });
    }
    const charges = await listCharges(tenantId);
    return res.json({ charges });
  } catch (err: any) {
    logger.error("GET /account/charges failed", { message: err?.message });
    return res.status(500).json({ error: "Could not list charges", details: err?.message });
  }
});

/**
 * Read-only charge catalog for Product Studio selectors (no customer data).
 * Uses Fineract admin token; optional ?tenant=&currency=&kind=ONE_SHOT|RECURRENT
 */
route.get("/charges/catalog", async (req: any, res: Response) => {
  const tenantId = String(
    req.headers["fineract-platform-tenantid"] || req.query.tenant || process.env.FINERACT_TENANT || "default"
  ).trim();
  const currency = String(req.query.currency || "").trim().toUpperCase();
  const kind = String(req.query.kind || "").trim().toUpperCase();
  try {
    const charges = await listCharges(tenantId);
    const mapped = (charges || [])
      .filter((c) => c && c.active !== false && c.name)
      .map((c) => {
        const timeId = Number((c as any).chargeTimeType?.id ?? (c as any).chargeTimeType ?? 0);
        const chargeKind = timeId === 7 ? "RECURRENT" : timeId === 2 ? "INSTALLMENT" : "OTHER";
        const code = String((c as any).currency?.code || (c as any).currencyCode || "").toUpperCase();
        const feeIntervalRaw = Number((c as any).feeInterval);
        const feeInterval =
          Number.isFinite(feeIntervalRaw) && feeIntervalRaw > 0
            ? Math.floor(feeIntervalRaw)
            : chargeKind === "RECURRENT"
              ? 1
              : undefined;
        const period =
          feeInterval === 12 ? "ANNUAL" : feeInterval === 3 ? "QUARTERLY" : feeInterval === 1 ? "MONTHLY" : undefined;
        return {
          id: c.id,
          name: c.name,
          currencyCode: code || undefined,
          chargeTimeType: timeId || undefined,
          kind: chargeKind,
          amount: c.amount,
          feeInterval,
          period,
        };
      })
      .filter((c) => !currency || !c.currencyCode || c.currencyCode === currency)
      .filter(
        (c) =>
          !kind ||
          c.kind === kind ||
          ((kind === "FEE" || kind === "ONE_SHOT") && c.kind === "INSTALLMENT") ||
          (kind === "BANK" && (c.kind === "INSTALLMENT" || c.kind === "RECURRENT"))
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return res.json({ tenant: tenantId, charges: mapped });
  } catch (err: any) {
    logger.error("GET /account/charges/catalog failed", { message: err?.message });
    return res.status(500).json({ error: "Could not list charge catalog", details: err?.message });
  }
});

/**
 * Book a one-shot fee on the customer's savings account (apply + pay Fineract charge).
 * Body: { savingsAccountId, chargeName, amount? }
 * Commercial amount usually comes from produit-api; chargeName is the Fineract definition.
 */
route.post("/charges/apply-and-pay", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const savingsAccountId = String(req.body?.savingsAccountId || req.body?.accountId || "").trim();
  const chargeName = String(req.body?.chargeName || "").trim();
  const amountRaw = req.body?.amount;
  const amount =
    amountRaw === undefined || amountRaw === null || amountRaw === ""
      ? undefined
      : Math.abs(Number(amountRaw));
  const cardId = String(req.body?.cardId || "").trim();
  const last4 = String(req.body?.last4 || "").replace(/\D/g, "").slice(-4);
  const scheme = String(req.body?.scheme || "").trim();
  const merchant = String(req.body?.merchant || chargeName || "Fee").trim();

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!savingsAccountId || !chargeName) {
    return res.status(400).json({ error: "savingsAccountId and chargeName are required" });
  }
  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    return res.status(400).json({ error: "amount must be a non-negative number" });
  }
  if (amount === 0) {
    return res.status(200).json({ ok: true, skipped: true, reason: "zero_amount" });
  }

  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const note = cardId
      ? cardLedgerNote({ cardId, last4, scheme, merchant })
      : req.body?.note
        ? String(req.body.note)
        : merchant
          ? JSON.stringify({ type: "fee", payee: merchant, merchant, note: merchant })
          : undefined;
    const result = await applyAndPayChargeByName({
      savingsAccountId,
      chargeName,
      amount,
      note,
      tenant: tenantId,
    });
    return res.status(201).json({ ok: true, ...result });
  } catch (err: any) {
    logger.error("POST /account/charges/apply-and-pay failed", { message: err?.message });
    return res.status(500).json({ error: "Charge booking failed", details: err?.message });
  }
});

/**
 * Attach a recurring Fineract charge. Body: { savingsAccountId, chargeName, amount?, feeInterval?, period? }
 * period: MONTHLY|QUARTERLY|ANNUAL (maps to feeInterval 1|3|12).
 */
route.post("/charges/attach-monthly", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const savingsAccountId = String(req.body?.savingsAccountId || req.body?.accountId || "").trim();
  const chargeName = String(req.body?.chargeName || "").trim();
  const amountRaw = req.body?.amount;
  const amount =
    amountRaw === undefined || amountRaw === null || amountRaw === ""
      ? undefined
      : Math.abs(Number(amountRaw));
  const period = String(req.body?.period || req.body?.recurrentFeePeriod || "").toUpperCase();
  const feeIntervalFromPeriod =
    period === "ANNUAL" || period === "YEARLY" ? 12 : period === "QUARTERLY" ? 3 : period === "MONTHLY" ? 1 : 0;
  const feeIntervalRaw = Number(req.body?.feeInterval);
  const feeInterval =
    Number.isFinite(feeIntervalRaw) && feeIntervalRaw > 0
      ? Math.max(1, Math.min(12, Math.floor(feeIntervalRaw)))
      : feeIntervalFromPeriod || 1;
  const cardId = String(req.body?.cardId || "").trim();
  const last4 = String(req.body?.last4 || "").replace(/\D/g, "").slice(-4);
  const scheme = String(req.body?.scheme || "").trim();
  const merchant = String(req.body?.merchant || chargeName || "Recurrent fee").trim();

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!savingsAccountId || !chargeName) {
    return res.status(400).json({ error: "savingsAccountId and chargeName are required" });
  }

  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const note = cardId
      ? cardLedgerNote({ cardId, last4, scheme, merchant })
      : req.body?.note
        ? String(req.body.note)
        : merchant
          ? JSON.stringify({ type: "fee", payee: merchant, merchant, note: merchant })
          : undefined;
    const result = await attachMonthlyChargeByName({
      savingsAccountId,
      chargeName,
      amount,
      note,
      feeInterval,
      tenant: tenantId,
    });
    return res.status(201).json({ ok: true, feeInterval, period: period || undefined, ...result });
  } catch (err: any) {
    logger.error("POST /account/charges/attach-monthly failed", { message: err?.message });
    return res.status(500).json({ error: "Recurrent charge attach failed", details: err?.message });
  }
});


