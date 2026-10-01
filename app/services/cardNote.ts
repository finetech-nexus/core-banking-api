export type CardNoteInput = {
  cardId: string;
  last4: string;
  scheme?: string;
  merchant: string;
  authId?: string;
};

export type ParsedCardNote = CardNoteInput & {
  type: "card";
  payee: string;
  note: string;
};

function cardLabel(input: Pick<CardNoteInput, "scheme" | "last4">): string {
  const scheme = String(input.scheme || "CARD").trim() || "CARD";
  const last4 = String(input.last4 || "").replace(/\D/g, "").slice(-4);
  return last4 ? `${scheme} •••• ${last4}` : scheme;
}

/** Fineract savings `note`: JSON so home + card history can show merchant and filter by cardId. */
export function cardLedgerNote(input: CardNoteInput): string {
  const merchant = String(input.merchant || "").trim() || "Card payment";
  const label = cardLabel(input);
  return JSON.stringify({
    type: "card",
    cardId: String(input.cardId || "").trim(),
    last4: String(input.last4 || "").replace(/\D/g, "").slice(-4),
    scheme: input.scheme ? String(input.scheme).toUpperCase() : undefined,
    authId: input.authId ? String(input.authId).trim() : undefined,
    payee: merchant,
    payer: merchant,
    note: label,
    merchant,
  });
}

export function parseCardNote(raw: unknown): ParsedCardNote | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (String(parsed.type || "").toLowerCase() !== "card") return null;
    const cardId = String(parsed.cardId || "").trim();
    if (!cardId) return null;
    return {
      type: "card",
      cardId,
      last4: String(parsed.last4 || "").replace(/\D/g, "").slice(-4),
      scheme: parsed.scheme ? String(parsed.scheme).toUpperCase() : undefined,
      authId: parsed.authId ? String(parsed.authId).trim() : undefined,
      merchant: String(parsed.merchant || parsed.payee || "Card payment"),
      payee: String(parsed.payee || parsed.merchant || "Card payment"),
      note: String(parsed.note || cardLabel(parsed)),
    };
  } catch {
    return null;
  }
}
