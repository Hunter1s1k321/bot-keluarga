import { logger } from '../logger.js';
import { isBotMentioned, isReplyToBot } from './mentions.js';
import { extractEvents } from '../ai/gemini.js';

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

/** Format daftar event hasil ekstrak jadi teks preview yang enak dibaca. */
function formatPreview(events) {
  if (!events.length) {
    return '🔍 Gak nemu detail acara di pesan itu. Coba sebutin nama acara + tanggal + jam ya.';
  }
  const lines = events.map((e, i) => {
    const prefix = e.person ? `${e.person} - ` : '';
    const when = e.allDay
      ? `📅 ${e.date} (seharian)`
      : `📅 ${e.date}  ⏰ ${e.startTime || '?'}${e.endTime ? '-' + e.endTime : ''}`;
    const loc = e.location ? `\n   📍 ${e.location}` : '';
    return `${i + 1}. *${prefix}${e.title}*\n   ${when}${loc}`;
  });
  return (
    '🔍 *Hasil ekstrak (PREVIEW — belum disimpan ke Calendar):*\n\n' +
    lines.join('\n\n')
  );
}

/**
 * Handler pesan masuk.
 * TAHAP 3: bot merespons kalau DI-TAG (atau di-reply). Untuk sekarang, kalau
 * di-tag + ada teks acara -> tampilkan PREVIEW hasil ekstrak Gemini.
 * (Belum tulis ke Calendar; itu Step 4.)
 * Command uji lama tetap ada: ping / !jid.
 */
export async function handleMessage(sock, msg) {
  if (msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;

  const isGroup = jid.endsWith('@g.us');
  const text = extractText(msg).trim();
  const sender = msg.pushName || msg.key.participant || jid;
  const lower = text.toLowerCase();

  // --- command uji (tanpa perlu tag) ---
  if (lower === 'ping') {
    await sock.sendMessage(jid, { text: 'pong 🏓' }, { quoted: msg });
    return;
  }
  if (lower === '!jid') {
    let info = `JID chat ini:\n${jid}`;
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(jid);
        info = `Grup: *${meta.subject}*\nJID: ${jid}\n\nCopy JID ke FAMILY_GROUP_JID di .env`;
      } catch (e) {
        logger.warn(e, 'Gagal ambil metadata grup');
      }
    }
    await sock.sendMessage(jid, { text: info }, { quoted: msg });
    return;
  }

  // --- bot hanya bereaksi kalau DI-TAG (atau di-reply) di grup ---
  const tagged = isBotMentioned(sock, msg) || isReplyToBot(sock, msg);
  if (!tagged) return;

  logger.info(`[tagged] dari="${sender}" jid=${jid} teks="${text}"`);

  if (!text) {
    await sock.sendMessage(
      jid,
      { text: 'Iya? Tag aku sambil kasih info acaranya ya 🙂' },
      { quoted: msg }
    );
    return;
  }

  // Ekstrak acara dari teks (vision gambar/PDF menyusul di Step 5)
  try {
    const events = await extractEvents({ text });
    logger.info({ events }, '[ekstrak] hasil Gemini');
    await sock.sendMessage(jid, { text: formatPreview(events) }, { quoted: msg });
  } catch (e) {
    logger.error(e, 'Gagal ekstrak acara');
    await sock.sendMessage(
      jid,
      { text: '⚠️ Waduh gagal proses. Cek API key / koneksi ya.' },
      { quoted: msg }
    );
  }
}
