import axios from "axios";
import { logger } from "../logger";

function subscriptionBase(): string | null {
  const configured = process.env.SUBSCRIPTION_API_URL?.replace(/\/+$/, "");
  if (!configured) return null;
  return /\/api$/i.test(configured) ? configured : `${configured}/api`;
}

function internalHeaders() {
  const key = process.env.SUBSCRIPTION_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || "";
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(key ? { "X-Internal-Key": key } : {}),
  };
}

export type ReferralRow = {
  id: string;
  ownerId?: string | null;
  invitedEmail: string;
  status: string;
  rewardAmount: number | null;
  currency: string;
  tenantId?: string | null;
  accountId?: string | null;
  campaignCode?: string | null;
  referredUserId?: string | null;
  workflowRuntimeId?: string | null;
};

export async function matchReferral(email: string, referredUserId: string): Promise<ReferralRow | null> {
  const base = subscriptionBase();
  if (!base) {
    logger.warn("Referral match skipped: SUBSCRIPTION_API_URL not set");
    return null;
  }
  try {
    const response = await axios.post(
      `${base}/referrals/internal/match`,
      { email, referredUserId },
      { headers: internalHeaders(), timeout: 10000, validateStatus: () => true }
    );
    if (response.status === 404) return null;
    if (response.status >= 300) {
      logger.warn("Referral match rejected", { status: response.status, data: response.data });
      return null;
    }
    return response.data as ReferralRow;
  } catch (error: any) {
    logger.warn("Referral match failed", { error: error?.message });
    return null;
  }
}

export async function attachReferralWorkflow(id: string, workflowRuntimeId: string): Promise<ReferralRow | null> {
  const base = subscriptionBase();
  if (!base) return null;
  try {
    const response = await axios.post(
      `${base}/referrals/internal/${encodeURIComponent(id)}/workflow`,
      { workflowRuntimeId },
      { headers: internalHeaders(), timeout: 10000, validateStatus: () => true }
    );
    if (response.status >= 300) {
      logger.warn("Referral workflow attach rejected", { status: response.status, data: response.data });
      return null;
    }
    return response.data as ReferralRow;
  } catch (error: any) {
    logger.warn("Referral workflow attach failed", { error: error?.message });
    return null;
  }
}

export async function approveReferralByWorkflow(workflowRuntimeId: string): Promise<ReferralRow | null> {
  const base = subscriptionBase();
  if (!base) return null;
  try {
    const response = await axios.post(
      `${base}/referrals/internal/workflow/${encodeURIComponent(workflowRuntimeId)}/approve`,
      {},
      { headers: internalHeaders(), timeout: 10000, validateStatus: () => true }
    );
    if (response.status >= 300) {
      logger.warn("Referral approve rejected", { status: response.status, data: response.data });
      return null;
    }
    return response.data as ReferralRow;
  } catch (error: any) {
    logger.warn("Referral approve failed", { error: error?.message });
    return null;
  }
}

export async function rejectReferralByWorkflow(workflowRuntimeId: string): Promise<ReferralRow | null> {
  const base = subscriptionBase();
  if (!base) return null;
  try {
    const response = await axios.post(
      `${base}/referrals/internal/workflow/${encodeURIComponent(workflowRuntimeId)}/reject`,
      {},
      { headers: internalHeaders(), timeout: 10000, validateStatus: () => true }
    );
    if (response.status >= 300) return null;
    return response.data as ReferralRow;
  } catch {
    return null;
  }
}

export async function markReferralCredited(id: string): Promise<void> {
  const base = subscriptionBase();
  if (!base) return;
  try {
    await axios.post(
      `${base}/referrals/internal/${encodeURIComponent(id)}/credited`,
      {},
      { headers: internalHeaders(), timeout: 10000, validateStatus: () => true }
    );
  } catch (error: any) {
    logger.warn("Referral credited mark failed", { error: error?.message });
  }
}
