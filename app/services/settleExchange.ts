import axios from "axios";
import { logger } from "../logger";
import { creditAccount, debitAccount, releaseAmount } from "./fineractAccount";
import {
  getPendingExchange,
  removePendingExchange,
  type PendingExchange,
} from "./pendingExchange";
import { isApprovedWorkflow } from "./ballerineExchange";

const PAYMENT_TYPE_ID = process.env.FINERACT_PAYMENT_TYPE_ID || "1";

export async function settleExchangeFromWebhook(payload: any) {
  const workflowRuntimeId = String(payload?.workflowRuntimeId || "");
  if (!workflowRuntimeId) {
    throw new Error("Missing workflowRuntimeId");
  }

  const pending = getPendingExchange(workflowRuntimeId);
  const exchange = payload?.data?.exchange || payload?.exchange || {};
  const fromAccountId = pending?.fromAccountId || String(exchange.fromAccountId || "");
  const holdTransactionId = pending?.holdTransactionId || String(exchange.holdTransactionId || "");
  const tenantId = process.env.FINERACT_TENANT;

  if (!fromAccountId || !holdTransactionId) {
    logger.warn("FX webhook with no pending hold", { workflowRuntimeId });
    return { ok: false, error: "No pending exchange for this workflow" };
  }

  const record: PendingExchange = pending || {
    workflowRuntimeId,
    userId: "",
    fromAccountId,
    toAccountId: String(exchange.toAccountId || ""),
    fromAccountNo: "",
    amount: Number(exchange.amount) || 0,
    toAmount: Number(exchange.toAmount) || 0,
    rate: Number(exchange.rate) || 0,
    fromCurrency: String(exchange.fromCurrency || ""),
    toCurrency: String(exchange.toCurrency || ""),
    holdTransactionId,
    createdAt: new Date().toISOString(),
  };

  const approved = isApprovedWorkflow(payload);

  try {
    await releaseAmount(fromAccountId, holdTransactionId, tenantId);
  } catch (err: any) {
    logger.error("FX webhook release failed", { workflowRuntimeId, message: err?.message });
    throw err;
  }

  if (!approved) {
    removePendingExchange(workflowRuntimeId);
    logger.info("FX review rejected, hold released", { workflowRuntimeId });
    await notifyCallback(record, false);
    return { ok: true, status: "rejected", rolledBack: true };
  }

  const debit = await debitAccount(
    fromAccountId,
    record.fromAccountNo || fromAccountId,
    PAYMENT_TYPE_ID,
    `fx-${workflowRuntimeId}-out`,
    record.amount,
    `FX to ${record.toAccountId} (approved)`,
    tenantId
  );

  let credit = null;
  const sameTenant =
    !record.toTenantId ||
    String(record.toTenantId).toLowerCase() === "tn" ||
    String(record.toTenantId).toLowerCase() === String(process.env.TENANT || "").toLowerCase();

  if (sameTenant && record.toAccountId && record.toAccountNo) {
    try {
      credit = await creditAccount(
        record.toAccountId,
        record.toAccountNo,
        PAYMENT_TYPE_ID,
        `fx-${workflowRuntimeId}-in`,
        record.toAmount,
        `FX from ${fromAccountId} (approved)`,
        tenantId
      );
    } catch (err: any) {
      logger.error("FX webhook local credit failed, reversing debit", { message: err?.message });
      try {
        await creditAccount(
          fromAccountId,
          record.fromAccountNo || fromAccountId,
          PAYMENT_TYPE_ID,
          `fx-${workflowRuntimeId}-rev`,
          record.amount,
          "FX reversal after credit failure",
          tenantId
        );
      } catch (revErr: any) {
        logger.error("FX webhook reversal failed", { message: revErr?.message });
      }
      throw err;
    }
  }

  removePendingExchange(workflowRuntimeId);
  await notifyCallback(record, true);
  logger.info("FX review approved and settled", { workflowRuntimeId, sameTenant: !!credit });
  return { ok: true, status: "approved", debit, credit };
}

async function notifyCallback(record: PendingExchange, approved: boolean) {
  if (!record.settleCallbackUrl) return;
  try {
    await axios.post(
      record.settleCallbackUrl,
      {
        approved,
        workflowRuntimeId: record.workflowRuntimeId,
        userId: record.userId,
        fromAccountId: record.fromAccountId,
        toAccountId: record.toAccountId,
        toTenantId: record.toTenantId,
        fromAmount: record.amount,
        toAmount: record.toAmount,
        rate: record.rate,
        fromCurrency: record.fromCurrency,
        toCurrency: record.toCurrency,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-exchange-settle-secret": process.env.EXCHANGE_SETTLE_SECRET || "",
        },
        timeout: 15000,
      }
    );
  } catch (err: any) {
    logger.error("FX settle callback failed", {
      workflowRuntimeId: record.workflowRuntimeId,
      message: err?.message,
    });
  }
}
