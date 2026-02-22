// paymentService.ts
import { channelRequest } from "../middlewares/channelRequest";
import { logger } from "../logger";

export async function partyRegistration(
  accountId: string,
  idType: string,
  idValue: string,
  tenant?: string
) {
  logger.debug("Call /channel/partyRegistration", { accountId, idType });
  const response = await channelRequest({
    method: 'POST',
    endpoint: '/channel/partyRegistration',
    data: {
      accountId,
      idType,
      idValue
    },
    //auth: null,
    tenant
  });

  if ((response as any).error) {
    logger.error("Error POST /channel/partyRegistration", { accountId, message: (response as any).message });
    throw response;
  }
  logger.debug("partyRegistration success", { accountId });
  return;
}

//TODO security
/*export async function transferRequest(
  accountId: string,
  idType: string,
  idValue: string,
  tenant: string
) {
  console.log("Call /channel/transferRequest, accountId, idValue", accountId, idValue);
  const response = await channelRequest({
    method: 'POST',
    endpoint: '/channel/partyRegistration',
    data: {
      accountId,
      idType,
      idValue
    },
    //auth: null,
    tenant
  });

  if ((response as any).error) {
    console.error("Error on call POST /channel/partyRegistration  accountId, idValue ", accountId, idValue,  JSON.stringify(response.message));
    throw response;
  }
  console.log("Rsponse /channel/partyRegistration, accountId, idValue", accountId, idValue, response);

  return;
}*/
