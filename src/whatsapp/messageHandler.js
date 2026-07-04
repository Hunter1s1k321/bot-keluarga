import { logger } from '../logger.js';
import { isBotMentioned, isReplyToBot } from './mentions.js';
import { extractEvents } from '../ai/gemini.js';
import { saveExtractedEvent } from '../calendar/calendar.js';
import { formatEventDate } from '../utils/dates.js';
import { detectMedia, downloadAsBase64 } from '../utils/media.js';

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

/** Format konfirmasi setelah event tersimpan ke Calendar. */
function formatSaved(saved) {
  const lines = saved.map((s, i) => {
    const st = s.event.start || {};
    const when = st.dateTime
      ? formatEventDate(st.dateTime)
      : `${st.date} (seharian)`;
    const loc = s.event.location ? `\n   📍 ${s.event.location}` : '';
    return `${i + 1}. *${s.summary}*\n   📅 ${when}${loc}`;
  });
  const head =
    saved.length === 1
      ? '✅ Udah dicatat di Calendar Keluarga:'
      : `✅ ${saved.length} acara udah dicatat di Calendar Keluarga:`;
  return `${head}\n\n${lines.join('\n\n')}`;
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

  // Deteksi lampiran (gambar/PDF jadwal)
  const det = detectMedia(msg);
  if (det?.unsupported) {
    await sock.sendMessage(
      jid,
      { text: '📎 File itu belum bisa kubaca. Kirim foto/gambar jadwal atau PDF ya.' },
      { quoted: msg }
    );
    return;
  }

  if (!text && !det) {
    await sock.sendMessage(
      jid,
      { text: 'Iya? Tag aku sambil kasih info acaranya (teks / foto jadwal / PDF) ya 🙂' },
      { quoted: msg }
    );
    return;
  }

  try {
    // Kalau ada lampiran, kasih tau lagi diproses (vision agak lama)
    const media = [];
    if (det) {
      await sock.sendMessage(
        jid,
        { text: '⏳ Lagi baca jadwalnya, bentar ya...' },
        { quoted: msg }
      );
      const dl = await downloadAsBase64(sock, msg);
      if (dl) media.push(dl);
    }

    const events = await extractEvents({ text, media });
    logger.info({ count: events.length }, '[ekstrak] hasil Gemini');

    if (!events.length) {
      await sock.sendMessage(
        jid,
        {
          text: '🔍 Gak nemu detail acara di pesan itu. Coba sebutin nama acara + tanggal + jam ya.',
        },
        { quoted: msg }
      );
      return;
    }

    // Simpan semua event ke Calendar
    const saved = [];
    for (const e of events) {
      try {
        saved.push(await saveExtractedEvent(e));
      } catch (err) {
        logger.error(err, `Gagal simpan event: ${e.title}`);
      }
    }

    if (!saved.length) {
      await sock.sendMessage(
        jid,
        { text: '⚠️ Berhasil baca acaranya tapi gagal simpan ke Calendar. Cek koneksi ya.' },
        { quoted: msg }
      );
      return;
    }
    await sock.sendMessage(jid, { text: formatSaved(saved) }, { quoted: msg });
  } catch (e) {
    logger.error(e, 'Gagal proses acara');
    await sock.sendMessage(
      jid,
      { text: '⚠️ Waduh gagal proses. Cek API key / koneksi ya.' },
      { quoted: msg }
    );
  }
}
