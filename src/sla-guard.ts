/**
 * Summon — SLA guard module.
 *
 * Fires a safety rejectOrder before the SLA deadline expires,
 * ensuring the buyer gets a clean refund instead of a stuck escrow.
 * Also cancels the pending Telegram approval so the human sees
 * a "timed out" message instead of stale buttons.
 */

import { cancelPendingApproval } from './telegram.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentClient = any;

interface SlaGuardOptions {
  /** The CROO order ID. */
  orderId: string;
  /** SLA in minutes (from the order). */
  slaMinutes: number;
  /** When the order was paid (ISO timestamp). */
  paidAt: string;
  /** Milliseconds before SLA to fire the guard. Default 60_000 (60s). */
  guardMs?: number;
}

/**
 * Schedule an automatic rejection before the SLA deadline.
 *
 * @returns A cleanup function that cancels the timer.
 */
export function scheduleSlaGuard(
  client: AgentClient,
  options: SlaGuardOptions,
): () => void {
  const { orderId, slaMinutes, paidAt, guardMs = 60_000 } = options;

  const slaTotalMs = slaMinutes * 60 * 1000;
  const paidAtMs = new Date(paidAt).getTime();
  const deadline = paidAtMs + slaTotalMs;
  const triggerAt = deadline - guardMs;
  const delayMs = Math.max(triggerAt - Date.now(), 1000);

  console.log(
    `[summon/sla] Guard scheduled for order ${orderId}: ` +
    `fires in ${Math.round(delayMs / 1000)}s (${guardMs / 1000}s before SLA deadline)`,
  );

  const timer = setTimeout(async () => {
    console.warn(`[summon/sla] ⚠️ Protocol Flex: SLA guard firing for order ${orderId} — Triggering clean refund via rejectOrder before Base Mainnet escrow expiry.`);

    // Cancel the pending Telegram approval
    cancelPendingApproval(orderId);

    try {
      await client.rejectOrder(orderId, 'SLA guard: human did not respond in time — clean refund');
      console.log(`[summon/sla] Order ${orderId} rejected (clean refund to buyer)`);
    } catch (_err) {
      // Order may have already been delivered — safe to ignore
      console.log(`[summon/sla] Order ${orderId} already resolved, guard no-op`);
    }
  }, delayMs);

  return () => {
    clearTimeout(timer);
    console.log(`[summon/sla] Guard cancelled for order ${orderId}`);
  };
}
