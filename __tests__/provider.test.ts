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

    // Should use event.amount if amount_offered is missing
    expect(handlers.serviceMatch({ service_id: 'test_service', amount: '2.0', negotiation_id: 'n3' } as any)).toBe(false);
    
    // Should default to '0' if both are missing
    expect(handlers.serviceMatch({ service_id: 'test_service', negotiation_id: 'n4' } as any)).toBe(false);
    
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

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o2', 'Do it?\n\n<i>Context: Just testing</i>', undefined);
    
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

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o3', 'Just a prompt', undefined);
    expect(result.data.approved).toBe(false);
  });

  it('fetches presigned URL if imageKey is provided', async () => {
    const client = {
      getDownloadURL: vi.fn().mockResolvedValue('https://example.com/image.jpg'),
    };
    const handlers: any = await startSummonProvider(client, 'test_service');
    
    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: true,
      by: 'telegram:test',
      ms: 100,
    });

    await handlers.work({
      id: 'o4',
      requirement: { prompt: 'Check this image', imageKey: 'img123' },
    } as any);

    expect(client.getDownloadURL).toHaveBeenCalledWith('img123');
    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o4', 'Check this image', 'https://example.com/image.jpg');
  });

  it('proceeds text-only if getDownloadURL throws', async () => {
    const client = {
      getDownloadURL: vi.fn().mockRejectedValue(new Error('S3 error')),
    };
    const handlers: any = await startSummonProvider(client, 'test_service');
    
    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: true,
      by: 'telegram:test',
      ms: 100,
    });

    await handlers.work({
      id: 'o5',
      requirement: { prompt: 'Check this image', imageKey: 'img123' },
    } as any);

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o5', 'Check this image', undefined);
  });

  it('catches SLA_TIMEOUT and rethrows it', async () => {
    const handlers: any = await startSummonProvider({}, 'test_service');
    
    vi.mocked(telegram.sendApprovalPrompt).mockRejectedValueOnce(new Error('SLA_TIMEOUT'));

    await expect(handlers.work({
      id: 'o6',
      requirement: { prompt: 'Will timeout' },
    } as any)).rejects.toThrow('SLA_TIMEOUT');
  });

  it('catches generic errors and rethrows them', async () => {
    const handlers: any = await startSummonProvider({}, 'test_service');
    
    vi.mocked(telegram.sendApprovalPrompt).mockRejectedValueOnce(new Error('Generic Error'));

    await expect(handlers.work({
      id: 'o7',
      requirement: { prompt: 'Will error' },
    } as any)).rejects.toThrow('Generic Error');
  });
});
