import { Kafka, Producer, logLevel } from "kafkajs";
import { logger } from "../logger";
import { getClients } from "./fineractClient";

let producer: Producer | null = null;
let connecting: Promise<Producer | null> | null = null;

function brokers(): string[] {
  return (process.env.KAFKA_BROKERS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function topic(): string {
  return process.env.KAFKA_TRANSACTION_TOPIC || "notification.transaction";
}

async function getProducer(): Promise<Producer | null> {
  const list = brokers();
  if (list.length === 0) return null;
  if (producer) return producer;
  if (!connecting) {
    connecting = (async () => {
      const kafka = new Kafka({
        clientId: process.env.KAFKA_CLIENT_ID || "core-banking-api",
        brokers: list,
        logLevel: logLevel.NOTHING,
      });
      const created = kafka.producer();
      await created.connect();
      producer = created;
      logger.info("Kafka producer connected", { topic: topic() });
      return created;
    })().catch((error: any) => {
      connecting = null;
      logger.warn("Kafka producer connect failed", { message: error?.message });
      return null;
    });
  }
  return connecting;
}

/** Publish on the existing transaction topic. notificationType MARBLE keeps it out of customer alerts. */
async function publish(scenario: string, resourceId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const current = await getProducer();
    if (!current) {
      logger.warn("Marble event skipped, KAFKA_BROKERS is unset", { scenario });
      return;
    }
    const tenantId = process.env.TENANT || "tn";
    await current.send({
      topic: topic(),
      messages: [
        {
          key: `${tenantId}-${resourceId}`,
          value: JSON.stringify({
            tenantId,
            action: "CREATION",
            entity: "MARBLE",
            resourceId,
            notificationType: "MARBLE",
            payload: { scenario, ...payload },
          }),
        },
      ],
    });
    logger.info("Marble event published", { scenario, resourceId, topic: topic() });
  } catch (error: any) {
    logger.warn("Marble event publish failed", { scenario, message: error?.message });
  }
}

export function beneficiaryObjectId(accountId: string | number | undefined, beneficiaryId: string): string {
  return accountId != null && String(accountId) !== ""
    ? `beneficiary:${accountId}:${beneficiaryId}`
    : `beneficiary:${beneficiaryId}`;
}

export async function fineractClientIdForUser(userId: string, tenantId: string): Promise<string | null> {
  try {
    const clients = await getClients(userId, tenantId);
    if (!Array.isArray(clients) || clients.length === 0 || clients[0]?.id == null) return null;
    return String(clients[0].id);
  } catch (error: any) {
    logger.warn("Marble client lookup failed", { message: error?.message });
    return null;
  }
}

function defaultCurrency(): string {
  const explicit = (process.env.DEFAULT_CURRENCY || "").trim();
  if (explicit) return explicit.toUpperCase();
  return (process.env.COUNTRY_CODE || "TN").toUpperCase() === "TN" ? "TND" : "EUR";
}

function defaultCountry(): string {
  return (process.env.COUNTRY_CODE || "TN").trim().toUpperCase() || "TN";
}

/** After a Fineract client and savings account are created. */
export async function notifyUserCreated(input: {
  clientId: string | number;
  externalId?: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  nationality?: string;
  country?: string;
  accountId?: string | number;
  accountReference?: string;
  currency?: string;
}): Promise<void> {
  const clientId = String(input.clientId);
  await publish("user_created", `client:${clientId}`, {
    clientId,
    externalId: input.externalId,
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate,
    nationality: input.nationality,
    country: input.country || defaultCountry(),
    accountId: input.accountId != null ? String(input.accountId) : undefined,
    accountReference: input.accountReference,
    currency: input.currency || defaultCurrency(),
  });
}

/** After a beneficiary row is saved. */
export async function notifyBeneficiaryAdded(input: {
  beneficiaryId: string;
  customerId?: string;
  accountId?: string | number;
  firstName?: string;
  lastName?: string;
  iban?: string;
  swift?: string;
  country?: string;
  type?: string;
}): Promise<void> {
  await publish("beneficiary_added", `beneficiary:${input.beneficiaryId}`, {
    beneficiaryId: input.beneficiaryId,
    customerId: input.customerId,
    accountId: input.accountId != null ? String(input.accountId) : undefined,
    firstName: input.firstName,
    lastName: input.lastName,
    iban: input.iban,
    swift: input.swift,
    country: input.country || defaultCountry(),
    type: input.type,
  });
}

/** Outgoing transfer. Incoming credits arrive as the existing Fineract DEPOSIT event. */
export async function notifyTransaction(input: {
  objectId: string;
  direction: "in" | "out";
  amount: number;
  currency?: string;
  country?: string;
  customerId?: string;
  accountId?: string | number;
  counterpartyName?: string;
  counterpartyId?: string;
  transactionType?: string;
  channel?: string;
  paymentReference?: string;
  status?: string;
  occurredAt?: string;
}): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return;
  const scenario = input.direction === "in" ? "deposit" : "transfer";
  await publish(scenario, input.objectId, {
    objectId: input.objectId,
    direction: input.direction,
    amount: input.amount,
    currency: input.currency || defaultCurrency(),
    country: input.country || defaultCountry(),
    customerId: input.customerId,
    accountId: input.accountId != null ? String(input.accountId) : undefined,
    counterpartyName: input.counterpartyName,
    counterpartyId: input.counterpartyId,
    transactionType: input.transactionType,
    channel: input.channel,
    paymentReference: input.paymentReference,
    status: input.status,
    occurredAt: input.occurredAt,
  });
}
