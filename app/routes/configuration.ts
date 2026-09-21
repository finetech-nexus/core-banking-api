import { Router, Request, Response } from "express";

export const route = Router();
/**
 * @swagger
 * tags:
 *   name: Configuration
 *   description: Configuration Client Mobile
 */

function mobileConfig() {
  return {
    waiting_post_registraion: 60,
    link_into: "",
    default_language: "",
    inactivity_delai: 6,
    contability_check: "v1.0.0",
  };
}

route.get("/", (_request: Request, response: Response) => {
  return response.status(200).json(mobileConfig());
});

route.post("/", async (_request: Request, response: Response) => {
  return response.status(200).json(mobileConfig());
});
