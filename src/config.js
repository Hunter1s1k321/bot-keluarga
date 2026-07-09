import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root project (satu level di atas /src)
export const ROOT = path.resolve(__dirname, '..');

// Load .env dari path ABSOLUT (biar tetap kebaca walau jalan sbg service /
// cwd beda). Kalau pakai 'dotenv/config' dia baca dari cwd -> bisa gagal.
dotenv.config({ path: path.join(ROOT, '.env') });

export const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  calendar: {
    id: process.env.CALENDAR_ID || '',
    credentialsPath: path.join(ROOT, 'credentials.json'),
    tokenPath: path.join(ROOT, 'token.json'),
  },
  whatsapp: {
    familyGroupJid: process.env.FAMILY_GROUP_JID || '',
    authDir: path.join(ROOT, 'auth'),
  },
  scheduler: {
    hour: parseInt(process.env.DAILY_JOB_HOUR ?? '7', 10),
    minute: parseInt(process.env.DAILY_JOB_MINUTE ?? '0', 10),
    timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  },
  maps: {
    // Key Cloud biasa (AIzaSy...) buat Places API. Opsional: kalau kosong,
    // link kuliner pakai search biasa (preview generik).
    apiKey: process.env.MAPS_API_KEY || '',
  },
  trading: {
    // Webhook lokal buat nerima notif dari bot trading kripto (TR-GC-Crypto-LS-9).
    // Kalau token KOSONG -> webhook OFF total (fitur trading nonaktif, aman).
    webhookPort: parseInt(process.env.TRADING_WEBHOOK_PORT ?? '8787', 10),
    // Bind address. DEFAULT 127.0.0.1 (aman) — akses dari cloud lewat Cloudflare
    // Tunnel yang nyambung lokal. Ubah cuma kalau paham risikonya.
    webhookBind: process.env.TRADING_WEBHOOK_BIND || '127.0.0.1',
    webhookToken: process.env.TRADING_WEBHOOK_TOKEN || '',
    // Nama pemilik bot trading (buat di-tag di pesan perkenalan).
    owner: process.env.TRADING_OWNER || 'Marvel',
    // Kurs cadangan USD->IDR kalau API kurs lagi down.
    fxFallback: parseInt(process.env.USD_IDR_FALLBACK ?? '16500', 10),
  },
  locationName: process.env.LOCATION_NAME || 'Harapan Indah, Bekasi',
  envPath: path.join(ROOT, '.env'),
  examplePath: path.join(ROOT, '.env.example'),
};

/**
 * Validasi config yang WAJIB ada sebelum bot utama jalan.
 * Dipanggil di src/index.js — bukan saat import, biar script auth Google
 * (yang belum butuh GEMINI_API_KEY / CALENDAR_ID) tetap bisa jalan.
 */
export function validateForBot() {
  const missing = [];
  if (!config.gemini.apiKey) missing.push('GEMINI_API_KEY');
  if (!config.calendar.id) missing.push('CALENDAR_ID');
  if (!config.whatsapp.familyGroupJid) missing.push('FAMILY_GROUP_JID');
  if (missing.length) {
    throw new Error(
      `Config belum lengkap di .env: ${missing.join(', ')}. ` +
        `Cek README / .env.example.`
    );
  }
}
