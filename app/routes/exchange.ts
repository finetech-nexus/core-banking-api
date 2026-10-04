import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { getClients } from "../services/fineractClient";
import {
  creditAccount,
  debitAccount,
  getAccounts,
  holdAmount,
  releaseAmount,
} from "../services/fineractAccount";
import { getQuoteRate, roundMoney, toCurrencyCode } from "../services/exchangeRate";
import { exchangeLabel, exchangeLedgerNote } from "../services/exchangeNote";
import { resolvePaymentTypeId } from "../services/fineractPaymentTypes";
import { isTunisiaOutboundFx, savePendingExchange } from "../services/pendingExchange";
import { startExchangeCurrencyWorkflow } from "../services/ballerineExchange";
import { settleExchangeFromWebhook } from "../services/settleExchange";
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
  const fromCurrency = toCurrencyCode(String(req.body?.fromCurrency || ""));
  const toCurrency = toCurrencyCode(String(req.body?.toCurrency || ""));
  const rate = Number(req.body?.rate) || 0;
  const toAmount = Number(req.body?.toAmount) > 0 ? roundMoney(Number(req.body.toAmount)) : rate ? roundMoney(amount * rate) : 0;
  const note = String(
    req.body?.note ||
      (fromCurrency && toCurrency && rate
        ? exchangeLedgerNote({
            fromAmount: roundMoney(amount),
            fromCurrency,
            toAmount,
            toCurrency,
            rate,
            side: "debit",
          })
        : "Currency exchange debit")
  );

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!savingsAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "savingsAccountId and amount are required" });
  }

  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const receipt = `fx-out-${Date.now()}`;
    const paymentTypeId = await resolvePaymentTypeId({
      paymentTypeId: req.body?.paymentTypeId,
      paymentTypeName: req.body?.paymentTypeName,
      fallbackId: PAYMENT_TYPE_ID,
      tenant: tenantId,
    });
    const data = await debitAccount(
      savingsAccountId,
      owned.account.accountNo,
      paymentTypeId,
      receipt,
      roundMoney(amount),
      note,
      tenantId
    );
    return res.json({
      ok: true,
      savingsAccountId,
      amount: roundMoney(amount),
      paymentTypeId,
      paymentTypeName: req.body?.paymentTypeName || null,
      data,
    });
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
  const fromCurrency = toCurrencyCode(String(req.body?.fromCurrency || ""));
  const toCurrency = toCurrencyCode(String(req.body?.toCurrency || ""));
  const rate = Number(req.body?.rate) || 0;
  const fromAmount = Number(req.body?.fromAmount) > 0 ? roundMoney(Number(req.body.fromAmount)) : 0;
  const note = String(
    req.body?.note ||
      (fromCurrency && toCurrency && rate
        ? exchangeLedgerNote({
            fromAmount: fromAmount || (rate ? roundMoney(amount / rate) : amount),
            fromCurrency,
            toAmount: roundMoney(amount),
            toCurrency,
            rate,
            side: "credit",
          })
        : "Currency exchange credit")
  );

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

route.post("/internal-credit", async (req: any, res: Response) => {
  const secret = process.env.EXCHANGE_SETTLE_SECRET || "";
  if (!secret || req.headers["x-exchange-settle-secret"] !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = String(req.body?.userId || "");
  const savingsAccountId = String(req.body?.savingsAccountId || "");
  const amount = Number(req.body?.amount);
  const fromCurrency = toCurrencyCode(String(req.body?.fromCurrency || ""));
  const toCurrency = toCurrencyCode(String(req.body?.toCurrency || ""));
  const rate = Number(req.body?.rate) || 0;
  const fromAmount = Number(req.body?.fromAmount) > 0 ? roundMoney(Number(req.body.fromAmount)) : 0;
  const note = String(
    req.body?.note ||
      (fromCurrency && toCurrency && rate
        ? exchangeLedgerNote({
            fromAmount: fromAmount || (rate ? roundMoney(amount / rate) : amount),
            fromCurrency,
            toAmount: roundMoney(amount),
            toCurrency,
            rate,
            side: "credit",
          })
        : "Currency exchange credit")
  );
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "userId is required" });
  if (!savingsAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "savingsAccountId and amount are required" });
  }
  try {
    const owned = await findOwnedSavings(userId, savingsAccountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });
    const data = await creditAccount(
      savingsAccountId,
      owned.account.accountNo,
      PAYMENT_TYPE_ID,
      `fx-in-${Date.now()}`,
      roundMoney(amount),
      note,
      tenantId
    );
    return res.json({ ok: true, savingsAccountId, amount: roundMoney(amount), data });
  } catch (err: any) {
    logger.error("POST /exchange/internal-credit failed", { message: err?.message });
    return res.status(500).json({ error: "Exchange credit failed", details: err?.message });
  }
});

