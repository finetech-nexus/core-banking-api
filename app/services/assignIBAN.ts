// assignIBAN.ts
import { makeRequest } from './fineractRequest';

export async function assignIBAN(accountId: number, iban: string, auth: string, tenant?: string) {
  const resp = await makeRequest({
    method: 'POST',
    endpoint: `/savingsaccounts/${accountId}/assign-iban`,
    data: { iban },
    auth,
    tenant
  });

  if ((resp as any).error) {
    throw new Error(`Failed to assign IBAN: ${(resp as any).message}`);
  }

  console.log(`Virtual IBAN ${iban} assigned to account ${accountId}`);
  return resp;
}

export async function generateRandomNumber(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

// Convert letters to numbers (A=10, B=11, ..., Z=35)
export async function lettersToNumbers(str: string): string {
  return str.toUpperCase().split('').map(ch => {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      return (code - 55).toString(); // A=10, B=11, ..., Z=35
    }
    return ch;
  }).join('');
}

// Compute check digits using MOD97
export async function computeCheckDigits(countryCode: string, bban: string): string {
  const rearranged = bban + lettersToNumbers(countryCode) + '00';
  const mod = BigInt(rearranged) % 97n;
  const checkDigits = 98n - mod;
  return checkDigits.toString().padStart(2, '0');
}

// Generate Tunisian IBAN
export function generateTunisianIBAN(bankCode?: string, accountNumber?: string): string {
  const countryCode = 'TN';
  const bban = (bankCode || generateRandomNumber(8)) + (accountNumber || generateRandomNumber(12));
  const checkDigits = computeCheckDigits(countryCode, bban);
  return `${countryCode}${checkDigits}${bban}`;
}