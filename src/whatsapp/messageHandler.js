import { logger } from '../logger.js';
import { isBotMentioned, isReplyToBot } from './mentions.js';
import {
  extractEvents,
  understand,
  answerQuery,
  chat,
  isQuotaError,
} from '../ai/gemini.js';
import {
  saveExtractedEvent,
  listEvents,
  deleteEvent,
} from '../calendar/calendar.js';
import {
  formatEventDate,
  ymd,
  addDays,
  dayStartISO,
  dayEndISO,
} from '../utils/dates.js';
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

const reply = (sock, jid, msg, text) =>
  sock.sendMessage(jid, { text }, { quoted: msg });

/** Kapan sebuah event Google -> teks enak dibaca. */
function whenText(event) {
  const st = event.start || {};
  return st.dateTime ? formatEventDate(st.dateTime) : `${st.date} (seharian)`;
}

/** Daftar event Google -> teks (buat konteks jawaban / listing). */
function eventsToText(events) {
  return events
    .map((e) => {
      const loc = e.location ? ` (${e.location})` : '';
      return `- ${e.summary} — ${whenText(e)}${loc}`;
    })
    .join('\n');
}

/** Konfirmasi setelah event tersimpan. */
function formatSaved(saved) {
  const lines = saved.map((s, i) => {
    const loc = s.event.location ? `\n   📍 ${s.event.location}` : '';
    return `${i + 1}. *${s.summary}*\n   📅 ${whenText(s.event)}${loc}`;
  });
  const head =
    saved.length === 1
      ? '✅ Udah dicatat di Calendar Keluarga:'
      : `✅ ${saved.length} acara udah dicatat di Calendar Keluarga:`;
  return `${head}\n\n${lines.join('\n\n')}`;
}

/** Simpan daftar event hasil ekstrak + balas konfirmasi. */
async function saveAndConfirm(sock, jid, msg, events) {
  if (!events.length) {
    await reply(
      sock,
      jid,
      msg,
      '🔍 Info acaranya kurang lengkap. Sebutin nama acara + tanggal + jam ya.'
    );
    return;
  }
  const saved = [];
  for (const e of events) {
    try {
      saved.push(await saveExtractedEvent(e));
    } catch (err) {
      logger.error(err, `Gagal simpan event: ${e.title}`);
    }
  }
  if (!saved.length) {
    await reply(
      sock,
      jid,
      msg,
      '⚠️ Berhasil baca acaranya tapi gagal simpan ke Calendar. Cek koneksi ya.'
    );
    return;
  }
  await reply(sock, jid, msg, formatSaved(saved));
}

/** Filter event Google berdasar nama orang / kata kunci di judul. */
function matchEvents(events, { person, keyword }) {
  return events.filter((e) => {
    const s = (e.summary || '').toLowerCase();
    if (person && !s.includes(person.toLowerCase())) return false;
    if (keyword && !s.includes(keyword.toLowerCase())) return false;
    return true;
  });
}

// ---- intent: query jadwal ----
async function handleQuery(sock, jid, msg, question, route) {
  const from = route.dateFrom || ymd();
  const to = route.dateTo || addDays(ymd(), 60);
  let events = await listEvents(dayStartISO(from), dayEndISO(to));
  events = matchEvents(events, route);
  const answer = await answerQuery({
    question,
    eventsText: eventsToText(events),
  });
  await reply(sock, jid, msg, answer || 'Hmm, aku kurang paham. Coba tanya lagi ya.');
}

// ---- intent: hapus acara ----
async function handleDelete(sock, jid, msg, route) {
  if (!route.person && !route.keyword) {
    await reply(
      sock,
      jid,
      msg,
      '🗑️ Mau hapus acara yang mana? Sebutin nama acaranya / orangnya ya.'
    );
    return;
  }
  const from = route.dateFrom || ymd();
  const to = route.dateTo || addDays(ymd(), 90);
  const events = await listEvents(dayStartISO(from), dayEndISO(to));
  const matches = matchEvents(events, route);

  if (!matches.length) {
    await reply(sock, jid, msg, '🤔 Gak nemu acara yang cocok buat dihapus.');
    return;
  }
  if (matches.length > 1) {
    const list = matches
      .map((e, i) => `${i + 1}. *${e.summary}* — ${whenText(e)}`)
      .join('\n');
    await reply(
      sock,
      jid,
      msg,
      `Ada ${matches.length} acara yang cocok:\n\n${list}\n\nSebutin lebih spesifik ya (tanggal/jam) biar gak salah hapus.`
    );
    return;
  }
  const target = matches[0];
  await deleteEvent(target.id);
  await reply(
    sock,
    jid,
    msg,
    `🗑️ Udah dibatalin: *${target.summary}* — ${whenText(target)}`
  );
}

// ---- intent: chit-chat / berita ----
async function handleChat(sock, jid, msg, text) {
  const answer = await chat({ text });
  await reply(sock, jid, msg, answer || 'Hehe, aku bingung mau jawab apa 😅');
}

/**
 * Handler utama.
 * - command uji: ping / !jid
 * - kalau bot DI-TAG:
 *     lampiran gambar/PDF -> ekstrak & simpan acara
 *     teks -> router intent (add / query / delete / chat)
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

  // --- bot hanya bereaksi kalau DI-TAG (atau di-reply) ---
  const tagged = isBotMentioned(sock, msg) || isReplyToBot(sock, msg);
  if (!tagged) return;

  logger.info(`[tagged] dari="${sender}" teks="${text}"`);

  const det = detectMedia(msg);
  if (det?.unsupported) {
    await reply(
      sock,
      jid,
      msg,
      '📎 File itu belum bisa kubaca. Kirim foto/gambar jadwal atau PDF ya.'
    );
    return;
  }

  if (!text && !det) {
    await reply(
      sock,
      jid,
      msg,
      'Iya? Tag aku sambil kasih info acaranya (teks / foto jadwal / PDF) ya 🙂'
    );
    return;
  }

  try {
    // Lampiran (gambar/PDF) -> selalu dianggap "tambah acara"
    if (det) {
      await reply(sock, jid, msg, '⏳ Lagi baca jadwalnya, bentar ya...');
      const media = [];
      const dl = await downloadAsBase64(sock, msg);
      if (dl) media.push(dl);
      const events = await extractEvents({ text, media });
      logger.info({ count: events.length }, '[ekstrak media]');
      await saveAndConfirm(sock, jid, msg, events);
      return;
    }

    // Teks -> router intent
    const route = await understand({ text });
    logger.info({ intent: route.intent }, '[router]');

    switch (route.intent) {
      case 'add':
        await saveAndConfirm(sock, jid, msg, route.events || []);
        break;
      case 'query':
        await handleQuery(sock, jid, msg, text, route);
        break;
      case 'delete':
        await handleDelete(sock, jid, msg, route);
        break;
      case 'chat':
      default:
        await handleChat(sock, jid, msg, text);
        break;
    }
  } catch (e) {
    logger.error(e, 'Gagal proses pesan');
    const text = isQuotaError(e)
      ? '😴 Lagi kena batas kuota Gemini (limit harian). Coba lagi nanti ya 🙏'
      : '⚠️ Waduh gagal proses. Cek koneksi/API ya.';
    await reply(sock, jid, msg, text);
  }
}
