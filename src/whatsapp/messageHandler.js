import { logger } from '../logger.js';
import { detectTrigger } from './trigger.js';
import { runAgent } from '../ai/agent.js';
import { isQuotaError } from '../ai/gemini.js';
import { detectMedia, downloadAsBase64 } from '../utils/media.js';
import { getHistory, pushTurn, clearHistory } from './conversation.js';
import { identify, senderNumber } from '../people.js';

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

const reply = (sock, jid, msg, text) =>
  sock.sendMessage(jid, { text }, { quoted: msg });

/**
 * Handler utama.
 * - command uji: ping / !jid / !reset (lupakan konteks)
 * - kalau bot DI-TAG: serahkan ke AI agent (punya ingatan + bisa pakai alat
 *   calendar & web search), jawab natural.
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
    await reply(sock, jid, msg, 'pong 🏓');
    return;
  }
  if (lower === '!jid') {
    let info = `JID chat ini:\n${jid}`;
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(jid);
        info = `Grup: *${meta.subject}*\nJID: ${jid}`;
      } catch (e) {
        logger.warn(e, 'Gagal ambil metadata grup');
      }
    }
    await reply(sock, jid, msg, info);
    return;
  }
  if (lower === '!reset') {
    clearHistory(jid);
    await reply(sock, jid, msg, '🧹 Oke, konteks obrolan aku lupain ya.');
    return;
  }
  if (lower === '!whoami') {
    const num = senderNumber(msg);
    const p = identify(num);
    await reply(
      sock,
      jid,
      msg,
      `Nomor kebaca: ${num || '(gak kebaca)'}\nDikenal sebagai: ${p ? `${p.name} (${p.nick})` : 'BELUM terdaftar'}`
    );
    return;
  }

  // --- tentukan apakah bot merespons ---
  // respond via: tag / reply / sebut "claude" (langsung) ATAU pesan yang jelas
  // minta atur jadwal (requireAction: cuma balas kalau beneran ada aksi calendar)
  const trigger = detectTrigger(sock, msg, text);
  if (!trigger.respond) return;
  const directlyAddressed = !trigger.requireAction;

  logger.info(
    `[trigger] dari="${sender}" langsung=${directlyAddressed} teks="${text}"`
  );

  const det = detectMedia(msg);
  if (det?.unsupported) {
    if (directlyAddressed) {
      await reply(
        sock,
        jid,
        msg,
        '📎 File itu belum bisa kubaca. Kirim foto/gambar jadwal atau PDF ya.'
      );
    }
    return;
  }

  if (!text && !det) {
    if (directlyAddressed) await reply(sock, jid, msg, 'Iya? 🙂 Ada yang bisa aku bantu?');
    return;
  }

  try {
    // Lampiran -> download (+ ack kalau dipanggil langsung, vision agak lama)
    const media = [];
    if (det) {
      if (directlyAddressed) await reply(sock, jid, msg, '⏳ Bentar, lagi kubaca...');
      const dl = await downloadAsBase64(sock, msg);
      if (dl) media.push(dl);
    }

    // Identifikasi pengirim -> panggilan (Vel/pa/ma/vin/zio); prefix ke pesan
    const person = identify(senderNumber(msg));
    const nick = person?.nick || msg.pushName || 'kak';
    const uttered = `[${nick}]: ${text || '(kirim gambar/PDF jadwal)'}`;

    const history = getHistory(jid);
    const { reply: answer, toolsUsed } = await runAgent({
      text: uttered,
      media,
      history,
    });
    logger.info({ toolsUsed, nick, requireAction: trigger.requireAction }, '[agent selesai]');

    // Auto-trigger (gak dipanggil): cuma bersuara kalau beneran ada aksi calendar,
    // biar gak nyerobot obrolan yang kebetulan kena heuristik.
    const mutated =
      toolsUsed.includes('create_events') || toolsUsed.includes('delete_events');
    if (trigger.requireAction && !mutated) {
      logger.info('[auto-trigger] tanpa aksi calendar -> diam');
      return;
    }

    const finalText = answer || 'hmm bingung aku 😅';
    pushTurn(jid, 'user', uttered);
    pushTurn(jid, 'model', finalText);
    await reply(sock, jid, msg, finalText);
  } catch (e) {
    logger.error(e, 'Gagal proses pesan');
    const text2 = isQuotaError(e)
      ? '😴 Lagi kena batas kuota Gemini. Coba lagi nanti ya 🙏'
      : '⚠️ Waduh gagal proses. Cek koneksi/API ya.';
    await reply(sock, jid, msg, text2);
  }
}
