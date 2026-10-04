import { Router, Request, Response } from "express";
import { makeRequest } from "../middlewares/fineractRequest";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { onboardUser } from "../services/coreBankingProcessor";
import { getAdminAccessToken, getGlobalAdminAccessToken,getUserByEmail } from "../services/keycloak-admin";
import axios from "axios";
import { logger } from "../logger";
import { isExchangeCurrencyWebhook } from "../services/ballerineExchange";
import { settleExchangeFromWebhook } from "../services/settleExchange";
import { isParrainageWebhook, startParrainageWorkflow } from "../services/ballerineReferral";
import { settleReferralFromWebhook } from "../services/settleReferral";
import { attachReferralWorkflow, matchReferral } from "../services/referralClient";

export const route = Router();

/**
 * @swagger
 * /kyc:
 *   post:
 *     summary: KYC submission endpoint (not yet implemented)
 *     tags:
 *       - KYC
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: KYC data to be submitted
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: KYC payload (fields TBD)
 *     responses:
 *       200:
 *         description: Endpoint not yet implemented
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not yet implemented
 *       401:
 *         description: Unauthorized (missing or invalid token)
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
    const tenantId = req.headers['Fineract-Platform-TenantId'];
    const auth = req.headers['Authorization'];
    return res.status(200).json({ error: "Not yet implemented" });
});


/**
 * {
   "id":"d84d3f2e-0310-4f03-8dc0-e87f440d8d75",
   "eventName":"workflow.completed",
   "apiVersion":"0.7.95",
   "timestamp":"2026-01-30T20:15:36.685Z",
   "workflowCreatedAt":"2026-01-30T20:15:14.926Z",
   "workflowResolvedAt":"2026-01-30T20:15:36.666Z",
   "workflowDefinitionId":"risk-score-improvement-dev",
   "workflowRuntimeId":"cml1bob5n000jar33j7hz4v6p",
   "workflowStatus":"completed",
   "workflowFinalState":"approved",
   "ballerineEntityId":"cml1bny3f0001ar33kaneszl3",
   "correlationId":"user-ballerine_1769804097789_63f2ca2e210e",
   "environment":"production",
   "data":{
      "entity":{
         "id":"user-ballerine_1769804097789_63f2ca2e210e",
         "data":{
            "email":"hhhhhhvv@yopmail.com",
            "phone":"",
            "country":"TN",
            "lastName":"Ffff",
            "firstName":"Weary",
            "dateOfBirth":"2000-01-01"
         },
         "type":"individual",
         "ballerineEntityId":"cml1bny3f0001ar33kaneszl3"
      },
      "metadata":{
         "customerId":"customer-1",
         "customerName":"Customer 1",
         "customerNormalizedName":"customer-1"
      },
      "documents":[
         {
            "id":"cd74b80e-6843-4c5d-a0ec-d035faf6fb52",
            "type":"passport",
            "pages":[
               {
                  "metadata":{
                     "side":"front"
                  },
                  "ballerineFileId":"cml1boad4000dar338p1hw9ef"
               }
            ],
            "issuer":{
               "country":"ZZ"
            },
            "version":1,
            "category":"proof_of_identity",
            "decision":{
               "status":"approved",
               "revisionReason":null,
               "rejectionReason":null
            },
            "metadata":{
               
            },
            "properties":{
               "sex":" ",
               "expires":" ",
               "lastName":" ",
               "authority":" ",
               "firstName":" ",
               "issueDate":" ",
               "middleName":" ",
               "dateOfBirth":" ",
               "placeOfBirth":" ",
               "placeOfIssue":" "
            },
            "issuingVersion":1
         },
         {
            "id":"b06a208c-dce6-426b-9ff6-46b392377122",
            "type":"selfie",
            "pages":[
               {
                  "metadata":{
                     "side":"selfie"
                  },
                  "ballerineFileId":"cml1boail000far33rwwpfv89"
               }
            ],
            "issuer":{
               "country":"ZZ"
            },
            "version":1,
            "category":"proof_of_identity_ownership",
            "decision":{
               "status":"approved",
               "revisionReason":null,
               "rejectionReason":null
            },
            "metadata":{
               
            },
            "properties":{
               "sex":" ",
               "expires":" ",
               "lastName":" ",
               "authority":" ",
               "firstName":" ",
               "issueDate":" ",
               "middleName":" ",
               "dateOfBirth":" ",
               "placeOfBirth":" ",
               "placeOfIssue":" "
            },
            "issuingVersion":1
         }
      ],
      "customerName":"Customer 1",
      "collectionFlow":{
         "state":{
            "steps":[
               
            ],
            "status":"approved",
            "currentStep":""
         },
         "config":{
            "apiUrl":"https://workflowsvc.kyc.sandbox.nexus-bank.io"
         },
         "additionalInformation":{
            "customerCompany":""
         }
      }
   }
}
 */

