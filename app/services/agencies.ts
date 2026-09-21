import fs from "fs";
import path from "path";
import { logger } from "../logger";

export type Agency = {
  id: string;
  tenantId: string;
  name: string;
  city: string;
  address: string;
  hours?: string;
  phone?: string;
  lat: number;
  lng: number;
};

function tenantCode(): string {
  return String(process.env.TENANT || process.env.COUNTRY_CODE || "").trim().toLowerCase();
}

function readCatalog(): Agency[] {
  const inline = process.env.AGENCIES_JSON?.trim();
  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      return Array.isArray(parsed) ? parsed : parsed?.agencies || [];
    } catch (err: any) {
      logger.error("Invalid AGENCIES_JSON", { message: err?.message });
      return [];
    }
  }
  const file =
    process.env.AGENCIES_FILE || path.join(process.cwd(), "data", "agencies.json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed?.agencies || [];
  } catch (err: any) {
    logger.error("Could not read agencies file", { file, message: err?.message });
    return [];
  }
}

function normalize(row: any, fallbackTenant: string): Agency | null {
  const lat = Number(row?.lat);
  const lng = Number(row?.lng);
  const id = String(row?.id || "").trim();
  const name = String(row?.name || "").trim();
  const address = String(row?.address || "").trim();
  if (!id || !name || !address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id,
    tenantId: String(row?.tenantId || fallbackTenant).toLowerCase(),
    name,
    city: String(row?.city || "").trim(),
    address,
    hours: row?.hours ? String(row.hours) : undefined,
    phone: row?.phone ? String(row.phone) : undefined,
    lat,
    lng,
  };
}

export function listAgenciesForTenant(): { tenantId: string; agencies: Agency[] } {
  const tenantId = tenantCode();
  const catalog = readCatalog()
    .map((row) => normalize(row, tenantId))
    .filter((row): row is Agency => Boolean(row));
  const agencies = tenantId
    ? catalog.filter((a) => a.tenantId === tenantId)
    : catalog;
  return { tenantId, agencies };
}
