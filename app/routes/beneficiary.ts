import { Router, Request, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { makeRequest } from "../middlewares/fineractRequest";

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
  const { name, accountNo, bankCode } = req.body;
  try {
    const tenantId = req.headers['Fineract-Platform-TenantId'];
    const auth = req.headers['Authorization'];
    const response = await makeRequest({method:'POST', endpoint:'/self/beneficiaries/tpt', data: req.body, auth: auth, tenant: tenantId});
    return res.json(response);
  } catch (err) {
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
  try {
    const tenantId = req.headers['Fineract-Platform-TenantId'];
    const auth = req.headers['Authorization'];
    const response = await makeRequest({method:'GET', endpoint:'/self/beneficiaries/tpt', auth: auth, tenant: tenantId});
    res.json(response);
  } catch (err) {
    return res.status(500).json({ error: "Could not fetch beneficiaries" });
  }
});
