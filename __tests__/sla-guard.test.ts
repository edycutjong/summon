import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleSlaGuard } from '../src/sla-guard.js';
import * as telegram from '../src/telegram.js';

vi.mock('../src/telegram.js', () => ({
  cancelPendingApproval: vi.fn(),
}));

describe('SLA Guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('schedules a timer based on paidAt and slaMinutes', () => {
    const client = { rejectOrder: vi.fn() };
    const paidAt = new Date().toISOString();
    
    const cancel = scheduleSlaGuard(client, {
      orderId: 'order_1',
      slaMinutes: 10,
      paidAt,
      guardMs: 60_000,
    });

    expect(vi.getTimerCount()).toBe(1);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fires rejectOrder and cancels pending approval when timer triggers', async () => {
    const client = { rejectOrder: vi.fn().mockResolvedValue({}) };
    const now = Date.now();
    const paidAt = new Date(now).toISOString();
    
    scheduleSlaGuard(client, {
      orderId: 'order_2',
      slaMinutes: 10,
      paidAt,
      guardMs: 60_000,
    });

    // Fast forward to exactly the trigger time
    // 10 minutes - 60s = 9 minutes
    vi.advanceTimersByTime(9 * 60 * 1000);
    
    // Allow promises to resolve
    await Promise.resolve();

    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_2');
    expect(client.rejectOrder).toHaveBeenCalledWith('order_2', expect.stringContaining('clean refund'));
  });

  it('safely handles client.rejectOrder throwing', async () => {
    const client = { rejectOrder: vi.fn().mockRejectedValue(new Error('Already resolved')) };
    const paidAt = new Date().toISOString();
    
    scheduleSlaGuard(client, {
      orderId: 'order_3',
      slaMinutes: 1,
      paidAt,
      guardMs: 10_000,
    });

    // 1 minute - 10s = 50s
    vi.advanceTimersByTime(50_000);
    await Promise.resolve();

    expect(telegram.cancelPendingApproval).toHaveBeenCalledWith('order_3');
    expect(client.rejectOrder).toHaveBeenCalled();
    // Should not bubble up exception
  });

  it('sets a minimum delay of 1000ms if deadline is already close or passed', () => {
    const client = { rejectOrder: vi.fn() };
    // Set paidAt to an hour ago
    const paidAt = new Date(Date.now() - 3600_000).toISOString();
    
    scheduleSlaGuard(client, {
      orderId: 'order_4',
      slaMinutes: 10,
      paidAt,
    });

    // Should fire after exactly 1000ms
    vi.advanceTimersByTime(999);
    expect(client.rejectOrder).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(1);
    expect(client.rejectOrder).toHaveBeenCalled();
  });
});
