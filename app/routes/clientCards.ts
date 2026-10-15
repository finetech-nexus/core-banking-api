import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { logger } from "../logger";
import {
  CARDS_DATATABLE,
  deleteDatatableRow,
  insertDatatableRow,
  listDatatableRows,
  listDatatableRowsForUser,
  resolveDefaultAccountId,
  resolveOwnedAccountId,
  rowId,
  updateDatatableRow,
} from "../services/clientDatatable";

export const route = Router();

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Map Fineract row → mobile/BFF IssuedCard shape. */
export function mapCardRow(
  row: Record<string, unknown>,
  tenantId: string,
  userId: string,
  accountId: number | string
) {
  return {
    id: String(row.card_id || ""),
    userId,
    tenantId,
    productId: String(row.product_id || ""),
    productName: String(row.product_name || ""),
    accountId: String(accountId),
    form: String(row.form || "VIRTUAL"),
    kind: String(row.kind || "BASIC"),
    scheme: String(row.scheme || "VISA"),
    currency: String(row.currency || ""),
    status: String(row.status || "ACTIVE"),
    last4: String(row.last4 || ""),
    expiryMonth: asNumber(row.expiry_month),
    expiryYear: asNumber(row.expiry_year),
    holderName: String(row.holder_name || ""),
    limits: {
      dailyAmount: asNumber(row.daily_amount, 500),
      monthlyAmount: asNumber(row.monthly_amount, 3000),
      dailyCount: asNumber(row.daily_count, 20),
      contactlessEnabled: asBool(row.contactless_enabled, true),
      ecommerceEnabled: asBool(row.ecommerce_enabled, true),
      internationalEnabled: asBool(row.international_enabled, false),
      atmEnabled: asBool(row.atm_enabled, true),
    },
    walletTokens: {
      applePay: asBool(row.apple_pay, false),
      googlePay: asBool(row.google_pay, false),
    },
    processorCardId: String(row.processor_card_id || ""),
    createdAt: String(row.issued_at || row.created_at || ""),
    updatedAt: String(row.changed_at || row.updated_at || ""),
    _rowId: rowId(row),
  };
}

function toDatatablePayload(body: Record<string, any>, nowIso: string): Record<string, unknown> {
  const limits = body.limits || {};
  const wallet = body.walletTokens || {};
  return {
    card_id: String(body.id || body.card_id || "").trim(),
    product_id: String(body.productId || body.product_id || ""),
    product_name: String(body.productName || body.product_name || ""),
    form: String(body.form || "VIRTUAL"),
    kind: String(body.kind || "BASIC"),
    scheme: String(body.scheme || "VISA"),
    currency: String(body.currency || ""),
    status: String(body.status || "ACTIVE"),
    last4: String(body.last4 || "").replace(/\D/g, "").slice(-4),
    expiry_month: asNumber(body.expiryMonth ?? body.expiry_month),
    expiry_year: asNumber(body.expiryYear ?? body.expiry_year),
    holder_name: String(body.holderName || body.holder_name || ""),
    daily_amount: asNumber(limits.dailyAmount ?? body.daily_amount, 500),
    monthly_amount: asNumber(limits.monthlyAmount ?? body.monthly_amount, 3000),
    daily_count: asNumber(limits.dailyCount ?? body.daily_count, 20),
    contactless_enabled: asBool(limits.contactlessEnabled ?? body.contactless_enabled, true),
    ecommerce_enabled: asBool(limits.ecommerceEnabled ?? body.ecommerce_enabled, true),
    international_enabled: asBool(limits.internationalEnabled ?? body.international_enabled, false),
    atm_enabled: asBool(limits.atmEnabled ?? body.atm_enabled, true),
    apple_pay: asBool(wallet.applePay ?? body.apple_pay, false),
    google_pay: asBool(wallet.googlePay ?? body.google_pay, false),
    processor_card_id: String(body.processorCardId || body.processor_card_id || ""),
    issued_at: String(body.createdAt || body.issued_at || body.created_at || nowIso),
    changed_at: String(body.updatedAt || body.changed_at || body.updated_at || nowIso),
    locale: "en",
    dateFormat: "yyyy-MM-dd",
  };
}

/**
 * GET /client-cards — durable card list from Fineract datatable cards (per savings account)
 * Query: accountId (optional) — when omitted, aggregates all owned accounts.
 */
route.get("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const accountId = req.query.accountId ?? req.query.savingsAccountId;
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  try {
    const rows = await listDatatableRowsForUser(CARDS_DATATABLE, userId, tenantId, accountId);
    const cards = rows
      .map((row) => mapCardRow(row, String(tenantId), userId, row._accountId))
      .filter((c) => c.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ cards });
  } catch (err) {
    logger.error("Error listing account cards", { error: err });
    return res.status(500).json({ error: "Failed to list cards" });
  }
});

