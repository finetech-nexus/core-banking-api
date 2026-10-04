/**
 * Resolve Fineract payment type id by stable name (seeded via fineract-configurator).
 */
import { makeRequest } from "../middlewares/fineractRequest";
import { getFineractAccessToken } from "./keycloak-admin";
import { logger } from "../logger";

type PaymentType = { id?: number; name?: string; isCashPayment?: boolean };

let cache: { tenant: string; at: number; items: PaymentType[] } | null = null;
const CACHE_MS = 60_000;

async function listPaymentTypes(tenant?: string): Promise<PaymentType[]> {
  const tenantKey = String(tenant || process.env.FINERACT_TENANT || "default");
  if (cache && cache.tenant === tenantKey && Date.now() - cache.at < CACHE_MS) {
    return cache.items;
  }
  const auth = `Bearer ${await getFineractAccessToken()}`;
  const response = await makeRequest({
    method: "GET",
    endpoint: "/paymenttypes",
    auth,
    tenant: tenantKey,
  });
  if ((response as any)?.error) {
    logger.warn("Could not list Fineract payment types", { response });
    return [];
  }
  const items = Array.isArray(response) ? response : (response as any)?.pageItems ?? [];
  cache = { tenant: tenantKey, at: Date.now(), items: items as PaymentType[] };
  return cache.items;
}

export async function resolvePaymentTypeId(opts: {
  paymentTypeId?: string | number | null;
  paymentTypeName?: string | null;
  fallbackId?: string | number | null;
  tenant?: string;
}): Promise<string> {
  if (opts.paymentTypeId != null && String(opts.paymentTypeId).trim() !== "") {
    return String(opts.paymentTypeId).trim();
  }
  const name = String(opts.paymentTypeName || "").trim();
  if (name) {
    const types = await listPaymentTypes(opts.tenant);
    const match = types.find((t) => String(t.name || "").toLowerCase() === name.toLowerCase());
    if (match?.id != null) return String(match.id);
    logger.warn("Payment type name not found, using fallback", { name, fallback: opts.fallbackId });
  }
  return String(opts.fallbackId ?? process.env.FINERACT_PAYMENT_TYPE_ID ?? "1");
}
