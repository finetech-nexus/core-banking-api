import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { logger } from "../logger";
import {
  BENEFICIARIES_DATATABLE,
  deleteDatatableRow,
  insertDatatableRow,
  listDatatableRowsForUser,
  resolveDefaultAccountId,
  resolveOwnedAccountId,
  rowId,
  updateDatatableRow,
} from "../services/clientDatatable";
import { checkBeneficiary } from "../services/beneficiaryCheck";
import { fineractClientIdForUser, notifyBeneficiaryAdded } from "../services/marbleNotify";

export const route = Router();

const BENEFICIARY_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "username",
  "iban",
  "swift",
  "bankName",
  "country",
  "type",
  "status",
] as const;

function beneficiaryPayload(body: Record<string, unknown> | undefined) {
  const source = body || {};
  const data: Record<string, unknown> = {};
  const clearable = new Set(["phone", "email", "username", "country"]);
  for (const key of BENEFICIARY_FIELDS) {
    if (source[key] === "" && clearable.has(key)) {
      data[key] = "";
      continue;
    }
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      data[key] = source[key];
    }
  }
  return data;
}

async function writeRow(
  method: "insert" | "update",
  accountId: number,
  tenantId: string,
  data: Record<string, unknown>,
  rowIdValue?: string | number
) {
  const call = (payload: Record<string, unknown>) =>
    method === "insert"
      ? insertDatatableRow(BENEFICIARIES_DATATABLE, accountId, tenantId, payload)
      : updateDatatableRow(BENEFICIARIES_DATATABLE, accountId, rowIdValue as string | number, tenantId, payload);
  let response = await call(data);
  const message = JSON.stringify((response as any)?.message || (response as any)?.error || "");
  if ((response as any)?.error && /bankName/i.test(message)) {
    const { bankName: _bankName, ...withoutBank } = data;
    response = await call(withoutBank);
  }
  return response;
}

async function findOwnedRow(userId: string, tenantId: string, id: string, hinted: unknown) {
  if (hinted != null && String(hinted).trim()) {
    const accountId = await resolveOwnedAccountId(userId, tenantId, hinted as string | number);
    if (accountId == null) return null;
    const rows = await listDatatableRowsForUser(BENEFICIARIES_DATATABLE, userId, tenantId, accountId);
    const match = rows.find((r) => String(rowId(r) ?? "") === String(id));
    return match ? { accountId, row: match } : null;
  }
  const rows = await listDatatableRowsForUser(BENEFICIARIES_DATATABLE, userId, tenantId);
  const match = rows.find((r) => String(rowId(r) ?? "") === String(id));
  if (!match?._accountId) return null;
  return { accountId: match._accountId, row: match };
}

/**
 * @swagger
 * /beneficiaries:
 *   post:
 *     summary: Add a beneficiary on a savings account (datatable beneficiaries)
 *     tags:
 *       - Beneficiaries
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  logger.debug("POST /beneficiary → beneficiaries", { userId, tenantId });
  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  try {
    const accountId = await resolveDefaultAccountId(
      userId,
      tenantId,
      req.body?.accountId ?? req.body?.savingsAccountId ?? req.query.accountId
    );
    if (accountId == null) {
      return res.status(400).json({ error: "accountId is required and must belong to the user" });
    }
    const data = beneficiaryPayload(req.body);
    const response = await writeRow("insert", accountId, tenantId, data);
    if ((response as any)?.error) {
      logger.error("Beneficiary insert failed", { message: (response as any).message });
      return res.status(502).json({ error: "Failed to add beneficiary", details: (response as any).message });
    }
    const beneficiaryId = String((response as any)?.resourceId ?? (response as any)?.id ?? data.iban ?? "");
    if (beneficiaryId) {
      const customerId = await fineractClientIdForUser(userId, tenantId);
      await notifyBeneficiaryAdded({
        beneficiaryId,
        customerId: customerId || undefined,
        accountId,
        firstName: data.firstName as string | undefined,
        lastName: data.lastName as string | undefined,
        iban: data.iban as string | undefined,
        swift: data.swift as string | undefined,
        country: (data.country as string | undefined) || undefined,
        type: data.type as string | undefined,
      });
    }
    return res.json(response);
  } catch (err) {
    logger.error("Error adding beneficiary", { error: err });
    return res.status(500).json({ error: "Failed to add beneficiary" });
  }
});

/**
 * @swagger
 * /beneficiaries:
 *   get:
 *     summary: List beneficiaries for owned savings accounts
 */
