import { Router, Response } from "express";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import { listAgenciesForTenant } from "../services/agencies";

export const route = Router();

route.get("/", keycloakProtect, async (_req: any, res: Response) => {
  return res.json(listAgenciesForTenant());
});
