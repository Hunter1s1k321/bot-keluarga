import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSock } from '../whatsapp/client.js';
import { listEvents } from '../calendar/calendar.js';
import {
  ymd,
  addDays,
  dayStartISO,
  dayEndISO,
  formatTime,
  formatDayLabel,
} from '../utils/dates.js';

const GROUP = config.whatsapp.familyGroupJid;

/** Satu baris acara buat pesan reminder. */
function line(e) {
  const loc = e.location ? ` di ${e.location}` : '';
  if (e.start?.dateTime) return `• ${e.summary} — ${formatTime(e.start.dateTime)}${loc}`;
  return `• ${e.summary} — seharian${loc}`;
}

/** Susun teks rekap pagi: acara hari ini + besok. (Read-only, bisa dites.) */
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

async function sendMorningDigest(sock) {
  const text = await buildMorningDigest();
  await sock.sendMessage(GROUP, { text });
  logger.info('[cron] rekap pagi terkirim');
}

// Acara yang udah dikasih reminder "1 jam lagi" (biar gak dobel). eventId -> startMs
const reminded = new Map();

/** Cek acara yang mulai dalam 60 menit ke depan, kirim reminder sekali. */
async function checkUpcoming(sock) {
  const nowMs = Date.now();
  const timeMin = new Date(nowMs).toISOString();
  const timeMax = new Date(nowMs + 60 * 60 * 1000).toISOString();

  // buang catatan lama (acara udah lewat)
  for (const [id, ms] of reminded) {
    if (ms < nowMs - 5 * 60 * 1000) reminded.delete(id);
  }

  const events = await listEvents(timeMin, timeMax);
  const due = events.filter((e) => e.start?.dateTime && !reminded.has(e.id));
  if (!due.length) return;

  for (const e of due) reminded.set(e.id, new Date(e.start.dateTime).getTime());
  const text = `⏰ *1 jam lagi:*\n${due.map(line).join('\n')}`;
  await sock.sendMessage(GROUP, { text });
  logger.info(`[cron] reminder H-1jam terkirim (${due.length} acara)`);
}

/** Nyalain semua jadwal cron. */
export function startScheduler() {
  const { hour, minute, timezone } = config.scheduler;

  // Rekap pagi: sekali sehari jam HH:MM WIB
  cron.schedule(
    `${minute} ${hour} * * *`,
    async () => {
      const sock = getSock();
      if (!sock) return logger.warn('[cron] rekap pagi dilewati: WA belum konek');
      try {
        await sendMorningDigest(sock);
      } catch (e) {
        logger.error(e, '[cron] gagal rekap pagi');
      }
    },
    { timezone }
  );

  // Reminder 1 jam sebelum acara: cek tiap 5 menit
  cron.schedule(
    '*/5 * * * *',
    async () => {
      const sock = getSock();
      if (!sock) return;
      try {
        await checkUpcoming(sock);
      } catch (e) {
        logger.error(e, '[cron] gagal cek reminder');
      }
    },
    { timezone }
  );

  logger.info(
    `⏰ Scheduler aktif: rekap pagi ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WIB, cek reminder tiap 5 menit`
  );
}

// Buat command test manual di WA (!pagi)
export { sendMorningDigest, checkUpcoming };
