/**
 * Summon — Provider module.
 *
 * Accepts "human sign-off" orders, sends Approve/Reject to Telegram,
 * waits for human response, and delivers the result on-chain.
 *
 * Scope: Approve/Reject ONLY (image and answer modes were cut).
 */

import { runProvider } from '@edycutjong/croo-core';
import type { Deliverable } from '@edycutjong/croo-core';
import { sendApprovalPrompt } from './telegram.js';
import { scheduleSlaGuard } from './sla-guard.js';

// ─── Input / Output Types ──────────────────────────────────────────

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
  return runProvider<any>(client, {
    serviceMatch: (event: any) => {
      if (event.service_id !== serviceId) return false;

      // Surge Pricing Logic
      const hour = new Date().getUTCHours();
      // US Business hours: roughly 13:00 to 22:00 UTC (9am - 6pm EST)
      const isUSBusinessHours = hour >= 13 && hour <= 22;
      const offerUsdc = parseFloat((event.amount_offered || event.amount || '0') as string);

      // Prevent NaN from bypassing the surge logic
      if (!isUSBusinessHours && (Number.isNaN(offerUsdc) || offerUsdc < 5.0)) {
        console.warn(
          `[summon] ⚠️ Protocol Flex: Rejecting SLA for ${event.negotiation_id} — Off-hours surge pricing active. Minimum 5.0 USDC required, offered ${offerUsdc}.`
        );
        return false;
      }

      return true;
    },

    work: async (order: any): Promise<Deliverable<any>> => {
      // Data Safety: Strict runtime validation
      const input = order.requirement;
      if (!input || typeof input !== 'object' || typeof input.prompt !== 'string') {
        throw new Error('Invalid requirement: "prompt" must be a valid string');
      }

      console.log(`[summon] Order ${order.id}: sending approval prompt to Telegram...`);

      // File Handoff Flex: Fetch presigned URL if an imageKey is provided
      let imageUrl: string | undefined;
      if (typeof input.imageKey === 'string' && input.imageKey.trim() !== '') {
        try {
          console.log(`[summon] Order ${order.id}: Fetching presigned URL for imageKey...`);
          imageUrl = await client.getDownloadURL(input.imageKey);
        } catch (fetchErr) {
          console.warn(`[summon] ⚠️ Failed to fetch URL for imageKey ${input.imageKey}. Proceeding text-only.`, fetchErr);
        }
      }

      // Schedule SLA guard
      const cancelGuard = scheduleSlaGuard(client, {
        orderId: order.id,
        slaMinutes: order.sla_minutes ?? 10,
        paidAt: order.paid_at ?? new Date().toISOString(),
        guardMs: 60_000,
      });

      try {
        const promptText = typeof input.context === 'string'
          ? `${input.prompt}\n\n<i>Context: ${input.context}</i>`
          : input.prompt;

        const result = await sendApprovalPrompt(order.id, promptText, imageUrl);

        console.log(
          `[summon] Order ${order.id}: human ${result.approved ? 'APPROVED' : 'REJECTED'} in ${result.ms}ms`,
        );

        return {
          type: 'schema',
          data: result,
        };
      } catch (err: any) {
        if (err.message === 'SLA_TIMEOUT') {
          console.warn(`[summon] Order ${order.id} was aborted locally due to SLA timeout.`);
          throw err;
        }
        throw err;
      } finally {
        cancelGuard();
      }
    },

    slaGuardMs: 60_000,
  });
}