route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const fromAccountId = String(req.body?.fromAccountId || "");
  const toAccountId = String(req.body?.toAccountId || "");
  const amount = Number(req.body?.amount);
  const fromCurrency = toCurrencyCode(String(req.body?.fromCurrency || ""));
  const toCurrency = toCurrencyCode(String(req.body?.toCurrency || ""));

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!fromAccountId || !toAccountId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "fromAccountId, toAccountId and amount are required" });
  }
  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: "Choose two different accounts" });
  }

  const fromOwned = await findOwnedSavings(userId, fromAccountId, tenantId);
  const toOwned = toAccountId
    ? await findOwnedSavings(userId, toAccountId, tenantId)
    : null;
  if (!fromOwned) {
    return res.status(404).json({ error: "Account not found on this tenant" });
  }

  const fromCode = fromCurrency || toCurrencyCode(fromOwned.account.currency?.code || fromOwned.account.currency);
  const toCode =
    toCurrency ||
    toCurrencyCode(toOwned?.account.currency?.code || toOwned?.account.currency || "");
  const rate = Number(req.body?.rate) || getQuoteRate(String(fromCode), String(toCode));
  if (!rate) {
    return res.status(404).json({ error: "No rate for currency pair" });
  }
  const converted = roundMoney(amount * rate);
  const debitAmount = roundMoney(amount);
  const toAmount = Number(req.body?.toAmount) > 0 ? roundMoney(Number(req.body.toAmount)) : converted;
  const fxMeta = {
    fromAmount: debitAmount,
    fromCurrency: String(fromCode),
    toAmount,
    toCurrency: String(toCode),
    rate,
  };
  const debitNote = exchangeLedgerNote({ ...fxMeta, side: "debit" });
  const creditNote = exchangeLedgerNote({ ...fxMeta, side: "credit" });
  const holdNote = exchangeLabel({ ...fxMeta, side: "hold" });
  const reversalNote = exchangeLedgerNote({ ...fxMeta, side: "reversal" });

  if (isTunisiaOutboundFx(fromCode, toCode)) {
    const doc = req.body?.document || {};
    const base64 = String(doc.base64 || req.body?.documentBase64 || "").replace(
      /^data:[^;]+;base64,/,
      ""
    );
    if (!base64) {
      return res.status(400).json({
        error: "DOCUMENT_REQUIRED",
        message: "A supporting document is required to exchange TND to another currency",
      });
    }

    let holdTransactionId = "";
    try {
      const hold = await holdAmount(
        fromAccountId,
        debitAmount,
        holdNote,
        tenantId
      );
      holdTransactionId = String(hold?.resourceId || hold?.id || "");
      if (!holdTransactionId) {
        throw new Error("Hold did not return a transaction id");
      }

      const started = await startExchangeCurrencyWorkflow({
        userId,
        email: req.body?.email,
        firstName: req.body?.firstName,
        lastName: req.body?.lastName,
        phone: req.body?.phone,
        fromAccountId,
        toAccountId,
        amount: debitAmount,
        toAmount,
        rate,
        fromCurrency: fromCode,
        toCurrency: toCode,
        holdTransactionId,
        note: req.body?.note,
        document: {
          base64,
          mimeType: doc.mimeType || req.body?.documentMimeType,
          fileName: doc.fileName || req.body?.documentFileName,
        },
      });

      savePendingExchange({
        workflowRuntimeId: started.workflowRuntimeId,
        userId,
        fromAccountId,
        toAccountId,
        fromAccountNo: fromOwned.account.accountNo,
        toAccountNo: toOwned?.account.accountNo,
        amount: debitAmount,
        toAmount,
        rate,
        fromCurrency: fromCode,
        toCurrency: toCode,
        holdTransactionId,
        toTenantId: req.body?.toTenantId,
        settleCallbackUrl: req.body?.settleCallbackUrl,
        note: req.body?.note || debitNote,
        createdAt: new Date().toISOString(),
      });

      return res.json({
        ok: true,
        status: "pending_review",
        workflowRuntimeId: started.workflowRuntimeId,
        holdTransactionId,
        fromAmount: debitAmount,
        toAmount,
        rate,
      });
    } catch (err: any) {
      logger.error("TN FX review start failed", { message: err?.message });
      if (holdTransactionId) {
        try {
          await releaseAmount(fromAccountId, holdTransactionId, tenantId);
        } catch (relErr: any) {
          logger.error("TN FX hold release after failure", { message: relErr?.message });
        }
      }
      return res.status(500).json({ error: "Could not start exchange review", details: err?.message });
    }
  }

  if (!toOwned) {
    return res.status(404).json({ error: "Account not found on this tenant" });
  }

  try {
    const outReceipt = `fx-${Date.now()}-out`;
    const inReceipt = `fx-${Date.now()}-in`;
    const debit = await debitAccount(
      fromAccountId,
      fromOwned.account.accountNo,
      PAYMENT_TYPE_ID,
      outReceipt,
      debitAmount,
      debitNote,
      tenantId
    );
    try {
      const credit = await creditAccount(
        toAccountId,
        toOwned.account.accountNo,
        PAYMENT_TYPE_ID,
        inReceipt,
        toAmount,
        creditNote,
        tenantId
      );
      return res.json({
        ok: true,
        status: "completed",
        fromAccountId,
        toAccountId,
        fromAmount: debitAmount,
        toAmount,
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
          reversalNote,
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

route.post("/webhook", keycloakProtect, async (req: any, res: Response) => {
  try {
    const result = await settleExchangeFromWebhook(req.body);
    return res.json(result);
  } catch (err: any) {
    logger.error("POST /exchange/webhook failed", { message: err?.message });
    return res.status(500).json({ error: "Exchange webhook failed", details: err?.message });
  }
});
