import { describe, it, expect, vi } from 'vitest';
import { startSummonProvider } from '../src/provider.js';
import * as telegram from '../src/telegram.js';
import * as crooCore from '@edycutjong/croo-core';

// Mock croo-core runProvider
vi.mock('@edycutjong/croo-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@edycutjong/croo-core')>();
  return {
    ...actual,
    runProvider: vi.fn().mockImplementation((client, handlers) => handlers),
  };
});

vi.mock('../src/telegram.js', () => ({
  sendApprovalPrompt: vi.fn(),
}));

describe('Summon Provider', () => {
  it('registers with runProvider using correct serviceId and allows valid price', async () => {
    const client = {};
    const handlers: any = await startSummonProvider(client, 'test_service');
    
    expect(crooCore.runProvider).toHaveBeenCalledWith(client, expect.any(Object));
    expect(handlers.serviceMatch({ service_id: 'test_service', amount_offered: '10.0' } as any)).toBe(true);
    expect(handlers.serviceMatch({ service_id: 'other', amount_offered: '10.0' } as any)).toBe(false);
    expect(handlers.slaGuardMs).toBe(60_000);
  });

  it('rejects during off-hours if offered amount is less than 5.0', async () => {
    const client = {};
    const handlers: any = await startSummonProvider(client, 'test_service');
    
    // Mock the Date to force off-hours (e.g. 23:00 UTC)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));
    
    expect(handlers.serviceMatch({ service_id: 'test_service', amount_offered: '2.0', negotiation_id: 'n1' } as any)).toBe(false);
    
    // Should accept if amount is >= 5.0 even in off-hours
    expect(handlers.serviceMatch({ service_id: 'test_service', amount_offered: '5.0', negotiation_id: 'n2' } as any)).toBe(true);
    
    vi.useRealTimers();
  });

  it('throws error if prompt is missing from requirement', async () => {
    const handlers: any = await startSummonProvider({}, 'test_service');
    
    await expect(handlers.work({
      id: 'o1',
      requirement: {},
    } as any)).rejects.toThrow('Invalid requirement: "prompt" must be a valid string');
  });

  it('calls sendApprovalPrompt and returns deliverable', async () => {
    const handlers: any = await startSummonProvider({}, 'test_service');
    
    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: true,
      by: 'telegram:test',
      ms: 1200,
    });

    const result = await handlers.work({
      id: 'o2',
      requirement: { prompt: 'Do it?', context: 'Just testing' },
    } as any);

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o2', 'Do it?\n\n<i>Context: Just testing</i>');
    
    expect(result.type).toBe('schema');
    expect(result.data.approved).toBe(true);
    expect(result.data.by).toBe('telegram:test');
  });

  it('calls sendApprovalPrompt without context if context is missing', async () => {
    const handlers: any = await startSummonProvider({}, 'test_service');
    
    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: false,
      by: 'telegram:test',
      ms: 100,
    });

    const result = await handlers.work({
      id: 'o3',
      requirement: { prompt: 'Just a prompt' },
    } as any);

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o3', 'Just a prompt');
    expect(result.data.approved).toBe(false);
  });
});
