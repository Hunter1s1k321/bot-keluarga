/**
 * Script SEKALI-JALAN untuk autentikasi Google Calendar.
 *
 * Jalankan: npm run auth:google
 *
 * Yang dilakukan:
 *  1. Buka browser -> kamu login Google & kasih izin (OAuth consent).
 *  2. Simpan refresh token ke token.json.
 *  3. Cari kalender bernama "Keluarga", kalau belum ada -> dibuat.
 *  4. Tulis CALENDAR_ID ke .env otomatis.
 *
 * Aman diulang: kalau token.json sudah ada, langsung lanjut cari/bikin kalender.
 */
import fs from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';
import open from 'open';
import { google } from 'googleapis';
import { config, ROOT } from '../src/config.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_NAME = 'Keluarga';
// Port lokal buat nangkep redirect OAuth. Desktop app -> loopback boleh port apa saja.
const PORT = 5858;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function loadOAuthClient() {
  if (!fs.existsSync(config.calendar.credentialsPath)) {
    throw new Error('credentials.json tidak ditemukan di root project.');
  }
  const creds = JSON.parse(
    fs.readFileSync(config.calendar.credentialsPath, 'utf8')
  );
  const block = creds.installed || creds.web;
  if (!block) {
    throw new Error(
      'Format credentials.json tidak dikenali (butuh key "installed").'
    );
  }
  return new google.auth.OAuth2(
    block.client_id,
    block.client_secret,
    REDIRECT_URI
  );
}

function getTokenInteractive(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline', // biar dapat refresh_token
      prompt: 'consent', // paksa consent supaya refresh_token pasti keluar
      scope: SCOPES,
    });

    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url.startsWith('/oauth2callback')) {
          res.writeHead(404);
          res.end();
          return;
        }
        const url = new URL(req.url, REDIRECT_URI);
        const err = url.searchParams.get('error');
        const code = url.searchParams.get('code');

        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>Gagal: ${err}</h2>`);
          server.close();
          reject(new Error(err));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<h2>Berhasil login. Kamu boleh tutup tab ini dan balik ke terminal.</h2>'
        );
        server.close();

        const { tokens } = await oAuth2Client.getToken(code);
        resolve(tokens);
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.listen(PORT, async () => {
      console.log('\nMembuka browser untuk login Google...');
      console.log(
        'Kalau browser tidak terbuka otomatis, buka URL ini manual:\n' +
          authUrl +
          '\n'
      );
      try {
        await open(authUrl);
      } catch {
        /* biarkan user buka manual */
      }
    });

    server.on('error', reject);
  });
}

async function findOrCreateCalendar(auth) {
  const cal = google.calendar({ version: 'v3', auth });
  const list = await cal.calendarList.list();
  const existing = (list.data.items || []).find(
    (c) => c.summary === CALENDAR_NAME
  );
  if (existing) {
    console.log(`Kalender "${CALENDAR_NAME}" sudah ada.`);
    return existing.id;
  }
  console.log(`Kalender "${CALENDAR_NAME}" belum ada, membuat baru...`);
  const created = await cal.calendars.insert({
    requestBody: {
      summary: CALENDAR_NAME,
      timeZone: config.scheduler.timezone,
      description: 'Kalender bersama bot keluarga.',
    },
  });
  return created.data.id;
}

/** Update / tambah satu key di .env tanpa menghapus yang lain. */
function upsertEnv(key, value) {
  let content = '';
  if (fs.existsSync(config.envPath)) {
    content = fs.readFileSync(config.envPath, 'utf8');
  } else if (fs.existsSync(config.examplePath)) {
    content = fs.readFileSync(config.examplePath, 'utf8');
    console.log('.env belum ada -> dibuat dari .env.example');
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    if (content && !content.endsWith('\n')) content += '\n';
    content += line + '\n';
  }
  fs.writeFileSync(config.envPath, content);
}

async function main() {
  const oAuth2Client = loadOAuthClient();

  let tokens;
  if (fs.existsSync(config.calendar.tokenPath)) {
    console.log('token.json sudah ada, pakai yang lama.');
    tokens = JSON.parse(fs.readFileSync(config.calendar.tokenPath, 'utf8'));
    oAuth2Client.setCredentials(tokens);
  } else {
    tokens = await getTokenInteractive(oAuth2Client);
    fs.writeFileSync(
      config.calendar.tokenPath,
      JSON.stringify(tokens, null, 2)
    );
    oAuth2Client.setCredentials(tokens);
    console.log('token.json disimpan.');
  }

  const calId = await findOrCreateCalendar(oAuth2Client);
  upsertEnv('CALENDAR_ID', calId);

  console.log('\n==============================================');
  console.log('  SELESAI. Google Calendar siap dipakai.');
  console.log('  CALENDAR_ID :', calId);
  console.log('  (sudah otomatis ditulis ke .env)');
  console.log('==============================================\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nGAGAL:', e.message);
  console.error(
    'Kalau errornya "access_denied" / consent screen, cek langkah OAuth di README.'
  );
  process.exit(1);
});
