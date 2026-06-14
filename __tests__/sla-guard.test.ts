import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleSlaGuard } from '../src/sla-guard.js';
import * as telegram from '../src/telegram.js';

vi.mock('../src/telegram.js', () => ({
  cancelPendingApproval: vi.fn(),
}));

/** ISO timestamp `minutes` from now. */
function deadlineInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

describe('SLA Guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('schedules a timer derived from the SLA deadline', () => {
    const cancel = scheduleSlaGuard({
      orderId: 'order_1',
      slaDeadline: deadlineInMinutes(10),
      guardMs: 90_000,
    });

    expect(vi.getTimerCount()).toBe(1);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the pending approval when the timer fires', () => {
    vi.mocked(telegram.cancelPendingApproval).mockReturnValueOnce(true);
    scheduleSlaGuard({
      orderId: 'order_2',
      slaDeadline: deadlineInMinutes(10),
      guardMs: 90_000,
    });

    // 10 min - 90s = 8m30s
    vi.advanceTimersByTime(8 * 60 * 1000 + 30 * 1000);

    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_2');
  });

  it('does NOT call rejectOrder itself (single reject flows through the provider loop)', () => {
    const rejectOrder = vi.fn();
    // The guard signature no longer takes a client; this asserts the design:
    // even if a stray client existed, nothing on it is invoked.
    scheduleSlaGuard({
      orderId: 'order_3',
      slaDeadline: deadlineInMinutes(10),
      guardMs: 90_000,
    });

    vi.advanceTimersByTime(8 * 60 * 1000 + 30 * 1000);

    expect(rejectOrder).not.toHaveBeenCalled();
    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_3');
  });

  it('logs a no-op when nothing was pending at fire time', () => {
    vi.mocked(telegram.cancelPendingApproval).mockReturnValue(false);

    scheduleSlaGuard({
      orderId: 'order_4',
      slaDeadline: deadlineInMinutes(10),
      guardMs: 90_000,
    });

    vi.advanceTimersByTime(8 * 60 * 1000 + 30 * 1000);

    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_4');
  });

  it('uses a minimum delay of 1000ms when the deadline is already close or passed', () => {
    scheduleSlaGuard({
      orderId: 'order_5',
      slaDeadline: deadlineInMinutes(-60), // an hour ago
    });

    vi.advanceTimersByTime(999);
    expect(telegram.cancelPendingApproval).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_5');
  });

  it('falls back to a 10-minute window when the deadline is unparseable', () => {
    scheduleSlaGuard({
      orderId: 'order_6',
      slaDeadline: 'not-a-date',
      guardMs: 90_000,
    });

    // Fallback deadline = now + 10min, guard fires 90s before => 8m30s.
    vi.advanceTimersByTime(8 * 60 * 1000 + 29 * 1000);
    expect(telegram.cancelPendingApproval).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_6');
  });

  it('does nothing if the order is already resolved when the guard fires', () => {
    vi.mocked(telegram.cancelPendingApproval).mockReturnValue(false);

    scheduleSlaGuard({
      orderId: 'order_resolved',
      slaDeadline: deadlineInMinutes(10),
      guardMs: 90_000,
    });

    vi.advanceTimersByTime(8 * 60 * 1000 + 30 * 1000);

    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_resolved');
  });
});
