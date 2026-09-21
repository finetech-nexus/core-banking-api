// fineractClient.ts
import { makeRequest } from "../middlewares/fineractRequest";
import { getFineractAccessToken } from "./keycloak-admin";
import { logger } from "../logger";

interface ClientData {
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
}

//TODO: Full call
//https://fineract.apache.org/docs/legacy/index.html#clients_create
export async function createClient(client: ClientData, auth: string, tenant?: string) {
  const data = {
    firstname: client.firstName,
    lastname: client.lastName,
    dateOfBirth: client.dob,
    //mobileNo: client.phone,
    emailAddress: client.email,
    active: true,
    activationDate: new Date().toISOString().split('T')[0],
    dateFormat: "yyyy-MM-dd",
    locale: "fr",
    officeId: client.officeId,
    externalId: client.externalId,
    legalFormId: 1 , //1 = Person or2 = Entity
  };
  logger.debug("createClient", { firstname: data.firstname, lastname: data.lastname });
  const response = await makeRequest({
    method: 'POST',
    endpoint: '/clients',
    data,
    auth,
    tenant
  });

  if ((response as any).error) {
    logger.error("Error POST /clients", { message: (response as any).message });
    throw response;
  }

  //TODO save adress
  //POST /clients/{clientId}/addresses?tenantIdentifier=default
  /*{
  "street": "123 Main St",
  "addressTypeId": 1,
  "isActive": true,
  "city": "Tunis",
  "stateProvinceId": 1,
  "countryId": 1,
  "postalCode": "1001",
  "dateFormat": "yyyy-MM-dd",
  "locale": "en",
  "createdOn": "2025-09-25"
}*/

  return (response as any).resourceId; // clientId
}

/**
 * 
 * @param externalId 
 * @param tenant 
 * @returns 
 */
export async function getClients(externalId: string, tenant?: string) {
  // 0. get Fineract token 
  const token = await getFineractAccessToken(); 
  let authToken = 'Bearer ' + token;
  // 1. get clients
  const response = await makeRequest({
      method: "GET",
      endpoint: `/clients?externalId=${externalId}`,
      auth: authToken,
      tenant: tenant,
    });
  return response.pageItems || [];
}

export async function searchClientsByName(firstName: string, lastName: string, tenant?: string) {
  const token = await getFineractAccessToken();
  const authToken = "Bearer " + token;
  const displayName = `${firstName} ${lastName}`.trim();
  const response = await makeRequest({
    method: "GET",
    endpoint: `/clients?displayName=${encodeURIComponent(displayName)}&limit=50&offset=0`,
    auth: authToken,
    tenant,
  });
  const items = Array.isArray((response as any)?.pageItems) ? (response as any).pageItems : [];
  const first = firstName.trim().toLowerCase();
  const last = lastName.trim().toLowerCase();
  return items.filter((client: any) => {
    const given = String(client.firstname || client.firstName || "").trim().toLowerCase();
    const family = String(client.lastname || client.lastName || "").trim().toLowerCase();
    if (given && family) return given === first && family === last;
    return String(client.displayName || "").trim().toLowerCase() === displayName.toLowerCase();
  });
}

export async function getClient(clientId: string, tenant?: string) {
  // 0. get Fineract token 
  const token = await getFineractAccessToken(); 
  let authToken = 'Bearer ' + token;
  // 1. get clients
  const response = await makeRequest({
      method: "GET",
      endpoint: `/clients/${clientId}`,
      auth: authToken,
      tenant: tenant,
    });
  return response;
}

/**
 * Update Fineract client contact fields. firstname/lastname are required by Fineract PUT /clients.
 */
export async function updateClientContact(
  clientId: string | number,
  payload: { firstname: string; lastname: string; email?: string; phone?: string },
  tenant?: string
) {
  const token = await getFineractAccessToken();
  const data: Record<string, unknown> = {
    firstname: payload.firstname,
    lastname: payload.lastname,
    locale: "fr",
    dateFormat: "yyyy-MM-dd",
  };
  if (payload.email !== undefined) data.emailAddress = payload.email;
  if (payload.phone !== undefined) data.mobileNo = payload.phone;

  const response = await makeRequest({
    method: "PUT",
    endpoint: `/clients/${clientId}`,
    data,
    auth: "Bearer " + token,
    tenant,
  });

  if ((response as any).error) {
    logger.error("Error PUT /clients", { clientId, message: (response as any).message });
    throw response;
  }
  return response;
}

export async function createBeneficiary(clientId: string, tenantId?: string, beneficiary?: any) {
  // 0. get Fineract token 
  const token = await getFineractAccessToken(); 
  let authToken = 'Bearer ' + token;
  
  // 2. createBeneficiary
  const response = await makeRequest({
    method: "POST",
    endpoint: `/datatables/beneficiaries_client/${clientId}`,
    data: beneficiary,
    auth: authToken,
    tenant: tenantId,
  });
  return response;

}
