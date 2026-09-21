import { Router, Request, Response } from "express";

import { makeRequest } from "../middlewares/fineractRequest";
import { body, validationResult } from "express-validator";
import { getAdminAccessToken, getUserByEmail, getFineractAccessToken, updateUserContact } from "../services/keycloak-admin";
import axios from "axios";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import jwt from "jsonwebtoken";
import emailValidator from "@validators/email-exist-validator";
import registrationValidator from "../validators/registration-validator";
import resetPasswordValidator from "../validators/reset-password-validator";
import { partyRegistration } from '../services/paymentService';
import { assignIBAN , generateIBAN, createIBANTable} from '../services/assignIBAN';

import { getClient, getClients, updateClientContact } from "../services/fineractClient";
import { getAccounts, getTransactions, creditAccount, createSavingsAccountWithPolling } from "../services/fineractAccount";
import { logger } from "../logger";

export const route = Router();



/**
 * @swagger
 * /:
 *   post:
 *     summary: Get account - get client info
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Successfully retrieved client info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Client information
 *       500:
 *         description: Could not create account
 */

route.get("/", keycloakProtect, async (req: any, res: Response) => {

    const tenantId = req.headers["fineract-platform-tenantid"];
    const auth = req.headers["authorization"];
    const userId = req.userInfo?.sub;
    if (!tenantId || !auth) {
      return res.status(400).json({ error: "Missing Fineract headers" });
    }
    logger.debug("GET /account", { userId, tenantId });
    try {
    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }
    // 2️. Fetch accounts + transactions for each client
    const results = await Promise.all(
      clients.map(async (client) => {
        const accounts: any[] = await getAccounts(client.id, tenantId)
        const accountsWithTransactions = await Promise.all(
          accounts.map(async (account: any) => {
            // Fetch last 5 transactions
            const transactions: any[] = await getTransactions(account.id)
             
            const last = transactions.map((t: any) => ({
              id: t.id,
              amount: t.amount,
              date: t.date,
              title: t.note || t.reasonForBlock,
              transactionType: t.transactionType?.value || "Transaction",
              entryType: t.entryType,
              currency: t.currency.code,
              country: t.locale || "FR",
              reversed: t.reversed,
              amountHold: t.transactionType?.amountHold || false,
              amountRelease: t.transactionType?.amountRelease || false,
              releaseTransactionId: t.releaseTransactionId || null,
            }));

            return {
              id: account.id,
              name: account.accountNo,
              balance: account.accountBalance || 0,
              currency: account.currency.code,
              externalId: account.externalId, // IBAN or identifier
              swift: process.env.SWIFT_BIC,
              transactions: last,
            };
          })
        );

        return {
          clientId: client.id,
          clientName: client.displayName || client.accountNo || "Unnamed Client",
          clientType: client.clientType || "PERSON",
          accounts: accountsWithTransactions,
        };
      })
    );
    logger.debug("Account results", { clientCount: results?.length });
    return res.json(results);
  } catch (err: any) {
    logger.error("GET /account failed", { userId, tenantId });
    return res.status(500).json({
      error: "Could not fetch /accounts",
      details: err.message,
    });
  }
});

/**
 * PATCH /profile — update phone/email on tenant Keycloak and Fineract client
 * (looked up by JWT sub as Fineract externalId).
 */
