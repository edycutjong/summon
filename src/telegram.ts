/**
 * Summon — Telegram bridge for human sign-off.
 *
 * Sends an Approve/Reject prompt via Telegram inline keyboard
 * and waits for the human's tap. Returns the response as a
 * structured deliverable.
 *
 * Required env vars:
 * - TELEGRAM_BOT_TOKEN — from @BotFather
 * - TELEGRAM_CHAT_ID — the chat the prompt is sent to
 *
 * Optional:
 * - TELEGRAM_ALLOWED_USER_IDS — comma-separated Telegram *user* IDs allowed to
 *   approve/reject. Defaults to TELEGRAM_CHAT_ID (correct for a 1:1 DM, where
 *   the chat ID equals the user ID). Set this explicitly for group chats.
 */

/** Escape user-supplied text for Telegram's HTML parse mode. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram length limits (UTF-16 code units, matched closely enough by .length).
const TG_TEXT_LIMIT = 4096;
const TG_CAPTION_LIMIT = 1024;
const TRUNCATION_SUFFIX = '... [truncated]';

/**
 * Truncate already-escaped HTML to `max` units without cutting an HTML entity
 * (e.g. `&lt;`) in half, appending a truncation marker when shortened.
 */
function truncateEscaped(escaped: string, max: number): string {
  if (escaped.length <= max) return escaped;
  const sliced = escaped
    .slice(0, Math.max(0, max - TRUNCATION_SUFFIX.length))
    // Drop a dangling partial entity (`&...` with no closing `;`).
    .replace(/&[^;]*$/, '');
  return sliced + TRUNCATION_SUFFIX;
}

/** Pending approval waiting for human tap. */
interface PendingApproval {
  orderId: string;
  resolve: (approved: boolean, by: string) => void;
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

/**
 * The set of Telegram *user* IDs allowed to approve/reject. Uses
 * TELEGRAM_ALLOWED_USER_IDS when set, otherwise falls back to TELEGRAM_CHAT_ID
 * (valid only for a 1:1 DM, where chat ID == user ID).
 */
function getAllowedUserIds(): Set<string> {
  const explicit = process.env.TELEGRAM_ALLOWED_USER_IDS;
  if (explicit && explicit.trim() !== '') {
    return new Set(explicit.split(',').map((id) => id.trim()).filter(Boolean));
  }
  return new Set([getChatId()]);
}

// ─── Send Message ──────────────────────────────────────────────────

/**
 * Send an Approve/Reject prompt to the configured Telegram chat.
 *
 * @param orderId - The CROO order ID (used as callback_data prefix)
 * @param prompt - The human-readable prompt text
 * @param imageUrl - Optional presigned URL for an image
 * @returns Promise that resolves when the human taps a button
 */
export async function sendApprovalPrompt(
  orderId: string,
  prompt: string,
  imageUrl?: string,
): Promise<{ approved: boolean; by: string; ms: number }> {
  const token = getBotToken();
  const chatId = getChatId();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve:${orderId}` },
        { text: '❌ Reject', callback_data: `reject:${orderId}` },
      ],
    ],
  };

  // Build the header first, then fit the (escaped) prompt into the remaining
  // budget. Photo captions are capped at 1024 chars, text messages at 4096.
  const header = `🔔 <b>Agent Sign-Off Request</b>\n\nOrder: <code>${escapeHtml(orderId)}</code>\n\n`;
  const limit = imageUrl ? TG_CAPTION_LIMIT : TG_TEXT_LIMIT;
  const safePrompt = truncateEscaped(escapeHtml(prompt), Math.max(0, limit - header.length));
  const textPayload = header + safePrompt;

  // Dynamically switch between text and photo endpoints.
  const endpoint = imageUrl ? 'sendPhoto' : 'sendMessage';

  const bodyPayload: any = {
    chat_id: chatId,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  };

  if (imageUrl) {
    bodyPayload.photo = imageUrl;
    bodyPayload.caption = textPayload;
  } else {
    bodyPayload.text = textPayload;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${endpoint}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API failed: ${response.status} ${body}`);
  }

  const sentAt = Date.now();

  return new Promise<{ approved: boolean; by: string; ms: number }>((resolve, reject) => {
    pendingApprovals.set(orderId, {
      orderId,
      resolve: (approved, by) => {
        resolve({
          approved,
          by,
          ms: Date.now() - sentAt,
        });
      },
      reject,
      sentAt,
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
  const allowedUserIds = getAllowedUserIds();

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

        // Security: only configured approver user IDs may approve/reject.
        if (!allowedUserIds.has(callback.from.id.toString())) {
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

        // Record the actual approving user (stable id) for the audit trail.
        pending.resolve(approved, `telegram:${callback.from.id}`);
        pendingApprovals.delete(orderId);

        /* v8 ignore next */
        console.log(`[summon/telegram] Order ${orderId}: ${approved ? 'APPROVED' : 'REJECTED'} by ${callback.from?.username ?? callback.from.id}`);
      }
    } catch (err: any) {
      /* v8 ignore next 3 */
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

/**
 * Reject and clear all pending approvals (used for test teardown).
 */
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
