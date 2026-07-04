import { isBotMentioned, isReplyToBot } from './mentions.js';

// Mode proaktif bisa dimatiin lewat .env: AUTO_SCHEDULE_DETECT=0
const AUTO_DETECT = process.env.AUTO_SCHEDULE_DETECT !== '0';

// Perintah TEGAS soal jadwal (imperatif) -> diperlakukan seperti dipanggil langsung.
const ACTION_RE =
  /\b(catat|catet|atur jadwal|jadwalin|jadwalkan|set jadwal|bikin acara|buatin acara|ingetin|ingatin|ingatkan|reminder|jangan lupa|tolong ingat|(tambah(in|kan)?|masuk(in|kan)?)\s*(ke\s*)?(jadwal|kalender|acara)|hapus|batalin|batalkan)\b/i;

// Indikator waktu/tanggal.
const TIME_RE =
  /\b(besok|lusa|nanti|hari ini|tanggal|jam\s*\d|pukul\s*\d|senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|pagi|siang|sore|malam|\d{1,2}[:.]\d{2}|\d{1,2}\/\d{1,2})\b/i;

// Obrolan yang cuma NYEREMPET jadwal (buat mode proaktif "nyimak").
const HINT_RE =
  /\b(jadwal|kalender|catat|catet|dicatat|tambah(in|kan)?|masuk(in|kan)?|ingetin|ingatin|ingatkan|jangan lupa|reminder|misdinar|acara|agenda|arisan|rapat|meeting|latihan|ulang tahun|ultah|jam\s*\d|pukul\s*\d)\b/i;

/** Perintah tegas menjadwalkan (imperatif + ada waktu). */
export function isScheduleCommand(text) {
  return ACTION_RE.test(text) && TIME_RE.test(text);
}

/** Obrolan nyerempet jadwal? (buat mode proaktif) */
export function schedulingHint(text) {
  return HINT_RE.test(text);
}

/**
 * Tentukan mode respons bot.
 * @returns {{mode:'direct'|'proactive'|'none'}}
 *   - direct   : dipanggil langsung (tag/reply/sebut "claude") ATAU perintah
 *                jadwal tegas -> selalu jawab, tool-calling reliable.
 *   - proactive: gak dipanggil, cuma obrolan nyerempet jadwal -> agent nyimak,
 *                nimbrung kalau perlu, kalau nggak jawab "SKIP" (diam).
 *   - none     : abaikan (cuma disimpan ke konteks).
 */
export function detectTrigger(sock, msg, text) {
  if (isBotMentioned(sock, msg) || isReplyToBot(sock, msg)) return { mode: 'direct' };
  if (/\bclaude\b/i.test(text)) return { mode: 'direct' };
  if (text && isScheduleCommand(text)) return { mode: 'direct' };
  if (AUTO_DETECT && text && schedulingHint(text)) return { mode: 'proactive' };
  return { mode: 'none' };
}
