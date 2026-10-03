/**
 * Fineract savings charges: resolve by stable name, apply, and pay.
 * Uses Fineract REST only — no Fineract source changes.
 *
 * Charge time types (Apache Fineract):
 *  2 = Specified due date (one-shot, apply + pay)
 *  5 = Withdrawal fee
 *  7 = Monthly fee
 */
import { makeRequest } from "../middlewares/fineractRequest";
import { getFineractAccessToken } from "./keycloak-admin";
import { logger } from "../logger";

export type FineractCharge = {
  id: number;
  name: string;
  amount?: number;
  currency?: { code?: string };
  chargeTimeType?: { id?: number; value?: string };
  chargeAppliesTo?: { id?: number; value?: string };
  active?: boolean;
};

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** MonthDay string for Fineract monthly fees, e.g. "03 Oct" (locale en, format dd MMM). */
function feeOnMonthDayToday(): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${day} ${months[now.getUTCMonth()]}`;
}

async function adminAuth(): Promise<string> {
  const token = await getFineractAccessToken();
  return `Bearer ${token}`;
}

export async function listCharges(tenant?: string): Promise<FineractCharge[]> {
  const auth = await adminAuth();
  const response = await makeRequest({
    method: "GET",
    endpoint: "/charges",
    auth,
    tenant,
  });
  if ((response as any)?.error) {
    throw new Error((response as any).message || "Failed to list Fineract charges");
  }
  const items = Array.isArray(response) ? response : (response as any)?.pageItems ?? [];
  return items as FineractCharge[];
}

export async function findChargeByName(name: string, tenant?: string): Promise<FineractCharge | null> {
  const target = name.trim();
  if (!target) return null;
  const charges = await listCharges(tenant);
  return charges.find((c) => c.name === target && c.active !== false) || null;
}

/**
 * Apply a charge to a savings account (creates a savings-account charge).
 * - Specified due date (one-shot): amount + dueDate, then paySavingsCharge
 * - Monthly: amount + feeOnMonthDay + feeInterval (defaults to today so first period is due now)
 */
export async function applySavingsCharge(opts: {
  savingsAccountId: string;
  chargeId: number;
  amount?: number;
  dueDate?: string;
  /** When set, applies as monthly/annual-style fee instead of specified due date. */
  monthly?: boolean;
  feeOnMonthDay?: string;
  monthDayFormat?: string;
  feeInterval?: number;
  tenant?: string;
}) {
  const auth = await adminAuth();
  const payload: Record<string, unknown> = {
    chargeId: opts.chargeId,
    locale: "en",
  };
  if (opts.amount != null && Number.isFinite(opts.amount) && opts.amount >= 0) {
    payload.amount = opts.amount;
  }
  if (opts.monthly) {
    payload.feeOnMonthDay = opts.feeOnMonthDay || feeOnMonthDayToday();
    payload.monthDayFormat = opts.monthDayFormat || "dd MMM";
    payload.feeInterval = opts.feeInterval ?? 1;
  } else {
    payload.dueDate = opts.dueDate || today();
    payload.dateFormat = "yyyy-MM-dd";
  }
  logger.info("Apply savings charge", {
    savingsAccountId: opts.savingsAccountId,
    chargeId: opts.chargeId,
    amount: opts.amount,
    monthly: !!opts.monthly,
  });
  const response = await makeRequest({
    method: "POST",
    endpoint: `/savingsaccounts/${opts.savingsAccountId}/charges`,
    data: payload,
    auth,
    tenant: opts.tenant,
  });
  if ((response as any)?.error) {
    logger.error("Apply savings charge failed", { response });
    throw new Error((response as any).message || "Fineract apply charge failed");
  }
  return response;
}

/** Pay an applied savings-account charge (books fee on the customer account). */
export async function paySavingsCharge(opts: {
  savingsAccountId: string;
  savingsAccountChargeId: number | string;
  amount?: number;
  /** Optional Fineract note (e.g. card JSON so fees appear in card history). */
  note?: string;
  tenant?: string;
}) {
  const auth = await adminAuth();
  // Fineract payCharge expects `dueDate` (dueAsOfDate), not transactionDate.
  const payload: Record<string, unknown> = {
    dueDate: today(),
    dateFormat: "yyyy-MM-dd",
    locale: "en",
  };
  if (opts.amount != null && Number.isFinite(opts.amount) && opts.amount > 0) {
    payload.amount = opts.amount;
  }
  if (opts.note) {
    payload.note = opts.note;
  }
  logger.info("Pay savings charge", {
    savingsAccountId: opts.savingsAccountId,
    savingsAccountChargeId: opts.savingsAccountChargeId,
    amount: opts.amount,
  });
  const response = await makeRequest({
    method: "POST",
    endpoint: `/savingsaccounts/${opts.savingsAccountId}/charges/${opts.savingsAccountChargeId}?command=payCharge`,
    data: payload,
    auth,
    tenant: opts.tenant,
  });
  if ((response as any)?.error) {
    logger.error("Pay savings charge failed", { response });
    throw new Error((response as any).message || "Fineract pay charge failed");
  }
  return response;
}

/**
 * Resolve charge by stable name, apply to account, and pay immediately (one-shot fees).
 * Amount override comes from produit-api commercial tariff when provided.
 */
export async function applyAndPayChargeByName(opts: {
  savingsAccountId: string;
  chargeName: string;
  amount?: number;
  note?: string;
  tenant?: string;
}) {
  const charge = await findChargeByName(opts.chargeName, opts.tenant);
  if (!charge?.id) {
    throw new Error(`Fineract charge not found: ${opts.chargeName}`);
  }
  const applied = await applySavingsCharge({
    savingsAccountId: opts.savingsAccountId,
    chargeId: charge.id,
    amount: opts.amount,
    tenant: opts.tenant,
  });
  const savingsAccountChargeId =
    (applied as any)?.resourceId ??
    (applied as any)?.savingsAccountChargeId ??
    (applied as any)?.clientChargeId;
  if (savingsAccountChargeId == null) {
    throw new Error(`Fineract apply charge returned no resourceId for ${opts.chargeName}`);
  }
  const paid = await paySavingsCharge({
    savingsAccountId: opts.savingsAccountId,
    savingsAccountChargeId,
    amount: opts.amount,
    note: opts.note,
    tenant: opts.tenant,
  });
  return {
    chargeId: charge.id,
    chargeName: charge.name,
    savingsAccountChargeId,
    amount: opts.amount ?? charge.amount,
    applied,
    paid,
  };
}

/**
 * Attach a monthly (recurring) charge and collect the first period immediately.
 * feeOnMonthDay defaults to today so the first due date is now (not a far seed date like 01 Feb).
 */
export async function attachMonthlyChargeByName(opts: {
  savingsAccountId: string;
  chargeName: string;
  amount?: number;
  note?: string;
  /** When false, only attaches the schedule (no immediate debit). Default true. */
  collectFirstPeriod?: boolean;
  tenant?: string;
}) {
  const charge = await findChargeByName(opts.chargeName, opts.tenant);
  if (!charge?.id) {
    throw new Error(`Fineract charge not found: ${opts.chargeName}`);
  }
  const amount = opts.amount ?? charge.amount;
  const applied = await applySavingsCharge({
    savingsAccountId: opts.savingsAccountId,
    chargeId: charge.id,
    amount,
    monthly: true,
    tenant: opts.tenant,
  });
  const savingsAccountChargeId =
    (applied as any)?.resourceId ??
    (applied as any)?.savingsAccountChargeId ??
    (applied as any)?.clientChargeId;
  if (savingsAccountChargeId == null) {
    throw new Error(`Fineract apply monthly charge returned no resourceId for ${opts.chargeName}`);
  }

  let paid: unknown;
  if (opts.collectFirstPeriod !== false) {
    paid = await paySavingsCharge({
      savingsAccountId: opts.savingsAccountId,
      savingsAccountChargeId,
      amount,
      note: opts.note,
      tenant: opts.tenant,
    });
  }

  return {
    chargeId: charge.id,
    chargeName: charge.name,
    savingsAccountChargeId,
    amount,
    applied,
    paid,
    collectedFirstPeriod: opts.collectFirstPeriod !== false,
  };
}

/** Stable charge name helpers used by BFF / catalog. */
export function feeChargeName(category: string, currency: string): string {
  return `${category.trim()} ${String(currency || "").trim().toUpperCase()}`.replace(/\s+/g, " ").trim();
}
