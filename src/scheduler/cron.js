import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSock } from '../whatsapp/client.js';
import { listEvents } from '../calendar/calendar.js';
import { morningInfo } from '../ai/gemini.js';
import {
  ymd,
  addDays,
  dayStartISO,
  dayEndISO,
  formatTime,
  formatDayLabel,
} from '../utils/dates.js';
import { applyMentions } from '../whatsapp/tagging.js';

const GROUP = config.whatsapp.familyGroupJid;

/** Satu baris acara buat pesan reminder. */
function line(e) {
  const loc = e.location ? ` di ${e.location}` : '';
  if (e.start?.dateTime) return `• ${e.summary} — ${formatTime(e.start.dateTime)}${loc}`;
  return `• ${e.summary} — seharian${loc}`;
}

/** Kirim teks ke suatu chat, otomatis nge-tag anggota yang namanya kesebut. */
async function sendTo(sock, jid, rawText) {
  const { text, mentions } = applyMentions(rawText);
  await sock.sendMessage(jid, { text, mentions });
}

/** Susun teks rekap pagi: acara hari ini + besok (H-1). (Read-only, bisa dites.) */
export async function buildMorningDigest() {
  const today = ymd();
  const tom = addDays(today, 1);
  const [todayEv, tomEv] = await Promise.all([
    listEvents(dayStartISO(today), dayEndISO(today)),
    listEvents(dayStartISO(tom), dayEndISO(tom)),
  ]);

  const secToday = todayEv.length
    ? todayEv.map(line).join('\n')
    : '• gak ada acara, santai 😎';
  const secTom = tomEv.length
    ? tomEv.map(line).join('\n')
    : '• belum ada acara';

  return (
    `🌅 pagi semua!\n\n` +
    `📅 *hari ini* (${formatDayLabel(today)}):\n${secToday}\n\n` +
    `🔜 *besok* (${formatDayLabel(tom)}):\n${secTom}\n\n` +
    `have a nice day ☀️`
  );
}

/** Race sebuah promise dgn timeout, fallback kalau kelamaan. */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((res) => setTimeout(() => res(fallback), ms)),
  ]);
}

/**
 * Kirim rangkaian pesan pagi ke suatu chat: (1) rekap jadwal, (2) berita,
 * (3) kuliner — DIPISAH biar tiap link dapet preview/thumbnail sendiri.
 * Dipakai cron (ke grup) & command !pagi (ke chat pemanggil).
 */
export async function sendMorning(sock, jid = GROUP) {
  // 1) rekap jadwal
  await sendTo(sock, jid, await buildMorningDigest());

  // 2 & 3) berita + kuliner (best-effort + timeout biar gak nge-hang)
  let info = null;
  try {
    info = await withTimeout(morningInfo(), 25000, null);
  } catch (e) {
    logger.warn(e, '[cron] info pagi gagal (skip)');
  }
  if (info?.news) await sendTo(sock, jid, info.news);
  if (info?.kuliner) {
    const { text, mentions } = applyMentions(info.kuliner.text);
    if (info.kuliner.photo) {
      // kirim FOTO tempatnya + caption (dijamin ada gambar, bukan preview link)
      await sock.sendMessage(jid, { image: info.kuliner.photo, caption: text, mentions });
    } else {
      await sock.sendMessage(jid, { text, mentions });
    }
  }

  logger.info('[cron] pesan pagi terkirim');
}

// Milestone reminder yang udah dikirim: key `${eventId}:${menit}` (60 / 5)
const sent = new Set();

/**
 * Cek acara yang bakal MULAI sebentar lagi, kirim reminder SEKALI per milestone:
 *   - 1 jam sebelum
 *   - 5 menit sebelum
 * (H-1 dihandle rekap pagi.)
 */
export async function checkReminders(sock) {
  const now = Date.now();
  // ambil acara yg mulai dari sekarang s/d 66 menit ke depan
  const events = await listEvents(
    new Date(now).toISOString(),
    new Date(now + 66 * 60 * 1000).toISOString()
  );

  for (const e of events) {
    if (!e.start?.dateTime) continue; // acara seharian gak dapet reminder jam
    const startMs = new Date(e.start.dateTime).getTime();
    const mins = (startMs - now) / 60000;
    if (mins <= 0) continue; // udah lewat / lagi berlangsung -> skip (fix bug spam)

    if (mins > 55 && mins <= 65 && !sent.has(`${e.id}:60`)) {
      sent.add(`${e.id}:60`);
      await sendTagged(sock, `⏰ *1 jam lagi:*\n${line(e)}`);
      logger.info(`[cron] reminder 1 jam: ${e.summary}`);
    }
    if (mins > 3 && mins <= 7 && !sent.has(`${e.id}:5`)) {
      sent.add(`${e.id}:5`);
      await sendTagged(sock, `⏰ *5 menit lagi:*\n${line(e)}`);
      logger.info(`[cron] reminder 5 menit: ${e.summary}`);
    }
  }
}

/** Nyalain semua jadwal cron. */
export function startScheduler() {
  const { hour, minute, timezone } = config.scheduler;

  // Rekap pagi (H-1): sekali sehari jam HH:MM WIB
  cron.schedule(
    `${minute} ${hour} * * *`,
    async () => {
      const sock = getSock();
      if (!sock) return logger.warn('[cron] rekap pagi dilewati: WA belum konek');
      try {
        await sendMorning(sock);
      } catch (e) {
        logger.error(e, '[cron] gagal rekap pagi');
      }
    },
    { timezone }
  );

  // Reminder 1 jam & 5 menit sebelum acara: cek tiap 2 menit
  cron.schedule(
    '*/2 * * * *',
    async () => {
      const sock = getSock();
      if (!sock) return;
      try {
        await checkReminders(sock);
      } catch (e) {
        logger.error(e, '[cron] gagal cek reminder');
      }
    },
    { timezone }
  );

  // Bersihin catatan reminder tiap tengah malam (biar Set gak numpuk)
  cron.schedule('5 0 * * *', () => sent.clear(), { timezone });

  logger.info(
    `⏰ Scheduler aktif: rekap pagi ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WIB | reminder 1 jam & 5 menit sebelum acara`
  );
}
