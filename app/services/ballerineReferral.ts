import axios from "axios";
import { logger } from "../logger";
import { isApprovedWorkflow } from "./ballerineExchange";

const WORKFLOW_ID = process.env.PARRAINAGE_WORKFLOW_ID || "parrainage_validation";

export async function startParrainageWorkflow(input: {
  referrerUserId: string;
  referredUserId: string;
  invitedEmail: string;
  referralId: string;
  rewardAmount: number;
  currency: string;
  accountId?: string | null;
  firstName?: string;
  lastName?: string;
}): Promise<{ workflowRuntimeId: string } | null> {
  const baseUrl = (process.env.BALLERINE_ENDPOINT || "").replace(/\/$/, "");
  const apiKey = process.env.BALLERINE_API_KEY || "";
  if (!baseUrl || !apiKey) {
    logger.warn("Ballerine not configured — parrainage stays IN_REVIEW without workflow");
    return null;
  }

  try {
    const response = await axios.post(
      `${baseUrl}/api/v1/external/workflows/run`,
      {
        workflowId: WORKFLOW_ID,
        context: {
          entity: {
            type: "individual",
            id: `referral-${input.referredUserId}`,
            data: {
              firstName: input.firstName || "",
              lastName: input.lastName || "",
              email: input.invitedEmail,
              externalId: input.referredUserId,
              country: "TN",
            },
          },
          documents: [],
          parrainage: {
            referralId: input.referralId,
            referrerUserId: input.referrerUserId,
            referredUserId: input.referredUserId,
            invitedEmail: input.invitedEmail,
            rewardAmount: input.rewardAmount,
            currency: input.currency,
            accountId: input.accountId || "",
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    const workflowRuntimeId = String(response.data?.workflowRuntimeId || "");
    if (!workflowRuntimeId) {
      logger.error("Parrainage workflow returned no runtime id", { data: response.data });
      return null;
    }
    logger.info("Started parrainage_validation workflow", {
      workflowRuntimeId,
      referralId: input.referralId,
    });
    return { workflowRuntimeId };
  } catch (error: any) {
    logger.error("Could not start parrainage workflow", { error: error?.message });
    return null;
  }
}

export function isParrainageWebhook(payload: any): boolean {
  const id = String(payload?.workflowDefinitionId || payload?.data?.workflowDefinitionId || "");
  const configured = process.env.PARRAINAGE_WORKFLOW_ID || "parrainage_validation";
  if (id === configured || id === "parrainage_validation") return true;
  return Boolean(payload?.data?.parrainage || payload?.parrainage);
}

export { isApprovedWorkflow };
