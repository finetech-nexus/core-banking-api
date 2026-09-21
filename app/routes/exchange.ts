import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { getClients } from "../services/fineractClient";
import { creditAccount, debitAccount, getAccounts } from "../services/fineractAccount";
import { getQuoteRate, roundMoney } from "../services/exchangeRate";
import { logger } from "../logger";

export const route = Router();

const PAYMENT_TYPE_ID = process.env.FINERACT_PAYMENT_TYPE_ID || "1";

async function findOwnedSavings(userId: string, savingsAccountId: string, tenantId: string) {
  const clients = await getClients(userId, tenantId);
  if (!Array.isArray(clients) || clients.length === 0) return null;
  for (const client of clients) {
    const accounts = await getAccounts(String(client.id), tenantId);
    const account = (accounts || []).find((a: any) => String(a.id) === String(savingsAccountId));
    if (account) {
      return { client, account };
    }
  }
  return null;
}

route.get("/rate", keycloakProtect, async (req: any, res: Response) => {
  const from = String(req.query.from || req.query.fromCurrency || "").toUpperCase();
  const to = String(req.query.to || req.query.toCurrency || "").toUpperCase();
  if (!from || !to) {
    return res.status(400).json({ error: "from and to currencies are required" });
  }
  const rate = getQuoteRate(from, to);
  if (!rate) {
    return res.status(404).json({ error: "No rate for currency pair", from, to });
  }
  return res.json({
    from,
    to,
    rate,
    quotedAt: new Date().toISOString(),
  });
});

route.post("/debit", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const savingsAccountId = String(req.body?.savingsAccountId || "");
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "Currency exchange debit");

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!savingsAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "savingsAccountId and amount are required" });
  }

  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const receipt = `fx-out-${Date.now()}`;
    const data = await debitAccount(
      savingsAccountId,
      owned.account.accountNo,
      PAYMENT_TYPE_ID,
      receipt,
      roundMoney(amount),
      note,
      tenantId
    );
    return res.json({ ok: true, savingsAccountId, amount: roundMoney(amount), data });
  } catch (err: any) {
    logger.error("POST /exchange/debit failed", { message: err?.message });
    return res.status(500).json({ error: "Exchange debit failed", details: err?.message });
  }
});

route.post("/credit", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const savingsAccountId = String(req.body?.savingsAccountId || "");
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "Currency exchange credit");

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!savingsAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "savingsAccountId and amount are required" });
  }

  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const receipt = `fx-in-${Date.now()}`;
    const data = await creditAccount(
      savingsAccountId,
      owned.account.accountNo,
      PAYMENT_TYPE_ID,
      receipt,
      roundMoney(amount),
      note,
      tenantId
    );
    return res.json({ ok: true, savingsAccountId, amount: roundMoney(amount), data });
  } catch (err: any) {
    logger.error("POST /exchange/credit failed", { message: err?.message });
    return res.status(500).json({ error: "Exchange credit failed", details: err?.message });
  }
});

route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const fromAccountId = String(req.body?.fromAccountId || "");
  const toAccountId = String(req.body?.toAccountId || "");
  const amount = Number(req.body?.amount);
  const fromCurrency = String(req.body?.fromCurrency || "").toUpperCase();
  const toCurrency = String(req.body?.toCurrency || "").toUpperCase();

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!fromAccountId || !toAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "fromAccountId, toAccountId and amount are required" });
  }
  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: "Choose two different accounts" });
  }

  const fromOwned = await findOwnedSavings(userId, fromAccountId, tenantId);
  const toOwned = await findOwnedSavings(userId, toAccountId, tenantId);
  if (!fromOwned || !toOwned) {
    return res.status(404).json({ error: "Account not found on this tenant" });
  }

  const fromCode = fromCurrency || fromOwned.account.currency?.code || fromOwned.account.currency;
  const toCode = toCurrency || toOwned.account.currency?.code || toOwned.account.currency;
  const rate = Number(req.body?.rate) || getQuoteRate(String(fromCode), String(toCode));
  if (!rate) {
    return res.status(404).json({ error: "No rate for currency pair" });
  }
  const converted = roundMoney(amount * rate);
  const debitAmount = roundMoney(amount);

  try {
    const outReceipt = `fx-${Date.now()}-out`;
    const inReceipt = `fx-${Date.now()}-in`;
    const debit = await debitAccount(
      fromAccountId,
      fromOwned.account.accountNo,
      PAYMENT_TYPE_ID,
      outReceipt,
      debitAmount,
      `FX to ${toAccountId}`,
      tenantId
    );
    try {
      const credit = await creditAccount(
        toAccountId,
        toOwned.account.accountNo,
        PAYMENT_TYPE_ID,
        inReceipt,
        converted,
        `FX from ${fromAccountId}`,
        tenantId
      );
      return res.json({
        ok: true,
        fromAccountId,
        toAccountId,
        fromAmount: debitAmount,
        toAmount: converted,
        rate,
        debit,
        credit,
      });
    } catch (creditErr: any) {
      logger.error("FX credit failed, reversing debit", { message: creditErr?.message });
      try {
        await creditAccount(
          fromAccountId,
          fromOwned.account.accountNo,
          PAYMENT_TYPE_ID,
          `${outReceipt}-rev`,
          debitAmount,
          "FX reversal",
          tenantId
        );
      } catch (revErr: any) {
        logger.error("FX reversal failed", { message: revErr?.message });
      }
      throw creditErr;
    }
  } catch (err: any) {
    logger.error("POST /exchange failed", { message: err?.message });
    return res.status(500).json({ error: "Exchange failed", details: err?.message });
  }
});
