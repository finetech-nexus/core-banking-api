// assignIBAN.ts
import { makeRequest } from "../middlewares/fineractRequest";
import { logger } from "../logger";

export async function createIBANTable(auth: string, tenant?: string) {
  logger.debug("Call datatables");
  const response = await makeRequest({
    method: 'POST',
    endpoint: `/datatables/`,
    data: { name :'iban', type: 'String', length:'34', mandatory:'true', unique: 'true' },
    auth,
    tenant
  });
  logger.debug("IBAN table creation OK");
  return response;
}

export async function assignIBAN(accountId: number, iban: string, auth: string, tenant?: string) {
  logger.debug("Call Assign IBAN", { accountId });
  const response = await makeRequest({
    method: 'POST',
    endpoint: `/datatables/savings_iban/${accountId}`,
    data: { iban },
    auth,
    tenant
  });
  if ((response as any).error) {
    logger.error("Error POST /datatables/savings_iban", { accountId, message: (response as any).message });
    throw response;
  }
  logger.info("Virtual IBAN assigned", { accountId, iban });
  return response;
}

export   function generateRandomNumber(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

// Convert letters to numbers (A=10, B=11, ..., Z=35)
export   function lettersToNumbers(str: string): string {
  return str.toUpperCase().split('').map(ch => {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      return (code - 55).toString(); // A=10, B=11, ..., Z=35
    }
    return ch;
  }).join('');
}

 

// TODO: pass the accountNumber after account creation with apdate, actually random accountNumber
export function generateIBAN(accountNumber?: string): string {
  const bankCode = String(process.env.BANK_CODE);   // always string
  const countryCode = String(process.env.COUNTRY_CODE).toUpperCase(); // TN, always uppercase
  const ACCOUNT_LENGTH = 12;

  if (!bankCode || !countryCode) {
    throw new Error("BANK_CODE and COUNTRY_CODE are required");
  }

  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("COUNTRY_CODE must be a valid 2-letter ISO code");
  }

  // Normalize account number (digits only)
  const cleanAccount = accountNumber?.replace(/\D/g, "") || "";

  // If account number is empty, generate 12 random digits
  const finalAccount =
    cleanAccount.length > 0
      ? cleanAccount.padStart(ACCOUNT_LENGTH, "0")
      : Array.from({ length: ACCOUNT_LENGTH }, () => Math.floor(Math.random() * 10)).join("");

  // Bank code + account number. A Tunisian BBAN is a 20-digit RIB whose last two digits are the key.
  let bban = bankCode + finalAccount;
  if (countryCode === "TN") {
    const digits = bban.replace(/\D/g, "");
    if (digits.length >= 18) {
      const body = digits.slice(0, 18);
      const key = 97n - (BigInt(body + "00") % 97n);
      bban = body + key.toString().padStart(2, "0");
    }
  }

  // Convert letters A-Z to numbers 10-35
  const lettersToNumbers = (str: string): string =>
    str.replace(/[A-Z]/gi, (ch) => (ch.toUpperCase().charCodeAt(0) - 55).toString());

  // Compute MOD97 check digits
  const computeCheckDigits = (country: string, bban: string): string => {
    const rearranged = bban + lettersToNumbers(country) + "00";
    let remainder = 0;

    // Process in chunks to avoid big numbers
    for (let i = 0; i < rearranged.length; i += 9) {
      const block = String(remainder) + rearranged.substring(i, i + 9);
      remainder = parseInt(block, 10) % 97;
    }

    return String(98 - remainder).padStart(2, "0");
  };

  const checkDigits = computeCheckDigits(countryCode, bban);

  const iban = countryCode + checkDigits + bban;
  logger.debug("IBAN generated", { countryCode, checkDigits, bankCode, finalAccount, bban });
  return iban.toString();
}