route.patch("/profile", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const userId = req.userInfo?.sub;
  const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : undefined;
  const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone.trim() : undefined;

  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  if (!userId) {
    return res.status(401).json({ error: "invalid user from token" });
  }
  if (!emailRaw && !phoneRaw) {
    return res.status(400).json({ error: "email or phone is required" });
  }

  logger.debug("PATCH /account/profile", { userId, tenantId, hasEmail: !!emailRaw, hasPhone: !!phoneRaw });

  try {
    try {
      await updateUserContact(userId, { email: emailRaw, phone: phoneRaw });
    } catch (kcErr: any) {
      const status = kcErr?.response?.status;
      if (status === 404) {
        logger.warn("Tenant Keycloak user not found for profile update", { userId, tenantId });
      } else {
        throw kcErr;
      }
    }

    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const updated = await Promise.all(
      clients.map(async (client: any) => {
        const firstname =
          client.firstname ||
          String(client.displayName || "").split(/\s+/)[0] ||
          "Client";
        const lastname =
          client.lastname ||
          String(client.displayName || "").split(/\s+/).slice(1).join(" ") ||
          "User";
        await updateClientContact(
          client.id,
          {
            firstname,
            lastname,
            email: emailRaw,
            phone: phoneRaw,
          },
          tenantId
        );
        return { clientId: client.id };
      })
    );

    return res.json({ ok: true, clients: updated });
  } catch (err: any) {
    logger.error("PATCH /account/profile failed", {
      userId,
      tenantId,
      message: err?.message,
      details: err?.response?.data || err?.message,
    });
    return res.status(500).json({
      error: "Could not update profile",
      details: err?.response?.data || err?.message,
    });
  }
});


 route.post("/", keycloakProtect, async (req: any, res: Response) => {

    const tenantId = req.headers["fineract-platform-tenantid"];
    const auth = req.headers["authorization"];
    const userId = req.userInfo?.sub;
    const {productId} = req.body;
    if (!tenantId || !auth) {
      return res.status(400).json({ error: "Missing Fineract headers" });
    }
    logger.debug("POST /account", { productId, userId, tenantId });
    try {
    // 1.getClients
    const clients =  await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length !== 1) {
      return res.status(404).json({ error: "Client not found" });
    }
    // 2️. Fetch products 
    //const products: Record<string, string> = JSON.parse(process.env.SAVING_PRODUCTS!);
    // if (!products[currency]) {
     // console.log("Product not found for currency " + currency)
    // return res.status(404).json({ error: "Product not found for currency" });
    //}
     // 2. get Fineract token 
    const token = await getFineractAccessToken(); 
    let authToken = 'Bearer ' + token;
     // 3. Generate virtual IBAN (you can use bank code as needed)
    const virtualIBAN = generateIBAN('');
    // 4. create Account
    const account = await createSavingsAccountWithPolling(clients[0].id, productId,virtualIBAN, authToken,  tenantId);
    // 5.PartyRegistration 
    //MSISDN, EMAIL, PERSONAL_ID, BUSINESS, DEVICE, ACCOUNT_ID, IBAN, ALIAS;
    const accountId = account.id;
    const accountNo = account.accountNo
    await partyRegistration(accountNo, 'IBAN', virtualIBAN , tenantId);
    await partyRegistration(accountNo, "EMAIL", clients[0].emailAddress, tenantId);
    //await partyRegistration(accountNo, "MSISDN", clients[0].??, tenantId)

    return res.json(account);
  } catch (err: any) {
    logger.error("GET /account failed", { userId, tenantId });
    return res.status(500).json({
      error: "Could not post /accounts",
      details: err.message,
    });
  }
});

route.post("/deposit", async (req: any, res: Response) => {//TODO add security
  const tenantId = req.headers["fineract-platform-tenantid"];
  const auth = req.headers["authorization"];
  //const userId = req.userInfo?.sub;
  const { savingsAccountId, amount, note, clientId , paymentTypeId, receiptNumber} = req.body;

  if (!tenantId  ) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }

  if (!savingsAccountId || !amount || amount <= 0) {
    return res.status(400).json({ error: "Missing or invalid accountId/amount" });
  }
 
  try {
    // 1️⃣ Get clients associated with user
    const client = await getClient(clientId, tenantId);
    logger.debug("Client found", { clientId: client?.id });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // 2️⃣ Optionally verify the savings account belongs to this client
    const accounts = await getAccounts(clientId.toString(), tenantId);
    const account = accounts.find((a: any) => a.id.toString() === savingsAccountId);
    if (!account) {
      return res.status(404).json({ error: "Savings account not found for client" });
    }
 
    // 3️⃣ Credit the savings account
    const creditResponse = await creditAccount(savingsAccountId, account.accountNo , paymentTypeId, receiptNumber, amount,note, tenantId, clientId);
    logger.info("Credit success", { savingsAccountId });

    res.status(200).json({
      message: "Account credited successfully",
      data: creditResponse,
    });
  } catch (err: any) {
    logger.error("Transaction error", { error: err?.message || err });
    res.status(500).json({ error: "Transaction failed" });
  }
});





