import { logger } from '../logger.js';
import { detectTrigger } from './trigger.js';
import { runAgent } from '../ai/agent.js';
import { isQuotaError } from '../ai/gemini.js';
import { detectMedia, downloadAsBase64 } from '../utils/media.js';
import { getHistory, pushTurn, clearHistory } from './conversation.js';
import { identify, senderNumber } from '../people.js';
import { buildMorningDigest, checkReminders } from '../scheduler/cron.js';
import { applyMentions } from './tagging.js';

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

// Balas + otomatis TAG anggota keluarga yang namanya kesebut.
const reply = (sock, jid, msg, text) => {
  const { text: t, mentions } = applyMentions(text);
  return sock.sendMessage(jid, { text: t, mentions }, { quoted: msg });
};

/** Buang label internal "[nama]:" yang kadang bocor dari output model. */
function cleanReply(text) {
  const lines = (text || '').replace(/\r/g, '').split('\n');
  while (lines.length && /^\s*\[[^\]]{1,25}\]:/.test(lines[0])) lines.shift();
  return lines.join('\n').trim();
}

export async function handleMessage(sock, msg) {
  if (msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;

  const isGroup = jid.endsWith('@g.us');
  const text = extractText(msg).trim();
  const sender = msg.pushName || msg.key.participant || jid;
  const lower = text.toLowerCase();

  // --- command uji (tanpa perlu tag) ---
  if (lower === 'ping') return void (await reply(sock, jid, msg, 'pong 🏓'));
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
    return void (await reply(sock, jid, msg, info));
  }
  if (lower === '!reset') {
    clearHistory(jid);
    return void (await reply(sock, jid, msg, '🧹 Oke, konteks obrolan aku lupain ya.'));
  }
  if (lower === '!pagi') {
    // tes manual rekap pagi (hari ini + besok)
    const text = await buildMorningDigest();
    return void (await reply(sock, jid, msg, text));
  }
  if (lower === '!ingat') {
    // tes manual cek reminder (1 jam & 5 menit sebelum acara)
    await checkReminders(sock);
    return void (await reply(sock, jid, msg, '(cek reminder dijalanin)'));
  }
  if (lower === '!whoami') {
    const num = senderNumber(msg);
    const p = identify(num);
    return void (await reply(
      sock,
      jid,
      msg,
      `Nomor kebaca: ${num || '(gak kebaca)'}\nDikenal sebagai: ${p ? `${p.name} (${p.nick})` : 'BELUM terdaftar'}`
    ));
  }

  // identitas pengirim -> panggilan; label internal buat konteks
  const person = identify(senderNumber(msg));
  const nick = person?.nick || msg.pushName || 'kak';
  const det = detectMedia(msg);
  const uttered = `[${nick}]: ${text || (det ? '(kirim gambar/PDF jadwal)' : '')}`;

  const { mode } = detectTrigger(sock, msg, text);

  // Pesan yang gak direspons pun tetap disimpan ke konteks (biar bot "nyimak"
  // obrolan & nyambung kalau nanti dipanggil / proaktif).
  if (mode === 'none') {
    if (text) pushTurn(jid, 'user', uttered);
    return;
  }

  const directlyAddressed = mode === 'direct';
  logger.info(`[trigger:${mode}] dari="${sender}" teks="${text}"`);

  if (det?.unsupported) {
    if (directlyAddressed) {
      await reply(sock, jid, msg, '📎 File itu belum bisa kubaca. Kirim foto/gambar jadwal atau PDF ya.');
    }
    return;
  }
  if (!text && !det) {
    if (directlyAddressed) await reply(sock, jid, msg, 'Iya? 🙂 Ada yang bisa aku bantu?');
    return;
  }

  try {
    const media = [];
    if (det) {
      if (directlyAddressed) await reply(sock, jid, msg, '⏳ Bentar, lagi kubaca...');
      const dl = await downloadAsBase64(sock, msg);
      if (dl) media.push(dl);
    }

    const history = getHistory(jid);
    const { reply: answer, toolsUsed } = await runAgent({
      text: uttered,
      media,
      history,
      mode: directlyAddressed ? 'direct' : 'proactive',
      speaker: nick,
    });
    logger.info({ toolsUsed, nick, mode }, '[agent selesai]');

    const finalText = cleanReply(answer);

    // Mode proaktif: kalau agent mutusin gak ada yang perlu (SKIP/kosong) -> diam.
    if (!directlyAddressed && (!finalText || /^skip\b/i.test(finalText))) {
      pushTurn(jid, 'user', uttered); // tetap simpan konteksnya
      logger.info('[proaktif] SKIP -> diam');
      return;
    }

    const out = finalText || 'hmm bingung aku 😅';
    pushTurn(jid, 'user', uttered);
    pushTurn(jid, 'model', out);
    await reply(sock, jid, msg, out);
  } catch (e) {
    logger.error(e, 'Gagal proses pesan');
    if (directlyAddressed) {
      const t = isQuotaError(e)
        ? '😴 Lagi kena batas kuota Gemini. Coba lagi nanti ya 🙏'
        : '⚠️ Waduh gagal proses. Cek koneksi/API ya.';
      await reply(sock, jid, msg, t);
    }
  }
}
