export type FxNoteInput = {
  fromAmount: number;
  fromCurrency: string;
  toAmount: number;
  toCurrency: string;
  rate: number;
  side?: "debit" | "credit" | "hold" | "reversal";
};

function fmt(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(4).replace(/\.?0+$/, "") || "0";
}

export function exchangeLabel(input: FxNoteInput): string {
  const pair = `${fmt(input.fromAmount)} ${input.fromCurrency} → ${fmt(input.toAmount)} ${input.toCurrency} @ ${fmt(input.rate)}`;
  if (input.side === "reversal") return `FX reversal ${pair}`;
  if (input.side === "hold") return `Exchange (hold) ${pair}`;
  return `Exchange ${pair}`;
}

export function exchangeLedgerNote(input: FxNoteInput): string {
  const label = exchangeLabel(input);
  return JSON.stringify({
    payee: label,
    payer: label,
    note: `Rate ${fmt(input.rate)}`,
    type: "exchange",
    fromAmount: input.fromAmount,
    fromCurrency: input.fromCurrency,
    toAmount: input.toAmount,
    toCurrency: input.toCurrency,
    rate: input.rate,
    side: input.side || "debit",
  });
}
