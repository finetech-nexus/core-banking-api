// fineractProduct.ts
import { makeRequest } from "../middlewares/fineractRequest";
import { getFineractAccessToken } from "./keycloak-admin";
import { logger } from "../logger";

export async function getCurrencyProducts(tenant?: string) {
  logger.debug("getCurrencyProducts");
  const token = await getFineractAccessToken();
  const authToken = "Bearer " + token;
  const response = await makeRequest({
    method: "GET",
    endpoint: "/savingsproducts",
    auth: authToken,
    tenant,
  });
  return response || [];
}
 