/**
 * POST /client-cards — upsert issued card on the linked savings account
 * Body must include accountId (or id of an owned account).
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  const nowIso = new Date().toISOString();
  const payload = toDatatablePayload(req.body || {}, nowIso);
  if (!payload.card_id) {
    return res.status(400).json({ error: "id / card_id is required" });
  }
  const accountId = await resolveDefaultAccountId(
    userId,
    tenantId,
    req.body?.accountId ?? req.body?.savingsAccountId ?? req.body?.account_id
  );
  if (accountId == null) {
    return res.status(400).json({ error: "accountId is required and must belong to the user" });
  }
  try {
    const rows = await listDatatableRows(CARDS_DATATABLE, accountId, tenantId);
    const existing = rows.find((r) => String(r.card_id || "") === String(payload.card_id));
    const existingRowId = existing ? rowId(existing) : null;
    if (existing && existingRowId != null) {
      const merged = {
        ...toDatatablePayload(
          {
            ...mapCardRow(existing, String(tenantId), userId, accountId),
            ...(req.body || {}),
            id: payload.card_id,
            createdAt: existing.issued_at || existing.created_at || payload.issued_at,
            updatedAt: nowIso,
          },
          nowIso
        ),
      };
      const response = await updateDatatableRow(CARDS_DATATABLE, accountId, existingRowId, tenantId, merged);
      if ((response as any)?.error) {
        logger.error("Card datatable update failed", { message: (response as any).message });
        return res.status(502).json({ error: "Failed to update card in Fineract", details: (response as any).message });
      }
      return res.json({
        ok: true,
        updated: true,
        card: mapCardRow({ ...existing, ...merged, id: existingRowId }, String(tenantId), userId, accountId),
      });
    }
    const response = await insertDatatableRow(CARDS_DATATABLE, accountId, tenantId, payload);
    if ((response as any)?.error) {
      logger.error("Card datatable insert failed", { message: (response as any).message });
      return res.status(502).json({ error: "Failed to save card in Fineract", details: (response as any).message });
    }
    return res.status(201).json({
      ok: true,
      created: true,
      card: mapCardRow({ ...payload, id: (response as any)?.resourceId }, String(tenantId), userId, accountId),
    });
  } catch (err) {
    logger.error("Error saving account card", { error: err });
    return res.status(500).json({ error: "Failed to save card" });
  }
});

/**
 * DELETE /client-cards/:cardId — remove the card row from the owner's savings account.
 */
route.delete("/:cardId", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const cardId = String(req.params.cardId || "").trim();
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!cardId) return res.status(400).json({ error: "cardId is required" });
  try {
    const rows = await listDatatableRowsForUser(CARDS_DATATABLE, userId, tenantId);
    const existing = rows.find((r) => String(r.card_id || "") === cardId);
    const existingRowId = existing ? rowId(existing) : null;
    const accountId = existing?._accountId ?? null;
    if (!existing || existingRowId == null || accountId == null) {
      return res.status(404).json({ error: "Card not found" });
    }
    const response = await deleteDatatableRow(CARDS_DATATABLE, accountId, existingRowId, tenantId);
    if ((response as any)?.error) {
      return res.status(502).json({ error: "Failed to delete card", details: (response as any).message });
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Error deleting account card", { error: err });
    return res.status(500).json({ error: "Failed to delete card" });
  }
});

/**
 * PUT /client-cards/:cardId — patch status / limits / wallet on the savings-account row
 */
route.put("/:cardId", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const cardId = String(req.params.cardId || "").trim();
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!cardId) return res.status(400).json({ error: "cardId is required" });
  try {
    const hinted = req.body?.accountId ?? req.query.accountId;
    let accountId: number | null = null;
    let existing: (Record<string, unknown> & { _accountId?: number }) | undefined;
    if (hinted != null) {
      accountId = await resolveOwnedAccountId(userId, tenantId, hinted);
      if (accountId == null) return res.status(404).json({ error: "Account not found" });
      const rows = await listDatatableRows(CARDS_DATATABLE, accountId, tenantId);
      existing = rows.find((r) => String(r.card_id || "") === cardId);
    } else {
      const rows = await listDatatableRowsForUser(CARDS_DATATABLE, userId, tenantId);
      existing = rows.find((r) => String(r.card_id || "") === cardId);
      accountId = existing?._accountId ?? null;
    }
    const existingRowId = existing ? rowId(existing) : null;
    if (!existing || existingRowId == null || accountId == null) {
      return res.status(404).json({ error: "Card not found" });
    }
    const nowIso = new Date().toISOString();
    const mapped = mapCardRow(existing, String(tenantId), userId, accountId);
    const payload = toDatatablePayload(
      {
        ...mapped,
        ...(req.body || {}),
        id: cardId,
        limits: { ...mapped.limits, ...(req.body?.limits || {}) },
        walletTokens: { ...mapped.walletTokens, ...(req.body?.walletTokens || {}) },
        createdAt: mapped.createdAt || nowIso,
        updatedAt: nowIso,
      },
      nowIso
    );
    const response = await updateDatatableRow(CARDS_DATATABLE, accountId, existingRowId, tenantId, payload);
    if ((response as any)?.error) {
      return res.status(502).json({ error: "Failed to update card", details: (response as any).message });
    }
    return res.json({
      ok: true,
      card: mapCardRow({ ...existing, ...payload, id: existingRowId }, String(tenantId), userId, accountId),
    });
  } catch (err) {
    logger.error("Error updating account card", { error: err });
    return res.status(500).json({ error: "Failed to update card" });
  }
});
