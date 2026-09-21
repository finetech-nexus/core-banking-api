import fs from "fs";
import path from "path";
import { logger } from "../logger";

export type PendingExchange = {
  workflowRuntimeId: string;
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  fromAccountNo: string;
  toAccountNo?: string;
  amount: number;
  toAmount: number;
  rate: number;
  fromCurrency: string;
  toCurrency: string;
  holdTransactionId: string;
  toTenantId?: string;
  settleCallbackUrl?: string;
  note?: string;
  createdAt: string;
};

const FILE =
  process.env.PENDING_FX_FILE ||
  path.join(process.cwd(), "data", "pending-exchanges.json");

function loadAll(): Record<string, PendingExchange> {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err: any) {
    logger.warn("Could not read pending FX store", { message: err?.message });
    return {};
  }
}

function saveAll(data: Record<string, PendingExchange>) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

export function savePendingExchange(entry: PendingExchange) {
  const all = loadAll();
  all[entry.workflowRuntimeId] = entry;
  saveAll(all);
}

export function getPendingExchange(workflowRuntimeId: string): PendingExchange | null {
  if (!workflowRuntimeId) return null;
  return loadAll()[workflowRuntimeId] || null;
}

export function removePendingExchange(workflowRuntimeId: string) {
  const all = loadAll();
  delete all[workflowRuntimeId];
  saveAll(all);
}

export function isTunisiaOutboundFx(fromCurrency: string, toCurrency: string): boolean {
  const deploy = String(process.env.TENANT || process.env.COUNTRY_CODE || "").toLowerCase();
  const isTn = deploy === "tn" || deploy === "tunisia";
  const from = String(fromCurrency || "").toUpperCase();
  const to = String(toCurrency || "").toUpperCase();
  return isTn && from === "TND" && !!to && to !== "TND";
}
