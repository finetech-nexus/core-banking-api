import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { findUsersByName } from "../services/keycloak-admin";
import { getClients, searchClientsByName } from "../services/fineractClient";
import { getAccounts } from "../services/fineractAccount";
import { logger } from "../logger";

export const route = Router();

function attr(user: any, key: string): string | undefined {
  const values = user?.attributes?.[key];
  const value = Array.isArray(values) ? values[0] : values;
  const text = String(value || "").trim();
  return text || undefined;
}

function same(a?: string, b?: string) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function pickUser(users: any[], email?: string, phone?: string) {
  if (users.length === 1) return users[0];
  if (email) {
    const match = users.find((user) => same(user.email, email));
    if (match) return match;
  }
  if (phone) {
    const match = users.find((user) => same(attr(user, "phone_number") || attr(user, "phone"), phone));
    if (match) return match;
  }
  return null;
}

function pickClient(clients: any[], email?: string, phone?: string) {
  if (clients.length === 1) return clients[0];
  if (email) {
    const match = clients.find((client) => same(client.emailAddress, email));
    if (match) return match;
  }
  if (phone) {
    const match = clients.find((client) => same(client.mobileNo, phone));
    if (match) return match;
  }
  return null;
}

async function contactFromClient(client: any, tenantId: string) {
  const accounts: any[] = await getAccounts(String(client.id), tenantId);
  const savings = Array.isArray(accounts) ? accounts : [];
  const account = savings.find((row) => row?.externalId) || savings[0];
  return {
    firstName: String(client.firstname || client.firstName || "").trim(),
    lastName: String(client.lastname || client.lastName || "").trim(),
    email: client.emailAddress ? String(client.emailAddress) : undefined,
    phone: client.mobileNo ? String(client.mobileNo) : undefined,
    iban: account?.externalId ? String(account.externalId) : undefined,
    accountNo: account?.accountNo ? String(account.accountNo) : undefined,
    swift: process.env.SWIFT_BIC || undefined,
  };
}

/**
 * @swagger
 * /contact/lookup:
 *   get:
 *     summary: Find a Nexus customer by first and last name
 *     tags:
 *       - Contact
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: firstName
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: lastName
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *       - in: query
 *         name: phone
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contact details from core banking
 *       400:
 *         description: Missing first or last name
 *       404:
 *         description: No unique contact found
 */
route.get("/lookup", keycloakProtect, async (req: any, res: Response) => {
  const tenantId = req.headers["fineract-platform-tenantid"];
  const firstName = String(req.query.firstName || "").trim();
  const lastName = String(req.query.lastName || "").trim();
  const email = String(req.query.email || "").trim() || undefined;
  const phone = String(req.query.phone || "").trim() || undefined;

  if (!tenantId || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing firstName, lastName or tenant" });
  }

  logger.debug("GET /contact/lookup", { firstName, lastName });

  try {
    const users = await findUsersByName(firstName, lastName);
    const user = pickUser(users, email, phone);
    if (user?.id) {
      const owned = await getClients(user.id, tenantId);
      const client = Array.isArray(owned) ? owned[0] : null;
      if (client?.id) {
        const fromBank = await contactFromClient(client, tenantId);
        return res.json({
          ...fromBank,
          firstName: fromBank.firstName || user.firstName || firstName,
          lastName: fromBank.lastName || user.lastName || lastName,
          email: fromBank.email || user.email || email,
          phone: fromBank.phone || attr(user, "phone_number") || attr(user, "phone") || phone,
        });
      }
      return res.json({
        firstName: user.firstName || firstName,
        lastName: user.lastName || lastName,
        email: user.email || email,
        phone: attr(user, "phone_number") || attr(user, "phone") || phone,
        swift: process.env.SWIFT_BIC || undefined,
      });
    }

    const clients = await searchClientsByName(firstName, lastName, tenantId);
    const client = pickClient(clients, email, phone);
    if (!client?.id) {
      return res.status(404).json({ error: "Contact not found" });
    }
    return res.json(await contactFromClient(client, tenantId));
  } catch (err) {
    logger.error("GET /contact/lookup failed", { error: err });
    return res.status(500).json({ error: "Failed to look up contact" });
  }
});
