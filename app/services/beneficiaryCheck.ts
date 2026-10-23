import { makeRequest } from "../middlewares/fineractRequest";
import { getFineractAccessToken } from "./keycloak-admin";

/** ISO 13616 IBAN length by country. Countries without IBAN are omitted. */
const IBAN_LENGTHS: Record<string, number> = {
  AE: 23, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IT: 27, LT: 20,
  LU: 20, LV: 21, MA: 28, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SA: 24,
  SE: 24, SI: 19, SK: 24, TN: 24, TR: 26,
};

/** Tunisian RIB bank code (first two digits) → commercial name. */
const TN_BANKS: Record<string, string> = {
  "01": "Banque Nationale Agricole",
  "02": "Société Tunisienne de Banque",
  "03": "Banque de l'Habitat",
  "04": "Banque de Tunisie",
  "05": "Amen Bank",
  "07": "Attijari Bank",
  "08": "Banque Internationale Arabe de Tunisie",
  "11": "Union Internationale de Banques",
  "12": "Arab Tunisian Bank",
  "17": "Banque Tuniso-Libyenne",
  "20": "Banque de Tunisie et des Emirats",
  "21": "Tunisian Saudi Bank",
  "23": "QNB Tunisie",
  "24": "Banque Tuniso-Koweïtienne",
  "25": "Banque Zitouna",
  "26": "Banque de Financement des PME",
  "28": "Al Baraka Bank",
  "47": "Wifak Bank",
};

/** BIC (8 characters, branch ignored) → bank name. */
const BIC_BANKS: Record<string, string> = {
  BIATTNTT: "Banque Internationale Arabe de Tunisie",
  BSTUTNTT: "Attijari Bank",
  ABCOTNTT: "Amen Bank",
  BHBKTNTT: "Banque de l'Habitat",
  BTDTTNTT: "Banque de Tunisie",
  BTUNTNTT: "Banque de Tunisie",
  BNTETNTT: "Banque Nationale Agricole",
  STBKTNTT: "Société Tunisienne de Banque",
  UIBKTNTT: "Union Internationale de Banques",
  CFCTTNTT: "Arab Tunisian Bank",
  BZITTNTT: "Banque Zitouna",
  BEITTNTT: "Banque de Tunisie et des Emirats",
  TSIDTNTT: "Tunisian Saudi Bank",
  BTLITNTT: "Banque Tuniso-Libyenne",
  BNPAFRPP: "BNP Paribas",
  SOGEFRPP: "Société Générale",
  AGRIFRPP: "Crédit Agricole",
  CRLYFRPP: "LCL",
  CEPAFRPP: "Caisse d'Épargne",
  CMCIFRPP: "CIC",
  PSSTFRPP: "La Banque Postale",
  DEUTDEFF: "Deutsche Bank",
  COBADEFF: "Commerzbank",
  DRESDEFF: "Commerzbank",
  BARCGB22: "Barclays",
  NWBKGB2L: "NatWest",
  LOYDGB2L: "Lloyds Bank",
  HBUKGB4B: "HSBC",
  MIDLGB22: "HSBC",
  CHASUS33: "JPMorgan Chase",
  BOFAUS3N: "Bank of America",
  CITIUS33: "Citibank",
  WFBIUS6S: "Wells Fargo",
  UNCRITMM: "UniCredit",
  BCITITMM: "Intesa Sanpaolo",
  BSCHESMM: "Banco Santander",
  CAIXESBB: "CaixaBank",
  BBVAESMM: "BBVA",
  QNBAQAAQ: "QNB",
};

export type CheckFlag = {
  ok: boolean;
  reason?: string;
  bankName?: string;
  accountId?: string;
  /** Canonical value, such as the TN IBAN built from a RIB. */
  value?: string;
};

export type BeneficiaryCheckResult = {
  ok: boolean;
  bankName?: string;
  iban?: CheckFlag;
  swift?: CheckFlag;
  party?: CheckFlag;
};

