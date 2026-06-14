import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendApprovalPrompt,
  startCallbackPolling,
  stopCallbackPolling,
  cancelPendingApproval,
  clearPendingApprovals,
  getPendingCount,
} from '../src/telegram.js';

describe('Telegram Bridge', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    process.env.TELEGRAM_CHAT_ID = 'test_chat';
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    // Reset module-level singleton state so tests are order-independent.
    stopCallbackPolling();
    clearPendingApprovals();
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('Configuration', () => {
    it('throws if TELEGRAM_BOT_TOKEN is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      await expect(sendApprovalPrompt('order_1', 'prompt')).rejects.toThrow('Missing TELEGRAM_BOT_TOKEN');
    });

    it('throws if TELEGRAM_CHAT_ID is missing', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      await expect(sendApprovalPrompt('order_1', 'prompt')).rejects.toThrow('Missing TELEGRAM_CHAT_ID');
    });
  });

  describe('sendApprovalPrompt', () => {
    it('calls the sendMessage endpoint with the correct payload', async () => {
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      } as Response);

      // We don't await because it blocks waiting for user input.
      sendApprovalPrompt('order_1', 'Hello').catch(() => {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe('https://api.telegram.org/bottest_token/sendMessage');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(options?.body as string);
      expect(body.chat_id).toBe('test_chat');
      expect(body.text).toContain('order_1');
      expect(body.text).toContain('Hello');
      expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('approve:order_1');
      expect(body.reply_markup.inline_keyboard[0][1].callback_data).toBe('reject:order_1');

      await new Promise((r) => setTimeout(r, 10));
      cancelPendingApproval('order_1');
    });

    it('uses the sendPhoto endpoint when an image URL is provided', async () => {
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      } as Response);

      sendApprovalPrompt('order_img', 'Look', 'https://img.example/x.png').catch(() => {});

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bottest_token/sendPhoto');
      const body = JSON.parse(options?.body as string);
      expect(body.photo).toBe('https://img.example/x.png');
      expect(body.caption).toContain('Look');
      expect(body.text).toBeUndefined();

      await new Promise((r) => setTimeout(r, 10));
      cancelPendingApproval('order_img');
    });

    it('throws if the Telegram API responds with an error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(sendApprovalPrompt('order_2', 'prompt')).rejects.toThrow('Telegram API failed: 400 Bad Request');
    });

    it('adds a pending approval to the map', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

      sendApprovalPrompt('order_3', 'prompt').catch(() => {});
      await new Promise((r) => setTimeout(r, 10));

      expect(getPendingCount()).toBe(1);
      cancelPendingApproval('order_3');
      expect(getPendingCount()).toBe(0);
    });

    it('truncates a photo caption to the 1024-char limit without breaking entities', async () => {
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      } as Response);

      const longPrompt = '<'.repeat(2000); // expands ~4x when escaped
      sendApprovalPrompt('order_long', longPrompt, 'https://img.example/x.png').catch(() => {});

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.caption).toContain('... [truncated]');
      expect(body.caption.length).toBeLessThanOrEqual(1024);
      // No dangling partial HTML entity at the cut point.
      expect(body.caption.replace('... [truncated]', '')).not.toMatch(/&[^;]*$/);

      await new Promise((r) => setTimeout(r, 10));
      cancelPendingApproval('order_long');
    });

    it('truncates a long text message to the 4096-char limit', async () => {
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      } as Response);

      sendApprovalPrompt('order_text_long', 'A'.repeat(5000)).catch(() => {});

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.text).toContain('... [truncated]');
      expect(body.text.length).toBeLessThanOrEqual(4096);

      await new Promise((r) => setTimeout(r, 10));
      cancelPendingApproval('order_text_long');
    });
  });

  describe('cancelPendingApproval', () => {
    it('returns false if the order is not found', () => {
      expect(cancelPendingApproval('nonexistent')).toBe(false);
    });

    it('returns true and rejects the pending promise with SLA_TIMEOUT', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

      const promise = sendApprovalPrompt('order_cancel', 'prompt');
      await new Promise((r) => setTimeout(r, 10));

      expect(cancelPendingApproval('order_cancel')).toBe(true);
      await expect(promise).rejects.toThrow('SLA_TIMEOUT');
    });
  });

  describe('clearPendingApprovals', () => {
    it('rejects and clears all pending approvals with TEARDOWN', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const p1 = sendApprovalPrompt('order_clear_1', 'prompt');
      const p2 = sendApprovalPrompt('order_clear_2', 'prompt');
      await new Promise((r) => setTimeout(r, 10));
      expect(getPendingCount()).toBe(2);

      clearPendingApprovals();

      expect(getPendingCount()).toBe(0);
      await expect(p1).rejects.toThrow('TEARDOWN');
      await expect(p2).rejects.toThrow('TEARDOWN');
    });
  });

  describe('Polling', () => {
    it('polls getUpdates and resolves a pending approval on a callback', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true } as Response) // sendMessage
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              {
                update_id: 101,
                callback_query: {
                  id: 'cq2',
                  data: 'reject:poll_order_2',
                  from: { id: 'test_chat', username: 'operator' },
                },
              },
            ],
          }),
        } as Response) // getUpdates
        .mockImplementation(async () => {
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      const promise = sendApprovalPrompt('poll_order_2', 'prompt');
      await new Promise((r) => setTimeout(r, 10));

      startCallbackPolling();

      const result = await promise;
      expect(result.approved).toBe(false);
      expect(result.by).toBe('telegram:test_chat');
    });

    it('ignores callbacks from users not on the allowlist', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true } as Response) // sendMessage
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              {
                update_id: 102,
                callback_query: {
                  id: 'cq_unauth',
                  data: 'approve:poll_order_unauth',
                  from: { id: 999999, username: 'hacker' },
                },
              },
            ],
          }),
        } as Response) // getUpdates
        .mockImplementation(async () => {
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      sendApprovalPrompt('poll_order_unauth', 'prompt').catch(() => {});
      await new Promise((r) => setTimeout(r, 10));

      startCallbackPolling();
      await new Promise((r) => setTimeout(r, 50));

      // Unauthorized user ignored — the approval is still pending.
      expect(getPendingCount()).toBe(1);
      cancelPendingApproval('poll_order_unauth');
    });

    it('honors an explicit TELEGRAM_ALLOWED_USER_IDS allowlist', async () => {
      process.env.TELEGRAM_ALLOWED_USER_IDS = '555, 777';

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true } as Response) // sendMessage
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              {
                update_id: 110,
                callback_query: {
                  id: 'cq_allow',
                  data: 'approve:poll_order_allow',
                  from: { id: 777, username: 'approver' },
                },
              },
            ],
          }),
        } as Response) // getUpdates
        .mockImplementation(async () => {
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      const promise = sendApprovalPrompt('poll_order_allow', 'prompt');
      await new Promise((r) => setTimeout(r, 10));

      startCallbackPolling();

      const result = await promise;
      expect(result.approved).toBe(true);
      expect(result.by).toBe('telegram:777');
    });

    it('sleeps and continues when getUpdates returns a non-ok status', async () => {
      let callCount = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: false, status: 500 } as Response;
        }
        stopCallbackPolling();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      });

      vi.useFakeTimers();
      const pollPromise = startCallbackPolling();
      await vi.advanceTimersByTimeAsync(5000);
      await pollPromise;
      vi.useRealTimers();

      expect(callCount).toBeGreaterThan(0);
    });

    it('catches and logs errors thrown during getUpdates', async () => {
      let callCount = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network Error');
        }
        stopCallbackPolling();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      });

      vi.useFakeTimers();
      const pollPromise = startCallbackPolling();
      await vi.advanceTimersByTimeAsync(5000);
      await pollPromise;
      vi.useRealTimers();

      expect(callCount).toBeGreaterThan(0);
    });

    it('still resolves the approval if answerCallbackQuery fails', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true } as Response) // sendMessage
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              {
                update_id: 103,
                callback_query: {
                  id: 'cq_fail',
                  data: 'approve:poll_order_answer_fail',
                  from: { id: 'test_chat', username: 'operator' },
                },
              },
            ],
          }),
        } as Response) // getUpdates
        .mockImplementation(async (url) => {
          if (url.toString().includes('answerCallbackQuery')) {
            return Promise.reject(new Error('answerCallbackQuery failed'));
          }
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      const promise = sendApprovalPrompt('poll_order_answer_fail', 'prompt');
      await new Promise((r) => setTimeout(r, 10));

      startCallbackPolling();

      const result = await promise;
      expect(result.approved).toBe(true);
    });

    it('ignores startCallbackPolling if already active', async () => {
      let isDone = false;
      vi.mocked(fetch).mockImplementation(async () => {
        return new Promise(r => {
          const int = setInterval(() => {
            if (isDone) {
               clearInterval(int);
               r({ ok: true, json: async () => ({ ok: true, result: [] }) } as Response);
            }
          }, 10);
        });
      });
      const p1 = startCallbackPolling();
      const p2 = startCallbackPolling(); // this hits the early return
      isDone = true;
      stopCallbackPolling();
      await p1;
      await p2;
    });

    it('handles malformed callbacks, missing pending approvals, and TimeoutErrors gracefully', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              { update_id: 1, callback_query: { id: 'cq1' } }, // missing data/from
              { update_id: 2, callback_query: { id: 'cq2', data: 'approve', from: { id: 'test_chat' } } }, // missing orderId
              { update_id: 3, callback_query: { id: 'cq3', data: 'approve:no_pending', from: { id: 'test_chat' } } }, // no pending, no username
            ],
          }),
        } as Response)
        .mockImplementation(async () => {
          stopCallbackPolling();
          const err = new Error('Timeout');
          err.name = 'TimeoutError';
          throw err;
        });

      startCallbackPolling();
      await new Promise(r => setTimeout(r, 50));
    });
  });
});
