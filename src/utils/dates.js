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