export function compactId(value: unknown): string {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

export function isValidIban(value: unknown): boolean {
  const compact = compactId(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  const expected = IBAN_LENGTHS[compact.slice(0, 2)];
  if (expected && compact.length !== expected) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    numeric += ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Tunisian RIB key: 97 − (first 18 digits + "00") mod 97. */
export function isValidTunisianRib(rib: string): boolean {
  if (!/^\d{20}$/.test(rib)) return false;
  const body = BigInt(rib.slice(0, 18) + "00");
  const key = Number(rib.slice(18));
  const expected = 97 - Number(body % 97n);
  return key === expected;
}

/** TN IBAN check digits for a 20-digit RIB. Returns undefined when the RIB key is wrong. */
export function tunisianIbanFromRib(rib: string): string | undefined {
  if (!isValidTunisianRib(rib)) return undefined;
  let remainder = 0;
  for (const digit of rib + "292300") {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return `TN${String(98 - remainder).padStart(2, "0")}${rib}`;
}

export function tunisianBankName(iban: string): string | undefined {
  const compact = compactId(iban);
  if (!compact.startsWith("TN") || compact.length < 6) return undefined;
  return TN_BANKS[compact.slice(4, 6)];
}

export function isValidBic(value: unknown): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compactId(value));
}

export function bicBankName(value: unknown): string | undefined {
  const bic = compactId(value);
  if (!isValidBic(bic)) return undefined;
  return BIC_BANKS[bic.slice(0, 8)] || BIC_BANKS[bic];
}

export function bicCountry(value: unknown): string | undefined {
  const bic = compactId(value);
  return isValidBic(bic) ? bic.slice(4, 6) : undefined;
}

function ibanCheck(raw: unknown, localOnly: boolean): CheckFlag {
  const compact = compactId(raw);
  const fromRib = /^\d{20}$/.test(compact) ? tunisianIbanFromRib(compact) : undefined;
  const iban = fromRib || compact;
  if (!iban) return { ok: false, reason: "invalid" };
  if (localOnly && !fromRib && !iban.startsWith("TN")) return { ok: false, reason: "not_local" };
  if (!isValidIban(iban)) return { ok: false, reason: "checksum" };
  if (iban.startsWith("TN") && !isValidTunisianRib(iban.slice(4))) {
    return { ok: false, reason: "checksum" };
  }
  return { ok: true, reason: "ok", bankName: tunisianBankName(iban), value: iban };
}

function swiftCheck(raw: unknown, iban: string): CheckFlag {
  const bic = compactId(raw);
  if (!isValidBic(bic)) return { ok: false, reason: "invalid" };
  const country = bicCountry(bic);
  if (iban.length >= 2 && country && country !== iban.slice(0, 2)) {
    return { ok: false, reason: "country_mismatch" };
  }
  return { ok: true, reason: "ok", bankName: bicBankName(bic) };
}

async function partyExists(tenantId: string, idType: string, idValue: string): Promise<CheckFlag> {
  const token = await getFineractAccessToken();
  const response = await makeRequest({
    method: "GET",
    endpoint: `/interoperation/parties/${idType}/${encodeURIComponent(idValue)}`,
    auth: `Bearer ${token}`,
    tenant: tenantId,
  });
  if ((response as any)?.error) {
    const status = Number((response as any).status || 0);
    return { ok: false, reason: status === 404 ? "not_found" : "unavailable" };
  }
  const accountId = (response as any)?.accountId;
  if (!accountId) return { ok: false, reason: "not_found" };
  return { ok: true, reason: "ok", accountId: String(accountId) };
}

export async function checkBeneficiary(
  tenantId: string,
  query: Record<string, unknown>
): Promise<BeneficiaryCheckResult> {
  const type = String(query.type || "").trim().toLowerCase();
  const iban = compactId(query.iban);

  if (type === "bank" || type === "local") {
    const ibanFlag = ibanCheck(query.iban, true);
    return { ok: ibanFlag.ok, bankName: ibanFlag.bankName, iban: ibanFlag };
  }

  if (type === "international") {
    const ibanFlag = ibanCheck(query.iban, false);
    const swiftFlag = swiftCheck(query.swift, ibanFlag.ok ? iban : "");
    const bankName = swiftFlag.bankName || ibanFlag.bankName;
    return {
      ok: ibanFlag.ok && swiftFlag.ok,
      bankName,
      iban: ibanFlag,
      swift: { ...swiftFlag, bankName: swiftFlag.bankName || bankName },
    };
  }

  const phone = String(query.phone || "").replace(/[\s.-]/g, "");
  const email = String(query.email || "").trim().toLowerCase();
  const username = String(query.username || "").trim().replace(/^@/, "");
  let idType = "";
  let idValue = "";
  if (phone) {
    idType = "MSISDN";
    idValue = phone.replace(/^\+/, "");
  } else if (email) {
    idType = "EMAIL";
    idValue = email;
  } else if (username) {
    idType = "ALIAS";
    idValue = username;
  }
  if (!idType || !idValue) {
    return { ok: false, party: { ok: false, reason: "not_found" } };
  }
  const party = await partyExists(tenantId, idType, idValue);
  return { ok: party.ok, party };
}
