import { logger } from './logger.js';
import { startWhatsApp } from './whatsapp/client.js';
import { handleMessage } from './whatsapp/messageHandler.js';

async function main() {
  logger.info('=== Menyalakan Bot Keluarga ===');

  // TAHAP 2: baru koneksi WhatsApp + handler dasar (ping / !jid).
  // Cron & validasi config penuh ditambah di step berikutnya.
  await startWhatsApp({ onMessage: handleMessage });
}

main().catch((e) => {
  logger.error(e, 'Fatal error saat start');
  process.exit(1);
});
