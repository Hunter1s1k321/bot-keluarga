import { logger } from '../logger.js';

/** Ambil teks dari berbagai tipe pesan WA (chat biasa / caption gambar / dll). */
export function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.documentMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

/**
 * Handler pesan masuk.
 * TAHAP 2 (sekarang): cuma log + command uji:
 *   - "ping"  -> balas "pong"
 *   - "!jid"  -> balas JID + nama grup (buat isi FAMILY_GROUP_JID di .env)
 * Fitur mention/AI/calendar ditambah di step berikutnya.
 */
export async function handleMessage(sock, msg) {
  if (msg.key.fromMe) return; // abaikan pesan dari bot sendiri
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;

  const isGroup = jid.endsWith('@g.us');
  const text = extractText(msg).trim();
  const sender = msg.pushName || msg.key.participant || jid;

  logger.info(
    `[pesan] grup=${isGroup} dari="${sender}" jid=${jid} teks="${text}"`
  );

  const lower = text.toLowerCase();

  if (lower === 'ping') {
    await sock.sendMessage(jid, { text: 'pong 🏓' }, { quoted: msg });
    return;
  }

  if (lower === '!jid') {
    let info = `JID chat ini:\n${jid}`;
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(jid);
        info =
          `Grup: *${meta.subject}*\n` +
          `JID: ${jid}\n\n` +
          `Copy JID di atas ke FAMILY_GROUP_JID di file .env`;
      } catch (e) {
        logger.warn(e, 'Gagal ambil metadata grup');
      }
    }
    await sock.sendMessage(jid, { text: info }, { quoted: msg });
    logger.info(`[!jid] terkirim untuk ${jid}`);
    return;
  }
}
