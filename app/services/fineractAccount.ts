// fineractAccountExtended.ts
import { makeRequest } from "../middlewares/fineractRequest";
import { getFineractAccessToken } from "./keycloak-admin";
import { poll } from "./poll";
import { logger } from "../logger";

  



//TODO full account creation
//https://fineract.apache.org/docs/legacy/index.html?savingsaccounts_create
// Create savings account and wait until active
export async function createSavingsAccountWithPolling(
  clientId: number,
  productId: number,
  virtualIBAN: string,
  auth: string,
  tenant?: string
) {
  logger.debug("createSavingsAccountWithPolling", { clientId, productId });
  const response = await makeRequest({
    method: 'POST',
    endpoint: '/savingsaccounts',
    data: {
      clientId,
      productId,
      submittedOnDate: new Date().toISOString().split('T')[0],
      locale: "fr",
      dateFormat: "yyyy-MM-dd",
      externalId: virtualIBAN
    },
    auth,
    tenant
  });

  if ((response as any).error) {
    logger.error("Error POST /savingsaccounts", { clientId, message: (response as any).message });
    throw response;
  }

  const accountId = (response as any).resourceId;
  const account = response;
  const today = new Date().toISOString().split('T')[0];

  // 2. Approve the savings account
  logger.debug("Approve savings account", { accountId });
  await makeRequest({
    method: 'POST',
    endpoint: `/savingsaccounts/${accountId}?command=approve`,
    data: {
      approvedOnDate: today,
      locale: "fr",
      dateFormat: "yyyy-MM-dd"
    },
    auth,
    tenant
  });
  
  // 3. Activate the savings account
  logger.debug("Activate savings account", { accountId });
  await makeRequest({
    method: 'POST',
    endpoint: `/savingsaccounts/${accountId}?command=activate`,
    data: {
      activatedOnDate: today,
      locale: "fr",
      dateFormat: "yyyy-MM-dd"
    },
    auth,
    tenant
  });

  // 4. Poll until account is active
  logger.debug("Polling activation", { accountId });
  const activeAccount = await poll(
    async () => {
      const resp = await makeRequest({
        method: 'GET',
        endpoint: `/savingsaccounts/${accountId}`,
        auth,
        tenant
      });
      return resp;
    },
    (resp) => (resp as any).status?.active === true,
    3000, // poll every 3s
    20    // max 20 attempts (~1 minute)
  );
  logger.info("Savings account active", { accountId });
  return activeAccount;
}

export async function getAccounts(clientId: string, tenantId?: string) {
  // 0. get Fineract token 
  const token = await getFineractAccessToken(); 
  const authToken = 'Bearer ' + token;
  // 1. getAccounts
  const response = await makeRequest({
      method: "GET",
      endpoint: `/clients/${clientId}/accounts?fields=savingsAccounts`,
      auth: authToken,
      tenant: tenantId,
    });
  return  response.savingsAccounts || [];
} 
/**export async function  openAccount(clientId: string, productId?: string, tenantId?: string) {
  // 0. get Fineract token 
  const token = await getFineractAccessToken(); 
  const authToken = 'Bearer ' + token;
  // 1. postAccount
  const payload = {
    clientId: clientId,
    productId: productId,
    submittedOnDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    dateFormat: "yyyy-MM-dd",
    locale: "fr"
  };
  const response = await makeRequest({
      method: "POST",
      endpoint: `/savingsaccounts`,
      data: payload,
      auth: authToken,
      tenant: tenantId,
    });
  //2. approve
  const response1 = await makeRequest({
      method: "POST",
      endpoint: `/savingsaccounts/${response.savingsId}?command=approve`,
      data:  {  
              approvedOnDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
              dateFormat: "yyyy-MM-dd",
              locale: "fr"
              },
      auth: authToken,
      tenant: tenantId,
    });
    //2. approve
  const response2 = await makeRequest({
      method: "POST",
      endpoint: `/savingsaccounts/${response.savingsId}?command=activate`,
      data:  {  
              activatedOnDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
              dateFormat: "yyyy-MM-dd",
              locale: "fr"
              },
      auth: authToken,
      tenant: tenantId,
    });
 
  return  response;
} **/
export async function getTransactions(accountId: string, tenantId?: string) {
  // 0. get Fineract token 
  const token = await getFineractAccessToken(); 
  const authToken = 'Bearer ' + token;
  // 1. getAccounts
  const response = await makeRequest({
      method: "GET",
      endpoint: `/savingsaccounts/${accountId}?associations=transactions`,
      auth: authToken,
      tenant: tenantId,
    });
  return response.transactions || [];
} 


 
/**
 * Credit a savings account with a specified amount
 * @param accountId Fineract savings account ID
 * @param amount Amount to credit (number)
 * @param tenant Fineract tenant ID
 * @param externalId Optional external reference (e.g., Stripe paymentIntent)
 */
