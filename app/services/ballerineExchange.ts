import axios from "axios";
import { logger } from "../logger";

const WORKFLOW_ID = process.env.EXCHANGE_CURRENCY_WORKFLOW_ID || "exchange_currency";

export type ExchangeDocument = {
  fileName?: string;
  mimeType?: string;
  base64: string;
};

export async function startExchangeCurrencyWorkflow(input: {
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  toAmount: number;
  rate: number;
  fromCurrency: string;
  toCurrency: string;
  holdTransactionId: string;
  note?: string;
  document: ExchangeDocument;
}): Promise<{ workflowRuntimeId: string }> {
  const baseUrl = (process.env.BALLERINE_ENDPOINT || "").replace(/\/$/, "");
  const apiKey = process.env.BALLERINE_API_KEY || "";
  if (!baseUrl || !apiKey) {
    throw new Error("Ballerine is not configured for exchange review");
  }

  const mime = input.document.mimeType || "image/jpeg";
  const fileName = input.document.fileName || "fx-document.jpg";
  const dataUri = `data:${mime};base64,${input.document.base64}`;

  const response = await axios.post(
    `${baseUrl}/api/v1/external/workflows/run`,
    {
      workflowId: WORKFLOW_ID,
      context: {
        entity: {
          type: "individual",
          id: `fx-${input.userId}`,
          data: {
            firstName: input.firstName || "",
            lastName: input.lastName || "",
            email: input.email || "",
            phone: input.phone || "",
            externalId: input.userId,
            country: "TN",
          },
        },
        documents: [
          {
            type: "invoice",
            category: "proof_of_funds",
            issuer: { country: "TN" },
            version: 1,
            pages: [
              {
                uri: dataUri,
                metadata: { side: "front", fileName },
              },
            ],
          },
        ],
        exchange: {
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount,
          toAmount: input.toAmount,
          rate: input.rate,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          holdTransactionId: input.holdTransactionId,
          note: input.note || "",
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 30000,
    }
  );

  const workflowRuntimeId = String(response.data?.workflowRuntimeId || "");
  if (!workflowRuntimeId) {
    logger.error("Ballerine exchange workflow returned no runtime id", { data: response.data });
    throw new Error("Could not start exchange review");
  }
  logger.info("Started exchange_currency workflow", { workflowRuntimeId, userId: input.userId });
  return { workflowRuntimeId };
}

export function isExchangeCurrencyWebhook(payload: any): boolean {
  const id = String(
    payload?.workflowDefinitionId || payload?.data?.workflowDefinitionId || ""
  );
  const configured = process.env.EXCHANGE_CURRENCY_WORKFLOW_ID || "exchange_currency";
  if (id === configured || id === "exchange_currency") return true;
  return Boolean(payload?.data?.exchange || payload?.exchange);
}

export function isApprovedWorkflow(payload: any): boolean {
  const state = String(payload?.workflowFinalState || payload?.data?.workflowFinalState || "").toLowerCase();
  const status = String(payload?.workflowStatus || "").toLowerCase();
  if (state === "approved" || state === "resolved") return true;
  if (state === "rejected" || state === "revision") return false;
  const docs = payload?.data?.documents || payload?.documents || [];
  if (Array.isArray(docs) && docs.length > 0) {
    return docs.every((d: any) => String(d?.decision?.status || "").toLowerCase() === "approved");
  }
  return status === "completed" && state !== "rejected";
}
