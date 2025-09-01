import { Router, Request, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { makeRequest } from "../middlewares/fineractRequest";

export const route = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     TransferRequest:
 *       type: object
 *       required:
 *         - fromAccountId
 *         - toAccountId
 *         - amount
 *       properties:
 *         fromAccountId:
 *           type: string
 *           description: Source account ID
 *         toAccountId:
 *           type: string
 *           description: Destination account ID
 *         amount:
 *           type: number
 *           description: Amount to transfer
 *         note:
 *           type: string
 *           description: Optional note for the transfer
 *
 *     TransferResponse:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           description: The ID of the transfer transaction
 *         status:
 *           type: string
 *           description: Status of the transfer (e.g., SUCCESS, FAILED)
 *         message:
 *           type: string
 *           description: Optional message
 */

/**
 * @swagger
 * /transfers:
 *   post:
 *     summary: Make a transfer between accounts
 *     tags:
 *       - Transfers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: Transfer details
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransferRequest'
 *     responses:
 *       200:
 *         description: Transfer successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferResponse'
 *       401:
 *         description: Unauthorized (invalid or missing token)
 *       500:
 *         description: Transfer failed due to server error
 */
route.post("/", keycloakProtect, async (req: any, res: Response) => {
  try {
    const tenantId = req.headers['Fineract-Platform-TenantId'];
    const auth = req.headers['Authorization'];
    const response = await makeRequest({method:'POST', endpoint:'/self/accounttransfers?type="tpt"', data: req.body, auth: auth, tenant: tenantId});
    res.json(response);
  } catch (err) {
    return res.status(500).json({ error: "Transfer failed" });
  }
});
