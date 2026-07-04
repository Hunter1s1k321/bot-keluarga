import { config } from '../config.js';

const TZ = config.scheduler.timezone;

/** Tanggal "YYYY-MM-DD" untuk suatu Date, dihitung di timezone WIB. */
export function ymd(date = new Date()) {
  // en-CA -> format 2026-07-04
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** String tanggal+jam yang enak dibaca manusia (buat konteks prompt Gemini). */
export function humanNow(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Info "sekarang" buat dikasih ke prompt (biar 'besok', 'Sabtu depan' bener). */
export function nowContext() {
  const now = new Date();
  return {
    human: humanNow(now), // "Sabtu, 4 Juli 2026 pukul 20.15"
    today: ymd(now), // "2026-07-04"
    timezone: TZ,
  };
}

/** Tambah n hari ke string "YYYY-MM-DD" (buat end all-day yang eksklusif). */
export function addDays(ymdStr, n) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Tambah 1 jam ke jam dinding WIB (default durasi event kalau end tak diisi).
 * Pakai UTC math biar aman rollover tengah malam; WIB tanpa DST jadi valid.
 * @returns {{date:string, time:string}}
 */
export function plusOneHour(ymdStr, hhmm) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
  dt.setUTCHours(dt.getUTCHours() + 1);
  return { date: dt.toISOString().slice(0, 10), time: dt.toISOString().slice(11, 16) };
}

/** Awal hari WIB dalam ISO, mis. "2026-07-05T00:00:00+07:00". */
export function dayStartISO(ymdStr) {
  return `${ymdStr}T00:00:00+07:00`;
}

/** Akhir hari WIB dalam ISO, mis. "2026-07-05T23:59:59+07:00". */
export function dayEndISO(ymdStr) {
  return `${ymdStr}T23:59:59+07:00`;
}

/** Format tanggal event calendar (untuk balasan ke user), dari Date/ISO. */
export function formatEventDate(dateInput) {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
