import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { logger } from './logger.js';

const FILE = path.join(ROOT, '.pending-announce');

/**
 * Kalau ada penanda update (ditulis auto-update.cjs), umumin ke grup sekali.
 * Dipanggil pas WA connect.
 */
export async function announcePendingUpdate(sock) {
  if (!fs.existsSync(FILE)) return;
  let info = {};
  try {
    info = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    /* biar tetep kehapus */
  }
  try {
    fs.unlinkSync(FILE);
  } catch {
    /* abaikan */
  }

  const text =
    `🔧 eh btw aku barusan keupdate ke versi ${info.version || '?'} nih` +
    (info.subject ? `\n_${info.subject}_` : '');
  try {
    await sock.sendMessage(config.whatsapp.familyGroupJid, { text });
    logger.info('[update] pengumuman update terkirim');
  } catch (e) {
    logger.warn(e, 'gagal umumin update');
  }
}
