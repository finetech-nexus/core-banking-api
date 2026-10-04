import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { logger } from "../logger";
import {
  SUBSCRIPTIONS_DATATABLE,
  insertDatatableRow,
  listDatatableRows,
  listDatatableRowsForUser,
  resolveDefaultAccountId,
  rowId,
  updateDatatableRow,
} from "../services/clientDatatable";

export const route = Router();

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSubscriptionRow(row: Record<string, unknown>, tenantId: string, accountId: number | string) {
  let details: Record<string, unknown> | null = null;
  const raw = row.details_json;
  if (typeof raw === "string" && raw.trim()) {
    try {
      details = JSON.parse(raw);
    } catch {
      details = { raw };
    }
  }
  return {
    id: String(row.subscription_id || row.id || ""),
    productType: String(row.product_type || ""),
    productId: String(row.product_id || ""),
    productName: String(row.product_name || ""),
    planCode: row.plan_code != null ? String(row.plan_code) : null,
    planName: row.plan_name != null ? String(row.plan_name) : null,
    status: String(row.status || ""),
    amount: asNumber(row.amount),
    monthlyFee: asNumber(row.monthly_fee),
    currency: String(row.currency || ""),
    externalReference: row.external_reference != null ? String(row.external_reference) : null,
    details,
    accountId: String(accountId),
    tenantId,
    createdAt: String(row.issued_at || row.created_at || ""),
    updatedAt: String(row.changed_at || row.updated_at || ""),
    _rowId: rowId(row),
  };
}

function toPayload(body: Record<string, any>, nowIso: string): Record<string, unknown> {
  const details =
    body.details != null
      ? typeof body.details === "string"
        ? body.details
        : JSON.stringify(body.details)
      : body.details_json != null
        ? String(body.details_json)
        : "";
  const amount = asNumber(body.amount);
  const monthlyFee = asNumber(body.monthlyFee ?? body.monthly_fee);
  const payload: Record<string, unknown> = {
    subscription_id: String(body.id || body.subscription_id || "").trim(),
    product_type: String(body.productType || body.product_type || "").trim(),
    product_id: String(body.productId || body.product_id || ""),
    product_name: String(body.productName || body.product_name || ""),
    plan_code: String(body.planCode || body.plan_code || ""),
    plan_name: String(body.planName || body.plan_name || ""),
    status: String(body.status || "ACTIVE"),
    currency: String(body.currency || ""),
    external_reference: String(body.externalReference || body.external_reference || ""),
    details_json: details.slice(0, 65000),
    issued_at: String(body.createdAt || body.issued_at || body.created_at || nowIso),
    changed_at: String(body.updatedAt || body.changed_at || body.updated_at || nowIso),
    locale: "en",
    dateFormat: "yyyy-MM-dd",
  };
  if (amount != null) payload.amount = amount;
  if (monthlyFee != null) payload.monthly_fee = monthlyFee;
  return payload;
}

/**
 * GET /client-subscriptions — subscription history on savings accounts
 */
route.get("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const accountId = req.query.accountId ?? req.query.savingsAccountId;
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  try {
    const rows = await listDatatableRowsForUser(SUBSCRIPTIONS_DATATABLE, userId, tenantId, accountId);
    const subscriptions = rows
      .map((row) => mapSubscriptionRow(row, String(tenantId), row._accountId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ subscriptions });
  } catch (err) {
    logger.error("Error listing account subscriptions", { error: err });
    return res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

/**
 * POST /client-subscriptions — append/update history on a savings account
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  const nowIso = new Date().toISOString();
  const payload = toPayload(req.body || {}, nowIso);
  if (!payload.product_type) {
    return res.status(400).json({ error: "productType is required" });
  }
  const detailsAccount =
    req.body?.accountId ??
    req.body?.savingsAccountId ??
    req.body?.details?.accountId ??
    null;
  const accountId = await resolveDefaultAccountId(userId, tenantId, detailsAccount);
  if (accountId == null) {
    return res.status(400).json({ error: "accountId is required and must belong to the user" });
  }
  try {
    const rows = await listDatatableRows(SUBSCRIPTIONS_DATATABLE, accountId, tenantId);
    const ext = String(payload.external_reference || "");
    const existing =
      ext
        ? rows.find(
            (r) =>
              String(r.external_reference || "") === ext &&
              String(r.product_type || "") === String(payload.product_type)
          )
        : undefined;
    const existingRowId = existing ? rowId(existing) : null;
    if (existing && existingRowId != null) {
      const merged = {
        ...toPayload(
          {
            ...mapSubscriptionRow(existing, String(tenantId), accountId),
            ...(req.body || {}),
            createdAt: existing.issued_at || existing.created_at || payload.issued_at,
            updatedAt: nowIso,
          },
          nowIso
        ),
      };
      const response = await updateDatatableRow(
        SUBSCRIPTIONS_DATATABLE,
        accountId,
        existingRowId,
        tenantId,
        merged
      );
      if ((response as any)?.error) {
        return res.status(502).json({ error: "Failed to update subscription", details: (response as any).message });
      }
      return res.json({
        ok: true,
        updated: true,
        subscription: mapSubscriptionRow({ ...existing, ...merged, id: existingRowId }, String(tenantId), accountId),
      });
    }
    const response = await insertDatatableRow(SUBSCRIPTIONS_DATATABLE, accountId, tenantId, payload);
    if ((response as any)?.error) {
      logger.error("Subscription datatable insert failed", { message: (response as any).message });
      return res.status(502).json({ error: "Failed to save subscription", details: (response as any).message });
    }
    return res.status(201).json({
      ok: true,
      created: true,
      subscription: mapSubscriptionRow(
        { ...payload, id: (response as any)?.resourceId },
        String(tenantId),
        accountId
      ),
    });
  } catch (err) {
    logger.error("Error saving account subscription", { error: err });
    return res.status(500).json({ error: "Failed to save subscription" });
  }
});
