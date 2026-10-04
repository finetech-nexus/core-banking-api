import { logger } from "../logger";
import { creditAccount, getAccounts } from "./fineractAccount";
import { getClients } from "./fineractClient";
import { isApprovedWorkflow } from "./ballerineExchange";
import {
  approveReferralByWorkflow,
  markReferralCredited,
  rejectReferralByWorkflow,
  type ReferralRow,
} from "./referralClient";

const PAYMENT_TYPE_ID = process.env.FINERACT_PAYMENT_TYPE_ID || "1";

export async function settleReferralFromWebhook(payload: any) {
  const workflowRuntimeId = String(payload?.workflowRuntimeId || "");
  if (!workflowRuntimeId) throw new Error("Missing workflowRuntimeId");

  const approved = isApprovedWorkflow(payload);
  if (!approved) {
    await rejectReferralByWorkflow(workflowRuntimeId);
    logger.info("Parrainage rejected by agent", { workflowRuntimeId });
    return { ok: true, status: "rejected" };
  }

  const referral = await approveReferralByWorkflow(workflowRuntimeId);
  if (!referral) {
    return { ok: false, error: "Referral not found for workflow" };
  }
  if (referral.status === "CREDITED") {
    return { ok: true, status: "already_credited", referralId: referral.id };
  }

  const creditResult = await creditReferrerReward(referral);
  if (!creditResult.ok) {
    return creditResult;
  }
  await markReferralCredited(referral.id);
  return { ok: true, status: "credited", referralId: referral.id, ...creditResult };
}

export async function creditReferrerReward(referral: ReferralRow) {
  const amount = Number(referral.rewardAmount || 0);
  if (!(amount > 0)) {
    logger.info("Parrainage approved with zero reward — skipping credit", { referralId: referral.id });
    return { ok: true, skipped: true, reason: "zero_reward" };
  }
  const tenantId = process.env.FINERACT_TENANT;
  const ownerId = String(referral.ownerId || "");
  const accountId = String(referral.accountId || "").trim();
  if (!accountId) {
    logger.error("Parrainage credit missing accountId", { referralId: referral.id });
    return { ok: false, error: "Referrer accountId missing on referral" };
  }

  try {
    // Resolve account number from Fineract
    let accountNo = accountId;
    if (ownerId) {
      const clients = await getClients(ownerId, tenantId);
      if (Array.isArray(clients) && clients[0]?.id != null) {
        const accounts = await getAccounts(String(clients[0].id), tenantId);
        const match = (accounts || []).find((a: any) => String(a.id) === accountId);
        if (match?.accountNo) accountNo = String(match.accountNo);
      }
    }

    await creditAccount(
      accountId,
      accountNo,
      PAYMENT_TYPE_ID,
      `parrainage-${referral.id}`,
      amount,
      `Parrainage reward ${amount} ${referral.currency} — ${referral.invitedEmail}`,
      tenantId
    );
    logger.info("Parrainage reward credited", {
      referralId: referral.id,
      accountId,
      amount,
      currency: referral.currency,
    });
    return { ok: true, accountId, amount, currency: referral.currency };
  } catch (error: any) {
    logger.error("Parrainage credit failed", { referralId: referral.id, error: error?.message });
    return { ok: false, error: error?.message || "Credit failed" };
  }
}
