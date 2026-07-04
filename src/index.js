import { logger } from './logger.js';
import { validateForBot } from './config.js';
import { startWhatsApp } from './whatsapp/client.js';
import { handleMessage } from './whatsapp/messageHandler.js';
import { startScheduler } from './scheduler/cron.js';

async function main() {
  logger.info('=== Menyalakan Bot Keluarga ===');

  // Fail-fast kalau .env belum lengkap (GEMINI_API_KEY, CALENDAR_ID, FAMILY_GROUP_JID)
  validateForBot();

  await startWhatsApp({ onMessage: handleMessage });

  // Scheduler: rekap pagi + reminder 1 jam sebelum acara.
  // Pakai getSock() saat firing, jadi aman walau WA reconnect.
  startScheduler();
}

main().catch((e) => {
  logger.error(e, 'Fatal error saat start');
  process.exit(1);
});