function nonBlank(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

route.post("/onboarding",keycloakProtect, async (req: any, res: Response) => {

   //res.status(200).json({ received: true }); 
   console.log("call /onboarding with header",req.body); 
 
  try {
    const payload = req.body;
    if (isExchangeCurrencyWebhook(payload)) {
      const result = await settleExchangeFromWebhook(payload);
      return res.status(200).json({ message: "Exchange review processed", ...result });
    }
    if (isParrainageWebhook(payload)) {
      const result = await settleReferralFromWebhook(payload);
      return res.status(200).json({ message: "Parrainage review processed", ...result });
    }
    //console.log(JSON.stringify(payload))
    const documents = payload.data.documents || [];
    const entity = payload.data?.entity?.data || {};

    // Find the first approved proof_of_identity document
    const identityDoc = documents.find(
    (doc: any) =>
        doc.category === "proof_of_identity" &&
        doc.decision?.status === "approved"
    );
    // Prefer OCR document properties, then the entity data captured at KYC start.
    const props = identityDoc?.properties || {};
    const firstName = nonBlank(props.firstName, entity.firstName);
    const lastName = nonBlank(props.lastName, entity.lastName);
    const body = {
         gender: nonBlank(props.sex, entity.gender, entity.sex),
         first_name: firstName,
         last_name: lastName,
         birthday: nonBlank(props.dateOfBirth, entity.dateOfBirth),
         phone_number: nonBlank(entity.phone, entity.phoneNumber),
         email: nonBlank(entity.email),
         nationality: entity.country  ? [entity.country] : [], //todo
         address: " ", //TODO
         postalCode: " ",//TODO
         city: " ", //TODO
         country:" ",//TODO
         kyc_eu: false, //TODO externaliser var env
         kyc_tn: true//TODO externaliser var env
         };
 
      // create user in keycloak
      const token = await getAdminAccessToken();

      const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/registrations/register`;
      console.log("Register user:",url,body);
      const  result1 = await axios.post(
        url,
        body,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
       // Update global in keycloak
       const tokenGlobal = await getGlobalAdminAccessToken();

       const urlGlobal = `${process.env.GLOBAL_KEYCLOAK_URL}/realms/${process.env.GLOBAL_KEYCLOAK_REALM}/registrations/update-user`;
       const resultGlobal = await axios.post(
        urlGlobal,
        {
          email: payload.data.entity.data.email || null,
          kyc: process.env.TENANT,
          verificationId: result1.data.id,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenGlobal}`,
          },
        }
      );


      //CB
  //TODO
    const params = {
        gender: body.gender,
        firstName,
        lastName,
        dob: body.birthday,
        phone: body.phone_number,
        email: body.email,
        externalId: result1.data.id,//payload.data.entity.data.externalId || null,
        nationality: payload.data.entity.data.country || null,
        address: null,
        postalCode: null,
        city: null,
        country: payload.data.entity.data.country || null,
        officeId: Number(process.env.OFFICE_ID),
        savingsProductId: Number(process.env.DEFAULT_SAVING_PRODUCT),
    };

    logger.info("Onboarding user from webhook", { externalId: params?.externalId });

    // 2. Onboard user
    logger.debug("call onboardUser");
    const result = await onboardUser(params);

    logger.info("Onboarding result", { clientId: result?.clientId });

    // Parrainage: if this email was invited, start Ballerine validation then credit referrer on approve.
    let parrainage: Record<string, unknown> | null = null;
    const invitedEmail = String(params.email || "").trim();
    const referredUserId = String(params.externalId || "").trim();
    if (invitedEmail && referredUserId) {
      try {
        const matched = await matchReferral(invitedEmail, referredUserId);
        if (matched?.id) {
          const workflow = await startParrainageWorkflow({
            referrerUserId: String(matched.ownerId || ""),
            referredUserId,
            invitedEmail,
            referralId: matched.id,
            rewardAmount: Number(matched.rewardAmount || 0),
            currency: String(matched.currency || "EUR"),
            accountId: matched.accountId,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
          });
          if (workflow?.workflowRuntimeId) {
            await attachReferralWorkflow(matched.id, workflow.workflowRuntimeId);
            parrainage = { referralId: matched.id, workflowRuntimeId: workflow.workflowRuntimeId, status: "IN_REVIEW" };
          } else {
            parrainage = { referralId: matched.id, status: "IN_REVIEW", workflow: "skipped" };
          }
        }
      } catch (err: any) {
        logger.warn("Parrainage match after onboarding failed", { error: err?.message });
      }
    }

    // 3. Return response
    return res.status(200).json({
      message: 'User onboarded successfully',
      clientId: result.clientId,
      accountId: result.accountId,
      virtualIBAN: result.virtualIBAN,
      parrainage,
    });

   } catch (error: any) {
      return res.status(500).json({ message: error.message });
   }
});
