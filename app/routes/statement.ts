import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { getClients } from "../services/fineractClient";
import { getAccounts, getTransactions, parseFineractDate } from "../services/fineractAccount";
import { logger } from "../logger";

export const route = Router();

async function findOwnedSavings(userId: string, savingsAccountId: string, tenantId: string) {
  const clients = await getClients(userId, tenantId);
  if (!Array.isArray(clients) || clients.length === 0) return null;
  for (const client of clients) {
    const accounts = await getAccounts(String(client.id), tenantId);
    const account = (accounts || []).find((a: any) => String(a.id) === String(savingsAccountId));
    if (account) return { client, account };
  }
  return null;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function isDebit(t: any): boolean {
  const type = t?.transactionType || {};
  if (type.withdrawal === true) return true;
  if (type.deposit === true) return false;
  const value = String(type.value || t?.entryType || "").toUpperCase();
  return value.includes("WITHDRAW") || value === "DEBIT";
}

function lineTitle(t: any): string {
  const note = typeof t?.note === "string" ? t.note.trim() : "";
  if (note) {
    try {
      const parsed = JSON.parse(note);
      if (parsed && typeof parsed === "object") {
        return String(parsed.payee || parsed.payer || parsed.note || note);
      }
    } catch {}
    return note;
  }
  return String(t?.transactionType?.value || "Transaction");
}

route.get("/", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const accountId = String(req.query.accountId || req.query.savingsAccountId || "").trim();

  if (!tenantId) return res.status(400).json({ error: "Missing Fineract headers" });
  if (!userId) return res.status(401).json({ error: "invalid user from token" });
  if (!accountId) return res.status(400).json({ error: "accountId is required" });

  const now = new Date();
  const fromDate = parseFineractDate(req.query.from) || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const toDate = parseFineractDate(req.query.to) || now;
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    const owned = await findOwnedSavings(userId, accountId, tenantId);
    if (!owned) return res.status(404).json({ error: "Savings account not found" });

    const raw = await getTransactions(accountId, tenantId);
    const mapped = (Array.isArray(raw) ? raw : [])
      .filter((t: any) => !t?.reversed)
      .map((t: any) => {
        const date = parseFineractDate(t.date) || parseFineractDate(t.submittedOnDate);
        const debit = isDebit(t);
        const amountAbs = Math.abs(Number(t.amount) || 0);
        return {
          id: String(t.id),
          date,
          title: lineTitle(t),
          type: String(t.transactionType?.value || (debit ? "Debit" : "Credit")),
          amount: debit ? -amountAbs : amountAbs,
          balance: Number.isFinite(Number(t.runningBalance)) ? Number(t.runningBalance) : undefined,
        };
      })
      .filter((t) => t.date && t.date >= from && t.date <= to)
      .sort((a, b) => {
        const dt = a.date!.getTime() - b.date!.getTime();
        return dt !== 0 ? dt : Number(a.id) - Number(b.id);
      });

    const first = mapped[0];
    const last = mapped[mapped.length - 1];
    const openingBalance =
      first?.balance != null ? Number((first.balance - first.amount).toFixed(2)) : 0;
    const closingBalance =
      last?.balance != null
        ? Number(last.balance)
        : Number(owned.account.accountBalance || owned.account.summary?.accountBalance || 0);

    return res.json({
      accountId: String(owned.account.id),
      accountName: owned.account.accountNo || String(owned.account.id),
      iban: owned.account.externalId || "",
      currency: owned.account.currency?.code || owned.account.currency || "",
      clientName: owned.client.displayName || owned.client.accountNo || "",
      from: ymd(from),
      to: ymd(to),
      openingBalance,
      closingBalance,
      transactions: mapped.map((t) => ({
        id: t.id,
        date: t.date!.toISOString(),
        title: t.title,
        type: t.type,
        amount: t.amount,
        balance: t.balance,
      })),
    });
  } catch (err: any) {
    logger.error("GET /statement failed", { userId, accountId, message: err?.message });
    return res.status(500).json({ error: "Could not build statement", details: err?.message });
  }
});
