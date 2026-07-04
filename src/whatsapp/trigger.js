import { isBotMentioned, isReplyToBot } from './mentions.js';

// Bisa dimatiin lewat .env: AUTO_SCHEDULE_DETECT=0
const AUTO_DETECT = process.env.AUTO_SCHEDULE_DETECT !== '0';

// Kata kerja perintah menjadwalkan (imperatif) — sengaja spesifik biar gak asal nyerobot.
const ACTION_RE =
  /\b(catat|catet|atur jadwal|jadwalin|jadwalkan|jadwalpin|ingetin|ingatin|ingatkan|reminder|remind|jangan lupa|tambah acara|tambahin acara|masukin jadwal|masukin acara|set jadwal|bikin acara|buatin acara|tolong ingat)\b/i;

// Indikator waktu/tanggal.
const TIME_RE =
  /\b(besok|lusa|nanti|tanggal|jam\s*\d|pukul|senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|pagi|siang|sore|malam|\d{1,2}[:.]\d{2}|\d{1,2}\/\d{1,2})\b/i;

/** Pesan yang jelas MINTA atur jadwal (walau gak manggil bot). */
export function looksLikeScheduleRequest(text) {
  return ACTION_RE.test(text) && TIME_RE.test(text);
}

/**
 * Tentukan apakah bot harus merespons, dan apakah respons cuma boleh keluar
 * kalau bot benar-benar melakukan aksi (biar gak nyerobot obrolan biasa).
 *
 * @returns {{respond:boolean, requireAction:boolean}}
 *   requireAction=true -> hanya balas kalau agent beneran nambah/hapus acara.
 */
export function detectTrigger(sock, msg, text) {
  // Dipanggil langsung: tag / reply / sebut nama "claude"
  if (isBotMentioned(sock, msg) || isReplyToBot(sock, msg)) {
    return { respond: true, requireAction: false };
  }
  if (/\bclaude\b/i.test(text)) {
    return { respond: true, requireAction: false };
  }
  // Tidak dipanggil, tapi jelas minta atur jadwal
  if (AUTO_DETECT && looksLikeScheduleRequest(text)) {
    return { respond: true, requireAction: true };
  }
  return { respond: false, requireAction: false };
}
