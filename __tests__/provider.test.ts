import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startSummonProvider } from '../src/provider.js';
import * as telegram from '../src/telegram.js';
import * as crooCore from '@edycutjong/croo-core';

// Mock croo-core runProvider so we can inspect the handlers it receives.
vi.mock('@edycutjong/croo-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@edycutjong/croo-core')>();
  return {
    ...actual,
    runProvider: vi.fn().mockImplementation((_client, handlers) => handlers),
  };
});

vi.mock('../src/telegram.js', () => ({
  sendApprovalPrompt: vi.fn(),
}));

// Stub the SLA guard so no real timers are scheduled during work() tests.
vi.mock('../src/sla-guard.js', () => ({
  scheduleSlaGuard: vi.fn(() => () => {}),
}));

/** Build an SDK-shaped Order (camelCase, no inline requirement). */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'o1',
    negotiationId: 'n1',
    serviceId: 'test_service',
    price: '1.0',
    paidAt: new Date().toISOString(),
    slaDeadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/** A client whose negotiation carries the given requirement payload. */
function clientWithRequirement(requirement: unknown, extra: Record<string, unknown> = {}) {
  return {
    getNegotiation: vi.fn().mockResolvedValue({
      negotiationId: 'n1',
      requirements: typeof requirement === 'string' ? requirement : JSON.stringify(requirement),
    }),
    ...extra,
  };
}

describe('Summon Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers with runProvider and matches only its own serviceId', async () => {
    const client = {};
    const handlers: any = await startSummonProvider(client, 'test_service');

    expect(crooCore.runProvider).toHaveBeenCalledWith(client, expect.any(Object));
    expect(handlers.serviceMatch({ service_id: 'test_service' } as any)).toBe(true);
    expect(handlers.serviceMatch({ service_id: 'other' } as any)).toBe(false);
    expect(handlers.slaGuardMs).toBe(60_000);
  });

  it('throws if the negotiation requirements lack a prompt', async () => {
    const client = clientWithRequirement({});
    const handlers: any = await startSummonProvider(client, 'test_service');

    await expect(handlers.work(makeOrder())).rejects.toThrow('Invalid requirement: "prompt"');
  });

  it('throws if the negotiation requirements are not valid JSON', async () => {
    const client = clientWithRequirement('not-json');
    const handlers: any = await startSummonProvider(client, 'test_service');

    await expect(handlers.work(makeOrder())).rejects.toThrow('valid JSON object');
  });

  it('throws if the negotiation cannot be loaded', async () => {
    const client = { getNegotiation: vi.fn().mockRejectedValue(new Error('boom')) };
    const handlers: any = await startSummonProvider(client, 'test_service');

    await expect(handlers.work(makeOrder())).rejects.toThrow('failed to load negotiation');
  });

  it('sends the approval prompt with context and returns a schema deliverable', async () => {
    const client = clientWithRequirement({ prompt: 'Do it?', context: 'Just testing' });
    const handlers: any = await startSummonProvider(client, 'test_service');

    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: true,
      by: 'telegram:42',
      ms: 1200,
    });

    const result = await handlers.work(makeOrder({ orderId: 'o2' }));

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith(
      'o2',
      'Do it?\n\n<i>Context: Just testing</i>',
      undefined,
    );
    expect(result.type).toBe('schema');
    expect(result.data.approved).toBe(true);
    expect(result.data.by).toBe('telegram:42');
  });

  it('sends the approval prompt without context when none is provided', async () => {
    const client = clientWithRequirement({ prompt: 'Just a prompt' });
    const handlers: any = await startSummonProvider(client, 'test_service');

    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: false,
      by: 'telegram:42',
      ms: 100,
    });

    const result = await handlers.work(makeOrder({ orderId: 'o3' }));

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o3', 'Just a prompt', undefined);
    expect(result.data.approved).toBe(false);
  });

  it('fetches a presigned image URL when an imageKey is provided', async () => {
    const client = clientWithRequirement(
      { prompt: 'Look at this', imageKey: 'img/key.png' },
      { getDownloadURL: vi.fn().mockResolvedValue('https://signed.example/img.png') },
    );
    const handlers: any = await startSummonProvider(client, 'test_service');

    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: true,
      by: 'telegram:42',
      ms: 50,
    });

    await handlers.work(makeOrder({ orderId: 'o4' }));

    expect(client.getDownloadURL).toHaveBeenCalledWith('img/key.png');
    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith(
      'o4',
      'Look at this',
      'https://signed.example/img.png',
    );
  });

  it('falls back to text-only when the image URL fetch fails', async () => {
    const client = clientWithRequirement(
      { prompt: 'Look at this', imageKey: 'img/key.png' },
      { getDownloadURL: vi.fn().mockRejectedValue(new Error('s3 down')) },
    );
    const handlers: any = await startSummonProvider(client, 'test_service');

    vi.mocked(telegram.sendApprovalPrompt).mockResolvedValueOnce({
      approved: true,
      by: 'telegram:42',
      ms: 50,
    });

    await handlers.work(makeOrder({ orderId: 'o5' }));

    expect(telegram.sendApprovalPrompt).toHaveBeenCalledWith('o5', 'Look at this', undefined);
  });

  it('rethrows an SLA_TIMEOUT raised while awaiting the human', async () => {
    const client = clientWithRequirement({ prompt: 'Will time out' });
    const handlers: any = await startSummonProvider(client, 'test_service');

    vi.mocked(telegram.sendApprovalPrompt).mockRejectedValueOnce(new Error('SLA_TIMEOUT'));

    await expect(handlers.work(makeOrder({ orderId: 'o6' }))).rejects.toThrow('SLA_TIMEOUT');
  });

  it('rethrows generic errors raised while awaiting the human', async () => {
    const client = clientWithRequirement({ prompt: 'Will error' });
    const handlers: any = await startSummonProvider(client, 'test_service');

    vi.mocked(telegram.sendApprovalPrompt).mockRejectedValueOnce(new Error('Generic Error'));

    await expect(handlers.work(makeOrder({ orderId: 'o7' }))).rejects.toThrow('Generic Error');
  });

  it('throws an error if the requirement payload is missing requirements', async () => {
    const handlers: any = await startSummonProvider({}, 'test_service');
    
    vi.mocked(crooCore.runProvider).mock.calls[0][0].getNegotiation = vi.fn().mockResolvedValue({});

    await expect(
      handlers.work({ orderId: 'o8', negotiationId: 'n8' } as any)
    ).rejects.toThrow('Invalid requirement: "requirements" must be a valid JSON object');
  });
});
