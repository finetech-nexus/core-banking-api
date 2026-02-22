import { NextFunction, Request, Response } from "express";
import { verifyJWTOffline } from "../services/keycloak-client";
import { AppError } from "../errors/AppError";

export interface AuthenticateRequest extends Request {
  userInfo?: any;
}

export const keycloakProtect = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (!req.headers.authorization) {
    return next(new AppError("access_token required", 400, "MISSING_TOKEN"));
  }
  const token = req.headers.authorization.split(" ").at(-1) ?? "";
  try {
    const userInfo = await verifyJWTOffline(token);
    (req as AuthenticateRequest).userInfo = userInfo;
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return next(new AppError("access_token expired", 401, "TOKEN_EXPIRED"));
    }
    return next(new AppError("access_token invalid", 403, "TOKEN_INVALID"));
  }
};