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
} from "../services/clientDatatable";

export const route = Router();

/**
 * @swagger
 * /beneficiaries:
 *   post:
 *     summary: Add a beneficiary on a savings account (datatable beneficiaries_savings)
 *     tags:
 *       - Beneficiaries
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  logger.debug("POST /beneficiary → beneficiaries_savings", { userId, tenantId });
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
    const { accountId: _a, savingsAccountId: _s, ...data } = req.body || {};
    const response = await insertDatatableRow(BENEFICIARIES_DATATABLE, accountId, tenantId, data);
    if ((response as any)?.error) {
      logger.error("Beneficiary insert failed", { message: (response as any).message });
      return res.status(502).json({ error: "Failed to add beneficiary", details: (response as any).message });
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
  logger.debug("GET /beneficiary → beneficiaries_savings", { userId, tenantId });
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

route.delete("/:id", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const id = req.params.id;
  logger.debug("DELETE /beneficiary → beneficiaries_savings", { userId, tenantId, id });
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