export async function creditAccount(
  accountId: string,
  accountNumber: string,
  paymentTypeId: string,
  receiptNumber: string,
  amount: number,
  note: string,
  tenant?: string,
  externalId?: string
) {
  if (!accountNumber || amount <= 0) {
    throw new Error("Invalid accountNumber or amount");
  }

  // 0️⃣ Get Fineract access token
  const token = await getFineractAccessToken();
  const authToken = `Bearer ${token}`;

  // 1️⃣ Prepare transaction payload
  const payload = {
    transactionDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    dateFormat: "yyyy-MM-dd",
    locale: "fr",
    transactionAmount: amount,
    accountNumber: accountNumber,
    paymentTypeId: paymentTypeId,
    receiptNumber: receiptNumber,
    note: note
  };
 
  // 2️⃣ Make POST request to deposit endpoint
  logger.info("Credit account", { accountId, amount });
  const response = await makeRequest({
    method: 'POST',
    endpoint: `/savingsaccounts/${accountId}/transactions?command=deposit`,
    data: payload,
    auth: authToken,
    tenant
  });

  if ((response as any).error) {
    logger.error("Error crediting account", { accountId, response });
    throw new Error("Fineract credit failed");
  }

  logger.info("Credit successful", { accountId });
  return response;
}

/**
 * Debit a savings account (withdrawal). Used for FX / exchange.
 */
export async function debitAccount(
  accountId: string,
  accountNumber: string,
  paymentTypeId: string,
  receiptNumber: string,
  amount: number,
  note: string,
  tenant?: string
) {
  if (!accountNumber || amount <= 0) {
    throw new Error("Invalid accountNumber or amount");
  }

  const token = await getFineractAccessToken();
  const authToken = `Bearer ${token}`;
  const payload = {
    transactionDate: new Date().toISOString().split("T")[0],
    dateFormat: "yyyy-MM-dd",
    locale: "fr",
    transactionAmount: amount,
    accountNumber,
    paymentTypeId,
    receiptNumber,
    note,
  };

  logger.info("Debit account", { accountId, amount });
  const response = await makeRequest({
    method: "POST",
    endpoint: `/savingsaccounts/${accountId}/transactions?command=withdrawal`,
    data: payload,
    auth: authToken,
    tenant,
  });

  if ((response as any).error) {
    logger.error("Error debiting account", { accountId, response });
    throw new Error("Fineract debit failed");
  }

  logger.info("Debit successful", { accountId });
  return response;
}

export async function holdAmount(
  accountId: string,
  amount: number,
  reason: string,
  tenant?: string
) {
  if (amount <= 0) throw new Error("Invalid hold amount");
  const token = await getFineractAccessToken();
  const authToken = `Bearer ${token}`;
  const payload = {
    transactionDate: new Date().toISOString().split("T")[0],
    dateFormat: "yyyy-MM-dd",
    locale: "fr",
    transactionAmount: amount,
    reasonForBlock: reason || "FX review",
    lienAllowed: false,
  };
  logger.info("Hold amount", { accountId, amount });
  const response = await makeRequest({
    method: "POST",
    endpoint: `/savingsaccounts/${accountId}/transactions?command=holdAmount`,
    data: payload,
    auth: authToken,
    tenant,
  });
  if ((response as any).error) {
    logger.error("Error holding amount", { accountId, response });
    throw new Error("Fineract hold failed");
  }
  return response;
}

export async function releaseAmount(
  accountId: string,
  holdTransactionId: string,
  tenant?: string
) {
  const token = await getFineractAccessToken();
  const authToken = `Bearer ${token}`;
  logger.info("Release amount", { accountId, holdTransactionId });
  const response = await makeRequest({
    method: "POST",
    endpoint: `/savingsaccounts/${accountId}/transactions/${holdTransactionId}?command=releaseAmount`,
    data: { isBulk: false },
    auth: authToken,
    tenant,
  });
  if ((response as any).error) {
    logger.error("Error releasing amount", { accountId, holdTransactionId, response });
    throw new Error("Fineract release failed");
  }
  return response;
}

export function parseFineractDate(value: unknown): Date | null {
  if (value == null) return null;
  if (Array.isArray(value) && value.length >= 3) {
    const d = new Date(Date.UTC(Number(value[0]), Number(value[1]) - 1, Number(value[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}
