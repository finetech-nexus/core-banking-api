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
 * For specified-due-date charges, pass amount + dueDate then call paySavingsCharge.
 */
export async function applySavingsCharge(opts: {
  savingsAccountId: string;
  chargeId: number;
  amount?: number;
  dueDate?: string;
  tenant?: string;
}) {
  const auth = await adminAuth();
  const due = opts.dueDate || today();
  const payload: Record<string, unknown> = {
    chargeId: opts.chargeId,
    dueDate: due,
    dateFormat: "yyyy-MM-dd",
    locale: "en",
  };
  if (opts.amount != null && Number.isFinite(opts.amount) && opts.amount >= 0) {
    payload.amount = opts.amount;
  }
  logger.info("Apply savings charge", {
    savingsAccountId: opts.savingsAccountId,
    chargeId: opts.chargeId,
    amount: opts.amount,
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
  tenant?: string;
}) {
  const auth = await adminAuth();
  const payload: Record<string, unknown> = {
    transactionDate: today(),
    dateFormat: "yyyy-MM-dd",
    locale: "en",
  };
  if (opts.amount != null && Number.isFinite(opts.amount) && opts.amount > 0) {
    payload.amount = opts.amount;
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

/** Attach a monthly (recurring) charge — Fineract collects on its schedule. */
export async function attachMonthlyChargeByName(opts: {
  savingsAccountId: string;
  chargeName: string;
  amount?: number;
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
  return {
    chargeId: charge.id,
    chargeName: charge.name,
    savingsAccountChargeId: (applied as any)?.resourceId,
    amount: opts.amount ?? charge.amount,
    applied,
  };
}

/** Stable charge name helpers used by BFF / catalog. */
export function feeChargeName(category: string, currency: string): string {
  return `${category.trim()} ${String(currency || "").trim().toUpperCase()}`.replace(/\s+/g, " ").trim();
}
