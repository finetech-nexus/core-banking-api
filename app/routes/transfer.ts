import { Router, Request, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { channelRequest } from "../middlewares/channelRequest";
import { logger } from "../logger";
import { transferGlobal } from "../services/paymentPlafond";

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
    const headers: Record<string, string> = {};
    if (scheme) headers["X-Payment-Scheme"] = scheme;
    if (scheme === "sibtel") headers["X-PayeeDFSP-ID"] = "sibtel";
    try {
      const response = await channelRequest({
        method:'POST',
        endpoint:'/channel/transfer',
        data: req.body,
        auth: auth,
        tenant: tenantId,
        headers,
      });
      if (response && typeof response === "object" && (response as { error?: boolean }).error) {
        const failed = response as { status?: number; message?: unknown };
        return res.status(failed.status || 500).json({ error: "Failed request transfer", details: failed.message });
      }
      return res.json(response);
    } catch (err) {
      logger.error("Error transfer request", { error: err });
      if (res.headersSent) return;
      return res.status(500).json({ error: "Failed request transfer" });
    }

 
});