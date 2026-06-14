/**
 * Summon — Provider module.
 *
 * Accepts "human sign-off" orders, sends Approve/Reject to Telegram,
 * waits for human response, and delivers the result on-chain.
 *
 * Scope: Approve/Reject ONLY (image and answer modes were cut).
 */

import { runProvider } from '@edycutjong/croo-core';
import type { Deliverable, Order } from '@edycutjong/croo-core';
import { sendApprovalPrompt } from './telegram.js';
import { scheduleSlaGuard } from './sla-guard.js';

// ─── Output Type ───────────────────────────────────────────────────

interface SignOffResult {
  approved: boolean;
  by: string;
  ms: number;
}

/** Shape of the buyer's requirements (JSON-encoded on the negotiation). */
interface SignOffRequirement {
  prompt: string;
  context?: string;
  imageKey?: string;
}

// ─── Provider ──────────────────────────────────────────────────────

/**
 * Start the Summon provider loop.
 *
 * @param client - An initialized CROO AgentClient
 * @param serviceId - The registered service ID for "Human Sign-off"
 */
export async function startSummonProvider(
  client: any,
  serviceId: string,
): Promise<any> {
  return runProvider<SignOffResult>(client, {
    // Match on the service we registered. The offered price is fixed by the
    // service's on-chain pricing — it is not carried on the negotiation event,
    // so price gating must live in the service config, not here.
    serviceMatch: (event) => event.service_id === serviceId,

    work: async (order: Order): Promise<Deliverable<SignOffResult>> => {
      // The buyer's input lives on the negotiation as a JSON `requirements`
      // string — the Order itself does not carry it. Fetch and parse it.
      const requirement = await loadRequirement(client, order);

      console.log(`[summon] Order ${order.orderId}: sending approval prompt to Telegram...`);

      // File Handoff: fetch a presigned URL if an imageKey is provided.
      let imageUrl: string | undefined;
      if (typeof requirement.imageKey === 'string' && requirement.imageKey.trim() !== '') {
        try {
          console.log(`[summon] Order ${order.orderId}: fetching presigned URL for imageKey...`);
          imageUrl = await client.getDownloadURL(requirement.imageKey);
        } catch (fetchErr) {
          console.warn(
            `[summon] ⚠️ Failed to fetch URL for imageKey ${requirement.imageKey}. Proceeding text-only.`,
            fetchErr,
          );
        }
      }

      // Schedule the SLA guard. Its only job is to cancel the pending Telegram
      // approval just before the deadline so `work()` throws SLA_TIMEOUT and the
      // provider loop performs the single authoritative rejectOrder (clean
      // refund). It fires ahead of the SDK's own 60s guard so the human's
      // buttons are cleared and only one reject is issued.
      const cancelGuard = scheduleSlaGuard({
        orderId: order.orderId,
        slaDeadline: order.slaDeadline,
        guardMs: 90_000,
      });

      try {
        const promptText = typeof requirement.context === 'string'
          ? `${requirement.prompt}\n\n<i>Context: ${requirement.context}</i>`
          : requirement.prompt;

        const result = await sendApprovalPrompt(order.orderId, promptText, imageUrl);

        console.log(
          `[summon] Order ${order.orderId}: human ${result.approved ? 'APPROVED' : 'REJECTED'} in ${result.ms}ms`,
        );

        return {
          type: 'schema',
          data: result,
        };
      } catch (err) {
        if (err instanceof Error && err.message === 'SLA_TIMEOUT') {
          console.warn(`[summon] Order ${order.orderId} aborted locally — SLA timeout, deferring to clean refund.`);
        }
        throw err;
      } finally {
        cancelGuard();
      }
    },

    slaGuardMs: 60_000,
  });
}

/**
 * Load and validate the buyer's requirement from the order's negotiation.
 * Throws a descriptive error if the payload is missing or malformed.
 */
async function loadRequirement(client: any, order: Order): Promise<SignOffRequirement> {
  let raw: string;
  try {
    const negotiation = await client.getNegotiation(order.negotiationId);
    raw = negotiation?.requirements ?? '';
  } catch (err) {
    throw new Error(`Invalid requirement: failed to load negotiation ${order.negotiationId}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid requirement: "requirements" must be a valid JSON object');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as SignOffRequirement).prompt !== 'string'
  ) {
    throw new Error('Invalid requirement: "prompt" must be a valid string');
  }

  return parsed as SignOffRequirement;
}
