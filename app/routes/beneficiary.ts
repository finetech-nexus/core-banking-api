import { Router, Request, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { makeRequest } from "../middlewares/fineractRequest";
import { getClients } from "../services/fineractClient";
import { getFineractAccessToken } from "../services/keycloak-admin";
import { logger } from "../logger";

export const route = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Beneficiary:
 *       type: object
 *       required:
 *         - name
 *         - accountNo
 *         - bankCode
 *       properties:
 *         name:
 *           type: string
 *           description: Beneficiary full name
 *         accountNo:
 *           type: string
 *           description: Beneficiary bank account number
 *         bankCode:
 *           type: string
 *           description: Beneficiary bank code
 *
 *     BeneficiaryResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         accountNo:
 *           type: string
 *         bankCode:
 *           type: string
 *         status:
 *           type: string
 *           description: Status of the beneficiary
 */

/**
 * @swagger
 * /beneficiaries:
 *   post:
 *     summary: Add a new beneficiary
 *     tags:
 *       - Beneficiaries
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: Beneficiary info to add
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Beneficiary'
 *     responses:
 *       200:
 *         description: Beneficiary added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BeneficiaryResponse'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Failed to add beneficiary
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const auth = req.headers["authorization"];
  logger.debug("POST /client_beneficiaries", { userId, tenantId });
  if (!tenantId || !auth) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  try {
    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length !== 1) {
      return res.status(404).json({ error: "Client not found" });
    }
    const clientId = clients[0].id;
    const token = await getFineractAccessToken(); 
    let authToken = 'Bearer ' + token;
    const response = await makeRequest({
      method: "POST",
      endpoint: `/datatables/beneficiaries_client/${clientId}`,
      data: req.body,
      auth: authToken,
      tenant: tenantId,
    });
    return res.json(response);
  } catch (err) {
    logger.error("Error adding beneficiary", { error: err });
    return res.status(500).json({ error: "Failed to add beneficiary" });
  }
});


/**
 * @swagger
 * /beneficiaries:
 *   get:
 *     summary: List all beneficiaries for the user
 *     tags:
 *       - Beneficiaries
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of beneficiaries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/BeneficiaryResponse'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Could not fetch beneficiaries
 */
route.get("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  logger.debug("GET /client_beneficiaries", { userId, tenantId });
  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  try {
    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length !== 1) {
      return res.status(404).json({ error: "Client not found" });
    }
    const clientId = clients[0].id;
    const token = await getFineractAccessToken(); 
    let authToken = 'Bearer ' + token;
    
    const response = await makeRequest({
      method: "GET",
      endpoint: `/datatables/beneficiaries_client/${clientId}`,
      data: req.body,
      auth: authToken,
      tenant: tenantId,
    });
    return res.json(response);
  } catch (err) {
    logger.error("Error delete beneficiary", { error: err });
    return res.status(500).json({ error: "Failed to delete beneficiary" });
  }
});

route.delete("/:id", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const tenantId = req.headers["fineract-platform-tenantid"];
  const id = req.params.id
  logger.debug("GET /client_beneficiaries", { userId, tenantId });
  if (!tenantId) {
    return res.status(400).json({ error: "Missing Fineract headers" });
  }
  try {
    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length !== 1) {
      return res.status(404).json({ error: "Client not found" });
    }
    const clientId = clients[0].id;
    const token = await getFineractAccessToken(); 
    let authToken = 'Bearer ' + token;
    const response = await makeRequest({
      method: "DELETE",
      endpoint: `/datatables/beneficiaries_client/${clientId}/${id}`,
      auth: authToken,
      tenant: tenantId,
    });
    return res.json(response);
  } catch (err) {
    logger.error("Error delete beneficiary", { error: err });
    return res.status(500).json({ error: "Failed to delete beneficiary" });
  }
});
