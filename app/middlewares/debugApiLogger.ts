import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

const DEBUG =
  process.env.DEBUG === "true" ||
  process.env.DEBUG === "1" ||
  (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === "debug");

const SENSITIVE_KEYS = /password|secret|token|authorization|apikey|api_key|credential|bearer|subject_token/i;
const MAX_BODY_LOG = 2000;

function sanitize(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = typeof v === "object" && v !== null ? sanitize(v) : v;
    }
  }
  return out;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + `...[truncated ${str.length - max} chars]`;
}

export function debugApiLogger(req: Request, res: Response, next: NextFunction) {
  if (!DEBUG) return next();

  const input: Record<string, unknown> = {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query || {}).length ? req.query : undefined,
  };
  if (req.body !== undefined && req.body !== null) {
    const body = typeof req.body === "object" ? sanitize(req.body) : req.body;
    const str = typeof body === "string" ? body : JSON.stringify(body);
    input.body = str.length > MAX_BODY_LOG ? truncate(str, MAX_BODY_LOG) : body;
  }
  logger.debug("API request", input);

  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    const output = sanitize(body);
    const str = typeof output === "string" ? output : JSON.stringify(output);
    logger.debug("API response", {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      body: str.length > MAX_BODY_LOG ? truncate(str, MAX_BODY_LOG) : output,
    });
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = function (body: unknown) {
    if (typeof body === "string" && body.length <= MAX_BODY_LOG) {
      logger.debug("API response", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        body: body,
      });
    } else if (body != null) {
      logger.debug("API response", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        body: typeof body === "string" ? truncate(body, MAX_BODY_LOG) : "[non-JSON]",
      });
    }
    return originalSend(body);
  };

  next();
}
