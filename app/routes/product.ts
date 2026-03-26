import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { getClients } from "../services/fineractClient";
import { getAccounts } from "../services/fineractAccount";
import { getCurrencyProducts } from "../services/fineractProduct";
import { logger } from "../logger";

export const route = Router();

export interface CurrencyProduct {
  id: string;
  name: string;
  shortName: string;
  currencyCode: string;  
  currencySymbol: string;
  userSubscriptionEnabled: boolean;
}
 

route.get("/", async (req: any, res: Response) => {
  try {
    logger.debug("GET /product");
    const tenantId = req.headers["fineract-platform-tenantid"];
    const userId = req.userInfo?.sub;

    if (!tenantId) {
      return res.status(400).json({ error: "Missing Fineract tenant header" });
    }

    // 1️⃣ Get currency products from API
    const apiProducts: any[] = await getCurrencyProducts(tenantId);
 
    // Map API response to CurrencyProduct type
    const currencyProducts: CurrencyProduct[] = apiProducts.map((p) => ({
      id: p.id.toString(),                     // convert numeric ID to string
      name: p.name,
      shortName: p.shortName,
      currencyCode: p.currency?.code || "",
      currencySymbol: p.currency?.displaySymbol || "",
      enabled: false,                          // default, will update later
    }));
 
    // 2️⃣ Get client(s)
    const clients = await getClients(userId, tenantId);

    let accounts: any[] = [];

    // 3️⃣ Get accounts if client exists
    if (Array.isArray(clients) && clients.length === 1) {
      accounts = await getAccounts(clients[0].id, tenantId);
    }
 

    // 4️⃣ Mark products as enabled if account exists
    const updatedCurrencyProducts: CurrencyProduct[] = currencyProducts.map((product) => {
      const exists = accounts.some(
        (account: any) => account.productId?.toString() === product.id
      );
      return {
        ...product,
        userSubscriptionEnabled: exists,
      };
    });
    // 5️⃣ Return result
    return res.status(200).json(updatedCurrencyProducts);

  } catch (error) {
    logger.error("Error fetching currency products", { error });
    return res.status(500).json({
      error: "Failed to fetch currency products",
    });
  }
});

