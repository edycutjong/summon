/**
 * Summon — Provider module.
 *
 * Accepts "human sign-off" orders, sends Approve/Reject to Telegram,
 * waits for human response, and delivers the result on-chain.
 *
 * Scope: Approve/Reject ONLY (image and answer modes were cut).
 */

import { runProvider } from 'croo-core';
import type { Order, Deliverable, NegotiationEvent } from 'croo-core';
import { sendApprovalPrompt } from './telegram.js';
import { scheduleSlaGuard } from './sla-guard.js';

// ─── Input / Output Types ──────────────────────────────────────────

interface SummonInput {
  /** The human-readable prompt to show the approver. */
  prompt: string;
  /** Optional context about who's asking and why. */
  context?: string;
}

interface SummonOutput {
  /** Whether the human approved. */
  approved: boolean;
  /** Who approved (e.g. "telegram:12345"). */
  by: string;
  /** Response time in milliseconds. */
  ms: number;
}

// ─── Provider ──────────────────────────────────────────────────────

/**
 * Start the Summon provider loop.
 *
 * @param client - An initialized CROO AgentClient
 * @param serviceId - The registered service ID for "Human Sign-off"
 */
export async function startSummonProvider(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  serviceId: string,
) {
  return runProvider<SummonInput, SummonOutput>(client, {
    serviceMatch: (event: NegotiationEvent) => {
      return event.service_id === serviceId;
    },

    work: async (order: Order<SummonInput>): Promise<Deliverable<SummonOutput>> => {
      const input = order.requirement;
      if (!input?.prompt) {
        throw new Error('Missing required field: prompt');
      }

      console.log(`[summon] Order ${order.id}: sending approval prompt to Telegram...`);

      // Schedule SLA guard (clean refund if human doesn't respond)
      const cancelGuard = scheduleSlaGuard(client, {
        orderId: order.id,
        slaMinutes: order.sla_minutes ?? 10,
        paidAt: order.paid_at ?? new Date().toISOString(),
        guardMs: 60_000,
      });

      try {
        const prompt = input.context
          ? `${input.prompt}\n\n_Context: ${input.context}_`
          : input.prompt;

        const result = await sendApprovalPrompt(order.id, prompt);

        console.log(
          `[summon] Order ${order.id}: human ${result.approved ? 'APPROVED' : 'REJECTED'} in ${result.ms}ms`,
        );

        return {
          type: 'schema',
          data: result,
        };
      } finally {
        cancelGuard();
      }
    },

    slaGuardMs: 60_000,
  });
}
