import { logger } from "../logger";

const DEFAULT_RATES: Record<string, number> = {
  EUR_TND: 3.32,
  TND_EUR: 0.3012,
  EUR_USD: 1.08,
  USD_EUR: 0.926,
  TND_USD: 0.325,
  USD_TND: 3.08,
};

function pairKey(from: string, to: string): string {
  return `${from.toUpperCase()}_${to.toUpperCase()}`;
}

function loadConfiguredRates(): Record<string, number> {
  const raw = process.env.EXCHANGE_RATES;
  if (!raw) return { ...DEFAULT_RATES };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, number> = { ...DEFAULT_RATES };
      for (const [key, value] of Object.entries(parsed)) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) out[key.toUpperCase()] = n;
      }
      return out;
    }
  } catch (err) {
    logger.warn("EXCHANGE_RATES is not valid JSON; using defaults", {
      message: (err as Error)?.message,
    });
  }
  return { ...DEFAULT_RATES };
}

export function getQuoteRate(fromCurrency: string, toCurrency: string): number {
  const from = (fromCurrency || "").toUpperCase();
  const to = (toCurrency || "").toUpperCase();
  if (!from || !to) return 0;
  if (from === to) return 1;
  const rates = loadConfiguredRates();
  const direct = rates[pairKey(from, to)];
  if (Number.isFinite(direct) && direct > 0) return direct;
  const inverse = rates[pairKey(to, from)];
  if (Number.isFinite(inverse) && inverse > 0) return 1 / inverse;
  return 0;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}
