import { Router, Request, Response } from "express";
import { makeRequest } from "../middlewares/fineractRequest";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { onboardUser } from "../services/coreBankingProcessor";
import { getAdminAccessToken, getUserByEmail } from "../services/keycloak-admin";
import axios from "axios";
import { logger } from "../logger";

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

route.post("/onboarding",keycloakProtect, async (req: any, res: Response) => {

   //res.status(200).json({ received: true }); 

  try {
    const payload = req.body;
    //console.log(JSON.stringify(payload))
    const documents = payload.data.documents || [];

    // Find the first approved proof_of_identity document
    const identityDoc = documents.find(
    (doc: any) =>
        doc.category === "proof_of_identity" &&
        doc.decision?.status === "approved"
    );
    // Extract properties safely
    const props = identityDoc?.properties || {};
    const body = {
         gender: props.sex?.trim() || null,
         first_name: props.firstName?.trim() || null,
         last_name: props.lastName?.trim() || null,
         birthday: props.dateOfBirth?.trim() || payload.data.entity.data.dateOfBirth,
         phone_number: payload.data.entity.data.phone || null,
         email: payload.data.entity.data.email || null,
         nationality: payload.data.entity.data.country  ? [payload.data.entity.data.country] : [], //todo
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

      //CB
  //TODO
    const params = {
        gender: props.sex?.trim() || null,
        firstName: props.firstName?.trim() || null,
        lastName: props.lastName?.trim() || null,
        dob: props.dateOfBirth?.trim() || payload.data.entity.data.dateOfBirth,
        phone: payload.data.entity.data.phone || null,
        email: payload.data.entity.data.email || null,
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

    // 3. Return response
    return res.status(200).json({
      message: 'User onboarded successfully',
      clientId: result.clientId,
      accountId: result.accountId,
      virtualIBAN: result.virtualIBAN
    });

   } catch (error: any) {
      return res.status(500).json({ message: error.message });
   }
});
