/**
 * Summon — Telegram bridge for human sign-off.
 *
 * Sends an Approve/Reject prompt via Telegram inline keyboard
 * and waits for the human's tap. Returns the response as a
 * structured deliverable.
 *
 * Required env vars:
 * - TELEGRAM_BOT_TOKEN — from @BotFather
 * - TELEGRAM_CHAT_ID — the approver's chat ID
 */

// 1. Add HTML escape utility at the top
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline keyboard markup for Approve/Reject buttons. */
interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** Pending approval waiting for human tap. */
interface PendingApproval {
  orderId: string;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  sentAt: number;
}

// ─── State ─────────────────────────────────────────────────────────

const pendingApprovals = new Map<string, PendingApproval>();
let pollingActive = false;
let lastUpdateId = 0;

// ─── Configuration ─────────────────────────────────────────────────

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN env var');
  return token;
}

function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('Missing TELEGRAM_CHAT_ID env var');
  return chatId;
}

// ─── Send Message ──────────────────────────────────────────────────

/**
 * Send an Approve/Reject prompt to the configured Telegram chat.
 *
 * @param orderId - The CROO order ID (used as callback_data prefix)
 * @param prompt - The human-readable prompt text
 * @returns Promise that resolves when the human taps a button
 */
export async function sendApprovalPrompt(
  orderId: string,
  prompt: string,
): Promise<{ approved: boolean; by: string; ms: number }> {
  const token = getBotToken();
  const chatId = getChatId();

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve:${orderId}` },
        { text: '❌ Reject', callback_data: `reject:${orderId}` },
      ],
    ],
  };

  const safePrompt = escapeHtml(prompt);
  const message = `🔔 <b>Agent Sign-Off Request</b>\n\nOrder: <code>${orderId}</code>\n\n${safePrompt}`;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      }),
      signal: AbortSignal.timeout(15000), // Prevent sending hangs
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }

  // Wait for the human's tap
  const sentAt = Date.now();

  return new Promise<{ approved: boolean; by: string; ms: number }>((resolve, reject) => {
    pendingApprovals.set(orderId, { 
      orderId, 
      resolve: (approved) => {
        resolve({
          approved,
          by: `telegram:${chatId}`,
          ms: Date.now() - sentAt,
        });
      }, 
      reject,
      sentAt 
    });
  });
}

// ─── Poll for Callbacks ────────────────────────────────────────────

/**
 * Start polling for Telegram callback queries (button taps).
 * This runs in the background and resolves pending approvals.
 */
export async function startCallbackPolling(): Promise<void> {
  if (pollingActive) return;
  pollingActive = true;
  const token = getBotToken();
  const allowedChatId = getChatId();

  console.log('[summon/telegram] Starting callback polling...');

  while (pollingActive) {
    try {
      // Prevent unbounded socket hangs
      const response = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["callback_query"]`,
        { signal: AbortSignal.timeout(35000) }
      );

      if (!response.ok) {
        console.error('[summon/telegram] getUpdates failed:', response.status);
        await sleep(5000);
        continue;
      }

      const data = await response.json() as {
        ok: boolean;
        result: Array<{
          update_id: number;
          callback_query?: {
            id: string;
            data?: string;
            from?: { id: number; username?: string };
          };
        }>;
      };

      for (const update of data.result) {
        lastUpdateId = update.update_id;

        const callback = update.callback_query;
        if (!callback?.data || !callback?.from?.id) continue;

        // Security: Validate the user ID matches the configured approver
        if (callback.from.id.toString() !== allowedChatId) {
          console.warn(`[summon/telegram] ⚠️ Unauthorized approval attempt from user ${callback.from.id}`);
          continue;
        }

        const [action, ...orderIdParts] = callback.data.split(':');
        const orderId = orderIdParts.join(':');
        if (!orderId) continue;

        const pending = pendingApprovals.get(orderId);
        const approved = action === 'approve';

        // Performance & UX: Fire and forget the answerCallbackQuery to avoid blocking the event loop
        // Also do this BEFORE `if (!pending) continue;` to clear stale spinners
        fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: callback.id,
              text: pending ? (approved ? '✅ Approved!' : '❌ Rejected.') : '⚠️ Expired or already answered.',
              show_alert: !pending
            }),
            signal: AbortSignal.timeout(5000),
        }).catch(err => console.error('[summon/telegram] Failed to answer callback query:', err));

        if (!pending) continue;

        pending.resolve(approved);
        pendingApprovals.delete(orderId);
        
        console.log(`[summon/telegram] Order ${orderId}: ${approved ? 'APPROVED' : 'REJECTED'} by ${callback.from?.username ?? 'unknown'}`);
      }
    } catch (err: any) {
      if (err.name !== 'TimeoutError') {
        console.error('[summon/telegram] Polling error:', err);
        await sleep(5000);
      }
    }
  }
}

/**
 * Stop the callback polling loop.
 */
export function stopCallbackPolling(): void {
  pollingActive = false;
}

/**
 * Cancel a pending approval (used by SLA guard).
 */
export function cancelPendingApproval(orderId: string): boolean {
  const pending = pendingApprovals.get(orderId);
  if (pending) {
    pending.reject(new Error('SLA_TIMEOUT'));
    pendingApprovals.delete(orderId);
    return true;
  }
  return false;
}

// 6. Export clearPendingApprovals for Testing to avoid global state mock leaks
export function clearPendingApprovals(): void {
  for (const pending of pendingApprovals.values()) {
    pending.reject(new Error('TEARDOWN'));
  }
  pendingApprovals.clear();
}

/**
 * Get the number of pending approvals (for monitoring).
 */
export function getPendingCount(): number {
  return pendingApprovals.size;
}

// ─── Utility ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
