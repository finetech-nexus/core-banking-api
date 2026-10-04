import { makeRequest } from "../middlewares/fineractRequest";
import { getClients } from "./fineractClient";
import { getAccounts } from "./fineractAccount";
import { getFineractAccessToken } from "./keycloak-admin";
import { logger } from "../logger";

/** Multi-row datatables attached to m_savings_account (appear as tabs on the savings account). */
export const BENEFICIARIES_DATATABLE = "beneficiaries";
export const CARDS_DATATABLE = "cards";

async function fineractAuth(): Promise<string> {
  const token = await getFineractAccessToken();
  return `Bearer ${token}`;
}

export async function resolveClientId(userId: string, tenantId: string): Promise<number | null> {
  const clients = await getClients(userId, tenantId);
  if (!Array.isArray(clients) || clients.length !== 1) return null;
  return Number(clients[0].id);
}

/** Savings account ids owned by the user (Fineract client). */
export async function listOwnedAccountIds(userId: string, tenantId: string): Promise<number[]> {
  const clientId = await resolveClientId(userId, tenantId);
  if (clientId == null) return [];
  const accounts = await getAccounts(String(clientId), tenantId);
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((a: any) => Number(a.id ?? a.accountId))
    .filter((id: number) => Number.isFinite(id) && id > 0);
}

/** Resolve + authorize a savings account id for the authenticated user. */
export async function resolveOwnedAccountId(
  userId: string,
  tenantId: string,
  accountId: string | number | undefined | null
): Promise<number | null> {
  const wanted = Number(accountId);
  if (!Number.isFinite(wanted) || wanted <= 0) return null;
  const owned = await listOwnedAccountIds(userId, tenantId);
  return owned.includes(wanted) ? wanted : null;
}

/** Prefer explicit accountId; else first owned savings account. */
export async function resolveDefaultAccountId(
  userId: string,
  tenantId: string,
  accountId?: string | number | null
): Promise<number | null> {
  if (accountId != null && String(accountId).trim()) {
    return resolveOwnedAccountId(userId, tenantId, accountId);
  }
  const owned = await listOwnedAccountIds(userId, tenantId);
  return owned[0] ?? null;
}

/** Normalize Fineract datatable GET (named objects or genericResultSet rows). */
export function normalizeDatatableRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as { data?: unknown[]; columnHeaders?: { columnName?: string }[] };
  if (!Array.isArray(obj.data)) return [];
  const headers = Array.isArray(obj.columnHeaders)
    ? obj.columnHeaders.map((h) => String(h?.columnName || ""))
    : [];
  return obj.data.map((entry: any) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry.row) && !Array.isArray(entry)) {
      return entry as Record<string, unknown>;
    }
    const values = Array.isArray(entry?.row) ? entry.row : Array.isArray(entry) ? entry : [];
    const mapped: Record<string, unknown> = {};
    headers.forEach((name, idx) => {
      if (name) mapped[name] = values[idx];
    });
    return mapped;
  });
}

export async function listDatatableRows(
  table: string,
  apptableId: number,
  tenantId: string
): Promise<Record<string, unknown>[]> {
  const auth = await fineractAuth();
  const response = await makeRequest({
    method: "GET",
    endpoint: `/datatables/${table}/${apptableId}`,
    auth,
    tenant: tenantId,
  });
  if ((response as any)?.error) {
    logger.warn("Datatable list failed", { table, apptableId, message: (response as any).message });
    return [];
  }
  return normalizeDatatableRows(response);
}

/** List rows across every savings account owned by the user. */
export async function listDatatableRowsForUser(
  table: string,
  userId: string,
  tenantId: string,
  accountId?: string | number | null
): Promise<Array<Record<string, unknown> & { _accountId: number }>> {
  if (accountId != null && String(accountId).trim()) {
    const id = await resolveOwnedAccountId(userId, tenantId, accountId);
    if (id == null) return [];
    const rows = await listDatatableRows(table, id, tenantId);
    return rows.map((r) => ({ ...r, _accountId: id }));
  }
  const owned = await listOwnedAccountIds(userId, tenantId);
  const nested = await Promise.all(
    owned.map(async (id) => {
      const rows = await listDatatableRows(table, id, tenantId);
      return rows.map((r) => ({ ...r, _accountId: id }));
    })
  );
  return nested.flat();
}

export async function insertDatatableRow(
  table: string,
  apptableId: number,
  tenantId: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const auth = await fineractAuth();
  return makeRequest({
    method: "POST",
    endpoint: `/datatables/${table}/${apptableId}`,
    data,
    auth,
    tenant: tenantId,
  });
}

export async function updateDatatableRow(
  table: string,
  apptableId: number,
  rowIdValue: string | number,
  tenantId: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const auth = await fineractAuth();
  return makeRequest({
    method: "PUT",
    endpoint: `/datatables/${table}/${apptableId}/${rowIdValue}`,
    data,
    auth,
    tenant: tenantId,
  });
}

export async function deleteDatatableRow(
  table: string,
  apptableId: number,
  rowIdValue: string | number,
  tenantId: string
): Promise<unknown> {
  const auth = await fineractAuth();
  return makeRequest({
    method: "DELETE",
    endpoint: `/datatables/${table}/${apptableId}/${rowIdValue}`,
    auth,
    tenant: tenantId,
  });
}

export function rowId(row: Record<string, unknown>): string | number | null {
  const id = row.id ?? row.Id ?? row.ID;
  if (id == null || id === "") return null;
  return id as string | number;
}
