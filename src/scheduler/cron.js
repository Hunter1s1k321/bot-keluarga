import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config, ROOT } from '../config.js';
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

// --- timing rekap pagi: 2 jam sebelum acara pertama, default 05:00 ---
const MORNING_DEFAULT_MIN = 5 * 60; // 05:00
const MORNING_LEAD_MIN = 120; // 2 jam
const LAST_MORNING_FILE = path.join(ROOT, '.last-morning');

function getLastMorning() {
  try {
    return fs.readFileSync(LAST_MORNING_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}
function setLastMorning(d) {
  try {
    fs.writeFileSync(LAST_MORNING_FILE, d);
  } catch {
    /* abaikan */
  }
}

/** Menit-dalam-hari WIB (0..1439) dari Date/ISO. formatTime pakai titik ("05.30"). */
function minutesWIB(dateInput) {
  const [h, m] = formatTime(dateInput).split(/[.:]/).map(Number);
  return h * 60 + m;
}

/**
 * Menit target kirim rekap pagi HARI INI: 2 jam sebelum acara pertama,
 * tapi gak lebih siang dari 05:00. Kalau gak ada acara -> 05:00.
 */
async function morningTargetMinutes() {
  const today = ymd();
  const evs = await listEvents(dayStartISO(today), dayEndISO(today));
  const mins = evs
    .filter((e) => e.start?.dateTime)
    .map((e) => minutesWIB(e.start.dateTime));
  if (!mins.length) return MORNING_DEFAULT_MIN;
  const candidate = Math.min(...mins) - MORNING_LEAD_MIN;
  return Math.max(0, Math.min(MORNING_DEFAULT_MIN, candidate));
}

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
    info = await withTimeout(morningInfo(), 45000, null);
    if (!info) logger.warn('[cron] info pagi timeout/kosong -> cuma kirim jadwal');
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
      await sendTo(sock, GROUP, `⏰ *1 jam lagi:*\n${line(e)}`);
      logger.info(`[cron] reminder 1 jam: ${e.summary}`);
    }
    if (mins > 3 && mins <= 7 && !sent.has(`${e.id}:5`)) {
      sent.add(`${e.id}:5`);
      await sendTo(sock, GROUP, `⏰ *5 menit lagi:*\n${line(e)}`);
      logger.info(`[cron] reminder 5 menit: ${e.summary}`);
    }
  }
}

/** Nyalain semua jadwal cron. */
export function startScheduler() {
  const { timezone } = config.scheduler;

  // Rekap pagi: cek tiap 10 menit; kirim 2 JAM sebelum acara pertama hari ini
  // (default 05:00 kalau gak ada acara pagi). Sekali per hari.
  cron.schedule(
    '*/10 * * * *',
    async () => {
      const sock = getSock();
      if (!sock) return;
      try {
        const today = ymd();
        if (getLastMorning() === today) return; // udah kirim hari ini
        const target = await morningTargetMinutes();
        const now = minutesWIB(new Date());
        // kirim cuma dalam window [target, target+3jam] biar gak nyepam kalau
        // bot baru nyala/update jauh setelah target (mis. siang hari)
        if (now >= target && now <= target + 180) {
          setLastMorning(today);
          await sendMorning(sock);
        } else if (now > target + 180) {
          // udah kelewat jauh -> anggap "udah lewat" hari ini, jgn kirim telat
          setLastMorning(today);
        }
      } catch (e) {
        logger.error(e, '[cron] gagal cek/kirim pagi');
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
    '⏰ Scheduler aktif: rekap pagi 2 jam sebelum acara pertama (default 05:00) | reminder 1 jam & 5 menit sebelum acara'
  );
}