route.get("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  logger.debug("GET /beneficiary → beneficiaries", { userId, tenantId });
  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  try {
    const accountId = req.query.accountId ?? req.query.savingsAccountId;
    const rows = await listDatatableRowsForUser(BENEFICIARIES_DATATABLE, userId, tenantId, accountId);
    // Keep mobile-compatible array of named rows (plus accountId for multi-account).
    const data = rows.map((r) => {
      const { _accountId, ...rest } = r;
      return { ...rest, accountId: String(_accountId) };
    });
    return res.json(data);
  } catch (err) {
    logger.error("Error listing beneficiaries", { error: err });
    return res.status(500).json({ error: "Failed to list beneficiaries" });
  }
});

/**
 * @swagger
 * /beneficiary/check:
 *   get:
 *     summary: Validate a beneficiary before it is saved
 *     description: Local IBAN, international IBAN and SWIFT, or a Nexus party registered on the payment hub.
 */
route.get("/check", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  try {
    const result = await checkBeneficiary(tenantId, req.query || {});
    return res.json(result);
  } catch (err) {
    logger.error("Error checking beneficiary", { error: err });
    return res.status(200).json({
      ok: false,
      party: { ok: false, reason: "unavailable" },
    });
  }
});

route.put("/:id", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const id = req.params.id;
  logger.debug("PUT /beneficiary → beneficiaries", { userId, tenantId, id });
  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  try {
    const found = await findOwnedRow(userId, tenantId, id, req.body?.accountId ?? req.query.accountId);
    if (!found) return res.status(404).json({ error: "Beneficiary not found" });
    const data = { ...beneficiaryPayload(found.row), ...beneficiaryPayload(req.body) };
    const response = await writeRow("update", found.accountId, tenantId, data, rowId(found.row) ?? id);
    if ((response as any)?.error) {
      return res.status(502).json({ error: "Failed to update beneficiary", details: (response as any).message });
    }
    return res.json({ ...(response as Record<string, unknown>), id, accountId: String(found.accountId) });
  } catch (err) {
    logger.error("Error updating beneficiary", { error: err });
    return res.status(500).json({ error: "Failed to update beneficiary" });
  }
});

route.delete("/:id", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const id = req.params.id;
  logger.debug("DELETE /beneficiary → beneficiaries", { userId, tenantId, id });
  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  try {
    const hinted = req.query.accountId ?? req.body?.accountId;
    if (hinted != null) {
      const accountId = await resolveOwnedAccountId(userId, tenantId, hinted);
      if (accountId == null) return res.status(404).json({ error: "Account not found" });
      const response = await deleteDatatableRow(BENEFICIARIES_DATATABLE, accountId, id, tenantId);
      if ((response as any)?.error) {
        return res.status(502).json({ error: "Failed to delete beneficiary", details: (response as any).message });
      }
      return res.json(response);
    }
    const rows = await listDatatableRowsForUser(BENEFICIARIES_DATATABLE, userId, tenantId);
    const match = rows.find((r) => String(rowId(r) ?? "") === String(id));
    if (!match?._accountId) {
      return res.status(404).json({ error: "Beneficiary not found" });
    }
    const response = await deleteDatatableRow(BENEFICIARIES_DATATABLE, match._accountId, id, tenantId);
    if ((response as any)?.error) {
      return res.status(502).json({ error: "Failed to delete beneficiary", details: (response as any).message });
    }
    return res.json(response);
  } catch (err) {
    logger.error("Error delete beneficiary", { error: err });
    return res.status(500).json({ error: "Failed to delete beneficiary" });
  }
});
