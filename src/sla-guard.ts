/**
 * Summon — SLA guard module.
 *
 * Just before the SLA deadline, cancels the pending Telegram approval so the
 * human sees a "timed out" state instead of stale buttons, and so the provider
 * `work()` call throws SLA_TIMEOUT. The provider loop (croo-core) then performs
 * the single authoritative rejectOrder, giving the buyer a clean refund instead
 * of a stuck escrow.
 *
 * This guard intentionally does NOT call rejectOrder itself: the provider loop
 * already rejects on a thrown work() and runs its own deadline guard, so issuing
 * a reject here would double-reject and could race a just-delivered approval.
 */

import { cancelPendingApproval } from './telegram.js';

interface SlaGuardOptions {
  /** The CROO order ID. */
  orderId: string;
  /** The order's SLA deadline (ISO timestamp, from `order.slaDeadline`). */
  slaDeadline: string;
  /**
   * Milliseconds before the deadline to fire the guard. Default 90_000 (90s) —
   * deliberately ahead of the SDK provider loop's 60s guard so the Telegram UI
   * is cleared first and only one reject is issued.
   */
  guardMs?: number;
}

/**
 * Schedule cancellation of the pending approval before the SLA deadline.
 *
 * @returns A cleanup function that cancels the timer.
 */
export function scheduleSlaGuard(options: SlaGuardOptions): () => void {
  const { orderId, slaDeadline, guardMs = 90_000 } = options;

  const parsedDeadline = new Date(slaDeadline).getTime();
  // Fall back to 10 min from now if the deadline is missing or unparseable.
  const deadline = Number.isNaN(parsedDeadline)
    ? Date.now() + 10 * 60 * 1000
    : parsedDeadline;
  const triggerAt = deadline - guardMs;
  const delayMs = Math.max(triggerAt - Date.now(), 1000);

  console.log(
    `[summon/sla] Guard scheduled for order ${orderId}: ` +
    `fires in ${Math.round(delayMs / 1000)}s (${guardMs / 1000}s before SLA deadline)`,
  );

  const timer = setTimeout(() => {
    const cancelled = cancelPendingApproval(orderId);
    if (cancelled) {
      console.warn(
        `[summon/sla] ⚠️ SLA guard fired for order ${orderId} — human did not respond. ` +
        `Cancelling approval to trigger a clean refund before escrow expiry.`,
      );
    } else {
      console.log(`[summon/sla] Order ${orderId} already resolved, guard no-op`);
    }
  }, delayMs);

  return () => {
    clearTimeout(timer);
    console.log(`[summon/sla] Guard cancelled for order ${orderId}`);
  };
}
