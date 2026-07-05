# 🤖 Bot Keluarga

WhatsApp bot manajemen jadwal keluarga: ngobrol natural, catat acara ke Google Calendar (termasuk dari foto/PDF jadwal), reminder otomatis, info pagi (berita + kuliner). Jalan 24/7 di laptop sebagai Windows Service.

## ✨ Fitur

- **Ngobrol natural** — tag `@bot` atau sebut "claude", dijawab kayak AI asisten (bisa ngobrol, cari berita, kirim foto tempat).
- **Catat acara** — dari teks, foto, atau PDF jadwal → otomatis masuk Google Calendar (judul ber-prefix nama, mis. `Marvel - Misdinar`). Dukung acara **berulang** (recurring).
- **Peka konteks** — nimbrung sendiri kalau ada obrolan jadwal yang belum tercatat.
- **Reminder** — H-1 (rekap pagi), 1 jam & 5 menit sebelum acara, nge-**tag** orangnya.
- **Info pagi** (jam 7) — jadwal hari ini/besok + berita sekitar + rekomendasi kuliner (foto tempat).

## 🧱 Stack

Node.js (ESM) · [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp) · [@google/genai](https://ai.google.dev) (Gemini) · Google Calendar API · Google Places API · node-cron · node-windows.

## 📂 File rahasia (TIDAK ada di repo — di-`.gitignore`)

Harus disiapin manual di tiap mesin:

| File/folder | Isi | Cara dapat |
|---|---|---|
| `.env` | API key & config | copy dari `.env.example`, isi |
| `credentials.json` | OAuth Google Calendar | Google Cloud Console (Desktop app) |
| `token.json` | token OAuth | otomatis dibuat `npm run auth:google` |
| `auth/` | session WhatsApp | otomatis pas scan QR pertama |
| `people.json` | nomor → panggilan keluarga | copy dari `people.example.json` |

## 🚀 Setup dari nol (mesin baru)

```bash
git clone <repo-url> bot-keluarga
cd bot-keluarga
npm install
```

1. **Copy file rahasia** (`.env`, `credentials.json`, `people.json`) dari mesin lama via USB — ATAU siapin baru:
   - `.env`: copy `.env.example` → isi `GEMINI_API_KEY`, `MAPS_API_KEY` (opsional).
   - `people.json`: copy `people.example.json` → isi nomor keluarga.
2. **Auth Google Calendar:** `npm run auth:google` → login di browser → `token.json` & `CALENDAR_ID` terisi.
3. **Konek WhatsApp:** `npm start` → scan QR pakai HP nomor bot (Perangkat Tertaut) → dapet JID grup dengan ketik `!jid` di grup → isi `FAMILY_GROUP_JID` di `.env`.
4. **Jadiin service** (auto-start tanpa login): terminal **Administrator** →
   ```cmd
   npm run service:install
   ```

## 🔧 Operasional

**Restart bot** (setelah update kode) — terminal Administrator:
```cmd
net stop BotKeluarga && net start BotKeluarga
```

**Hapus service:**
```cmd
npm run service:uninstall
```

**Command uji di grup:** `ping` · `!jid` (JID grup) · `!whoami` (cek nomormu dikenal) · `!pagi` (tes pesan pagi) · `!ingat` (tes reminder) · `!reset` (lupakan konteks obrolan).

## 🔄 Ganti nomor WhatsApp / session logout

Kalau bot ke-logout (muncul `Session logged out` di log) atau mau ganti nomor:
1. Stop service: `net stop BotKeluarga`
2. Hapus folder `auth/`
3. `npm start` → scan QR baru pakai nomor yang diinginkan
4. Setelah konek, Ctrl+C → `net start BotKeluarga`

## 🩺 Troubleshooting

| Gejala | Solusi |
|---|---|
| `408 Timed Out (init queries)` di log | Normal, benign. Bot tetap jalan. Abaikan. |
| `code=515` pas pairing | Normal, auto-reconnect nanganin. |
| Bot gak bales | Pastikan di-tag / sebut "claude"; cek `!whoami` nomor dikenal; cek log `[upsert]` pesan masuk. |
| `RESOURCE_EXHAUSTED / 429` | Kuota Gemini habis — cek billing di Google Cloud. |
| Reminder/pesan gak keluar | Cek `FAMILY_GROUP_JID` bener di `.env`. |
| Foto kuliner gak muncul | Cek `MAPS_API_KEY` + Places API (New) enable + key gak ke-restrict salah. |

## 🔐 Keamanan

Jangan pernah commit `.env`, `credentials.json`, `token.json`, `auth/`, `people.json`. Semua udah di-`.gitignore`. Repo sebaiknya **private**.
