/**
 * Summon — Entry point.
 *
 * Starts the provider loop and Telegram callback polling.
 *
 * Required env vars:
 * - CROO_SDK_KEY — CROO API key (croo_sk_...)
 * - TELEGRAM_BOT_TOKEN — from @BotFather
 * - TELEGRAM_CHAT_ID — the approver's chat ID
 * - SUMMON_SERVICE_ID — registered service ID
 *
 * Optional:
 * - CROO_MOCK=true — offline mock mode (no USDC spent)
 */

import { makeClient, isMockMode } from '@edycutjong/croo-core';
import { startSummonProvider } from './provider.js';
import { startCallbackPolling } from './telegram.js';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  📱 Summon — Human-in-the-Loop Agent     ║');
  console.log('║  Approve/Reject via Telegram             ║');
  console.log(`║  Mode: ${isMockMode() ? '🧪 MOCK' : '🔴 LIVE (Base Mainnet)'}              ║`);
  console.log('╚══════════════════════════════════════════╝');

  const sdkKey = process.env.CROO_SDK_KEY;
  const serviceId = process.env.SUMMON_SERVICE_ID;

  if (!sdkKey && !isMockMode()) {
    console.error('Missing CROO_SDK_KEY. Set it or use CROO_MOCK=true for offline mode.');
    process.exit(1);
  }

  if (!serviceId) {
    console.error('Missing SUMMON_SERVICE_ID. Register the service in the CROO Dashboard first.');
    process.exit(1);
  }

  // Initialize the CROO client
  const client = isMockMode()
    ? {} // Mock mode doesn't need a real client
    : makeClient(sdkKey!);

  // Start Telegram callback polling (background)
  if (!isMockMode()) {
    startCallbackPolling().catch((err) => {
      console.error('[summon] Telegram polling crashed:', err);
      process.exit(1);
    });
  }

  // Start the provider loop
  const stream = await startSummonProvider(client, serviceId);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[summon] Shutting down...');
    if (stream && typeof stream.close === 'function') {
      stream.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[summon] Ready — waiting for orders...');
}

main().catch((err) => {
  console.error('[summon] Fatal error:', err);
  process.exit(1);
});
