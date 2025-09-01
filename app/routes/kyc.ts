import { Router, Request, Response } from "express";
import { makeRequest } from "../middlewares/fineractRequest";
import { keycloakProtect } from "../middlewares/keycloakProtect";

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
