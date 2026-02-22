// onboarding.ts
import { createSavingsAccountWithPolling } from "./fineractAccount";
import { createClient } from "./fineractClient";
import { partyRegistration } from "./paymentService";
import { generateIBAN } from "./assignIBAN";
import { getFineractAccessToken } from "./keycloak-admin";
import { logger } from "../logger";

const authToken = 'Basic ' + Buffer.from('admin:password').toString('base64');

interface OnboardingParams {
  gender: string;
  firstName: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
  phone: string;
  email: string;
  nationality: string;
  externalId: string;
  officeId: number;
  address: string;
  postalCode: string;
  city: string;
  country:string;
  savingsProductId: number; 
}


export async function onboardUser(params: OnboardingParams) {
  try {
    const { gender, firstName, lastName, dob, phone,email, nationality, externalId, officeId, address, postalCode , city, country, savingsProductId } = params;
    
    const client = { gender, firstName, lastName, dob, phone, email, nationality, externalId, officeId, address, postalCode, city, country };
    const token = await getFineractAccessToken();
    const authToken = "Bearer " + token;
    logger.debug("Creating client");
    const clientId = await createClient(client, authToken);
    logger.info("Client created", { clientId });

    // 2. Generate virtual IBAN (you can use bank code as needed)
    const virtualIBAN = generateIBAN('');
    // 3. Create savings account and wait until active
    const account = await createSavingsAccountWithPolling(clientId, savingsProductId, virtualIBAN, authToken);
    const accountId = account.id;
    const accountNo = account.accountNo;
    logger.info("Savings account active", { accountId });

    // 4. Assign virtual IBAN
    //await assignIBAN(accountId, virtualIBAN, authToken);

    // 5.PartyRegistration 
    //MSISDN, EMAIL, PERSONAL_ID, BUSINESS, DEVICE, ACCOUNT_ID, IBAN, ALIAS;
    await partyRegistration(accountNo, 'IBAN', virtualIBAN );
    await partyRegistration(accountNo, "EMAIL", email);
    await partyRegistration(accountNo, "MSISDN", phone);

    logger.info("User onboarding completed", { clientId, accountId, virtualIBAN });
    return { clientId, accountId, virtualIBAN };
  } catch (err) {
    logger.error("Onboarding failed", { err });
    throw err;
  }
}








// sensitiveActions.ts
/*

export async function performTopUp(userId: string, accountId: number, amount: number, stepUp: StepUpAuthRequest, auth: string, tenant?: string) {
  // 1. Verify step-up authentication
  const authorized = verifyStepUpAuth(stepUp);
  if (!authorized) throw new Error('Step-up authentication failed. Cannot perform top-up.');

  // 2. Perform top-up via Fineract
  const response = await makeRequest({
    method: 'POST',
    endpoint: `/savingsaccounts/${accountId}/transactions`,
    data: {
      transactionType: 'deposit',
      amount,
      date: new Date().toISOString().split('T')[0],
      paymentTypeId: 1 // e.g., 1 = cash / bank transfer
    },
    auth,
    tenant
  });

  if ((response as any).error) {
    throw new Error(`Top-up failed: ${(response as any).message}`);
  }

  return response;
}

*/