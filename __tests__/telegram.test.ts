import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendApprovalPrompt,
  startCallbackPolling,
  stopCallbackPolling,
  cancelPendingApproval,
  getPendingCount,
  clearPendingApprovals,
} from '../src/telegram.js';

describe('Telegram Bridge', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    process.env.TELEGRAM_CHAT_ID = 'test_chat';
    
    // Clear pending approvals by cancelling any leftovers
    // In a real environment, we would expose a clear() method, but for now
    // we just know it's a map.
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = originalEnv;
    stopCallbackPolling();
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
    it('calls Telegram API with correct format', async () => {
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      } as Response);

      // We don't await because it blocks waiting for user input
      const _promise = sendApprovalPrompt('order_1', 'Hello').catch(() => {});
      
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

      // Wait a tick for the async function to populate the map
      await new Promise(r => setTimeout(r, 10));

      // Cleanup
      cancelPendingApproval('order_1');
    });

    it('throws if Telegram API fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(sendApprovalPrompt('order_2', 'prompt')).rejects.toThrow('Telegram API failed: 400 Bad Request');
    });

    it('adds pending approval to map', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
      
      sendApprovalPrompt('order_3', 'prompt').catch(() => {});
      
      // Allow promise to tick
      await new Promise(r => setTimeout(r, 10));
      
      expect(getPendingCount()).toBe(1);
      cancelPendingApproval('order_3');
      expect(getPendingCount()).toBe(0);
    });

    it('truncates very long prompts when imageUrl is provided', async () => {
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      } as Response);

      const longPrompt = 'A'.repeat(1000);
      const _promise = sendApprovalPrompt('order_long', longPrompt, 'http://image.url').catch(() => {});
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [_url, options] = fetchMock.mock.calls[0];
      
      const body = JSON.parse(options?.body as string);
      expect(body.caption).toContain('... [truncated]');
      expect(body.caption.length).toBeLessThan(1000);
      expect(body.photo).toBe('http://image.url');

      await new Promise(r => setTimeout(r, 10));
      cancelPendingApproval('order_long');
    });
  });

  describe('cancelPendingApproval', () => {
    it('returns false if order not found', () => {
      expect(cancelPendingApproval('nonexistent')).toBe(false);
    });

    it('returns true and resolves with false if order found', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
      
      const _promise = sendApprovalPrompt('order_cancel', 'prompt');
      await new Promise(r => setTimeout(r, 10));
      
      expect(cancelPendingApproval('order_cancel')).toBe(true);
      
      await expect(_promise).rejects.toThrow('SLA_TIMEOUT');
    });
  describe('Polling', () => {
    it('starts polling and handles updates', async () => {
      // Mock fetch to simulate an update
      const fetchMock = vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: [
            {
              update_id: 100,
              callback_query: {
                id: 'cq1',
                data: 'approve:poll_order',
                from: { id: 'test_chat', username: 'testuser' }
              }
            }
          ]
        })
      } as Response).mockImplementation(async () => {
        // Prevent infinite tight loop in mock
        stopCallbackPolling();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      });

      startCallbackPolling();
      
      // Start again while active, should return early
      const secondPoll = startCallbackPolling();
      expect(secondPoll).toBeInstanceOf(Promise); // Resolves immediately

      await new Promise(r => setTimeout(r, 20));

      expect(fetchMock).toHaveBeenCalled();
    });

    it('ignores updates without callback_query data or missing orderId', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              { update_id: 104 }, // No callback_query
              { update_id: 105, callback_query: { id: 'c1' } }, // No data/from
              { update_id: 106, callback_query: { id: 'c2', data: 'approve:', from: { id: 'test_chat' } } } // Missing orderId
            ]
          })
        } as Response)
        .mockImplementation(async () => {
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      startCallbackPolling();
      await new Promise(r => setTimeout(r, 20));
      // Handled silently, no errors thrown
    });

    it('ignores TimeoutError from getUpdates gracefully', async () => {
      let callCount = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('Timeout');
          err.name = 'TimeoutError';
          throw err;
        }
        stopCallbackPolling();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      });

      startCallbackPolling();
      await new Promise(r => setTimeout(r, 20));
      expect(callCount).toBeGreaterThan(0);
    });

    it('resolves pending approval via callback query (with and without username)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true } as Response) // sendMessage 1
        .mockResolvedValueOnce({ ok: true } as Response) // sendMessage 2
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
                  from: { id: 'test_chat', username: 'operator' }
                }
              },
              {
                update_id: 102,
                callback_query: {
                  id: 'cq3',
                  data: 'approve:poll_order_3',
                  from: { id: 'test_chat' } // No username
                }
              }
            ]
          })
        } as Response) // getUpdates
        .mockImplementation(async () => {
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        }); // answerCallbackQuery / future polls

      const p1 = sendApprovalPrompt('poll_order_2', 'prompt');
      const p2 = sendApprovalPrompt('poll_order_3', 'prompt');
      await new Promise(r => setTimeout(r, 10));
      
      startCallbackPolling();
      
      const result1 = await p1;
      expect(result1.approved).toBe(false);
      
      const result2 = await p2;
      expect(result2.approved).toBe(true);
    });

    it('handles getUpdates failing (status !ok) by sleeping and continuing', async () => {
      let callCount = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: getUpdates fails
          return { ok: false, status: 500 } as Response;
        }
        // Second call: stop polling to exit loop
        stopCallbackPolling();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      });

      // We need to bypass the real sleep to avoid a 5s delay in tests
      vi.useFakeTimers();
      const pollPromise = startCallbackPolling();
      
      // Advance time to flush the sleep(5000)
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

    it('ignores unauthorized approval attempts', async () => {
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
                  from: { id: 999999, username: 'hacker' }
                }
              }
            ]
          })
        } as Response) // getUpdates
        .mockImplementation(async () => {
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      sendApprovalPrompt('poll_order_unauth', 'prompt').catch(() => {});
      await new Promise(r => setTimeout(r, 10));
      
      startCallbackPolling();
      
      // Wait to ensure poll finishes
      await new Promise(r => setTimeout(r, 50));
      
      // The pending approval should still be there because the unauthorized user was ignored
      expect(getPendingCount()).toBe(1);
      cancelPendingApproval('poll_order_unauth');
    });

    it('handles answerCallbackQuery fetch failures gracefully', async () => {
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
                  from: { id: 'test_chat', username: 'operator' }
                }
              }
            ]
          })
        } as Response) // getUpdates
        .mockImplementation(async (url) => {
          if (url.toString().includes('answerCallbackQuery')) {
            return Promise.reject(new Error('answerCallbackQuery failed'));
          }
          stopCallbackPolling();
          return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
        });

      const _promise = sendApprovalPrompt('poll_order_answer_fail', 'prompt');
      await new Promise(r => setTimeout(r, 10));
      
      startCallbackPolling();
      
      // The pending approval should still resolve despite the answerCallbackQuery failing
      const result = await _promise;
      expect(result.approved).toBe(true);
    });
  });

  describe('clearPendingApprovals', () => {
    it('clears all pending approvals and rejects them with TEARDOWN', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
      
      const p1 = sendApprovalPrompt('order_clear_1', 'prompt');
      const p2 = sendApprovalPrompt('order_clear_2', 'prompt');
      
      await new Promise(r => setTimeout(r, 10));
      expect(getPendingCount()).toBe(2);
      
      clearPendingApprovals();
      
      expect(getPendingCount()).toBe(0);
      await expect(p1).rejects.toThrow('TEARDOWN');
      await expect(p2).rejects.toThrow('TEARDOWN');
    });
  });
});

});
