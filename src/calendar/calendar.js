import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';

/**
 * Bangun OAuth2 client dari credentials.json + token.json.
 * token.json dibuat lewat: npm run auth:google
 */
function getAuthClient() {
  if (!fs.existsSync(config.calendar.credentialsPath)) {
    throw new Error('credentials.json tidak ditemukan di root project.');
  }
  if (!fs.existsSync(config.calendar.tokenPath)) {
    throw new Error(
      'token.json belum ada. Jalankan dulu: npm run auth:google'
    );
  }
  const creds = JSON.parse(
    fs.readFileSync(config.calendar.credentialsPath, 'utf8')
  );
  const { client_id, client_secret, redirect_uris } = creds.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  oAuth2Client.setCredentials(
    JSON.parse(fs.readFileSync(config.calendar.tokenPath, 'utf8'))
  );
  return oAuth2Client;
}

let _calendar = null;
function calendarClient() {
  if (!_calendar) {
    _calendar = google.calendar({ version: 'v3', auth: getAuthClient() });
  }
  return _calendar;
}

/** List semua kalender yang bisa diakses akun (buat verifikasi/debug). */
export async function listCalendars() {
  const cal = calendarClient();
  const res = await cal.calendarList.list();
  return (res.data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
  }));
}

/**
 * Buat event di kalender Keluarga.
 * @param {object} p
 * @param {string} p.summary  judul, mis. "Marvel - Misdinar"
 * @param {string} [p.description]
 * @param {string} [p.location]
 * @param {string} p.startDateTime ISO, mis. "2026-07-05T06:00:00"
 * @param {string} p.endDateTime   ISO
 * @param {boolean} [p.allDay] kalau true, pakai date (bukan dateTime)
 * @param {string} [p.startDate] "YYYY-MM-DD" (dipakai kalau allDay)
 * @param {string} [p.endDate]   "YYYY-MM-DD" (eksklusif; dipakai kalau allDay)
 */
export async function createEvent(p) {
  const cal = calendarClient();
  const tz = config.scheduler.timezone;

  const event = {
    summary: p.summary,
    description: p.description || undefined,
    location: p.location || undefined,
  };

  if (p.allDay) {
    event.start = { date: p.startDate };
    event.end = { date: p.endDate || p.startDate };
  } else {
    event.start = { dateTime: p.startDateTime, timeZone: tz };
    event.end = { dateTime: p.endDateTime, timeZone: tz };
  }

  const res = await cal.events.insert({
    calendarId: config.calendar.id,
    requestBody: event,
  });
  return res.data;
}

/**
 * Ambil event dalam rentang waktu (buat reminder & query).
 * @param {string} timeMin ISO
 * @param {string} timeMax ISO
 * @param {string} [q] filter teks opsional (mis. nama orang)
 */
export async function listEvents(timeMin, timeMax, q) {
  const cal = calendarClient();
  const res = await cal.events.list({
    calendarId: config.calendar.id,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    q: q || undefined,
    maxResults: 100,
  });
  return res.data.items || [];
}

/** Hapus event by id (dipakai saat verifikasi/test cleanup). */
export async function deleteEvent(eventId) {
  const cal = calendarClient();
  await cal.events.delete({
    calendarId: config.calendar.id,
    eventId,
  });
}
