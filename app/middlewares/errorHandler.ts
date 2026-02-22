import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";
import { AppError, isAppError } from "../errors/AppError";

function getResponseBody(err: unknown): { message: string; code?: string; details?: unknown } {
  if (isAppError(err)) {
    return { message: err.message, code: err.code };
  }
  const ax = err as { response?: { status: number; data?: unknown }; message?: string };
  if (ax?.response?.data && typeof ax.response.data === "object" && "message" in ax.response.data) {
    const data = ax.response.data as { message?: string; code?: string; [k: string]: unknown };
    return { message: data.message ?? "Request failed", code: data.code, details: data };
  }
  if (ax?.response?.data) {
    return {
      message: typeof ax.response.data === "string" ? ax.response.data : "Request failed",
      details: ax.response.data,
    };
  }
  const message = ax?.message ?? (err instanceof Error ? err.message : "Internal server error");
  return { message };
}

function getStatusCode(err: unknown): number {
  if (isAppError(err)) return err.statusCode;
  const ax = err as { response?: { status: number } };
  if (ax?.response?.status) return ax.response.status;
  return 500;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = getStatusCode(err);
  const body = getResponseBody(err);

  if (statusCode >= 500) {
    logger.error("Unhandled error", { err, statusCode, message: body.message });
  } else {
    logger.warn("Client error", { statusCode, code: body.code, message: body.message });
  }

  if (res.headersSent) return;
  res.status(statusCode).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ message: "Not found", path: req.originalUrl });
}
