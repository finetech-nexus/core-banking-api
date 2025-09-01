import { Router, Request, Response } from "express";

import { makeRequest } from "../middlewares/fineractRequest";
import { body, validationResult } from "express-validator";
import { getAdminAccessToken, getUserByEmail } from "../services/keycloak-admin";
import axios from "axios";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import jwt from "jsonwebtoken";
import emailValidator from "@validators/email-exist-validator";
import registrationValidator from "../validators/registration-validator";
import resetPasswordValidator from "../validators/reset-password-validator";

export const route = Router();

/**
 * @swagger
 * /:
 *   post:
 *     summary: Create account - get client info
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
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  try {
      const tenantId = req.headers['Fineract-Platform-TenantId'];
      const auth = req.headers['Authorization'];
      const response = await makeRequest({method:'GET', endpoint:'/self/clients', data: req.body, auth: auth, tenant: tenantId});
      return res.json(response);
  } catch (err) {
    return res.status(500).json({ error: "Could not create account" });
  }
});

/**
 * @swagger
 * /client/{clientId}:
 *   get:
 *     summary: Get accounts details by client ID
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Accounts
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *     responses:
 *       200:
 *         description: List of client accounts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Accounts information
 *       500:
 *         description: Server error
 */
route.get("/client/:clientId", keycloakProtect, async (req: any, res: Response) => {
  const userId = req.userInfo.sub;
  const { clientId } = req.params;
  try {
      const tenantId = req.headers['Fineract-Platform-TenantId'];
      const auth = req.headers['Authorization'];
      const response = await makeRequest({method:'GET', endpoint:`/self/clients/${clientId}/accounts`, auth: auth, tenant: tenantId});
      res.json(response);
  } catch (err) {
      return res.status(500).json({ error: "Server error" });
  }
});
