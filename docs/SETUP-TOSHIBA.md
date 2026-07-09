# Brief buat Claude Code yang jalan DI laptop Toshiba

Kamu (Claude Code) jalan DI laptop Toshiba — server 24/7 yang jalanin "bot keluarga"
(WhatsApp). Sesi ini fresh; SEMUA konteks yang kamu butuh ada di file ini + repo.
Tugasmu: **selesaikan setup Tailscale Funnel** yang user-nya gagal jalanin manual,
lalu kasih user URL publiknya. Kerjain sendiri, jangan banyak nanya — user udah capek.

## Konteks singkat
- Fitur baru: webhook lokal nerima notif dari bot trading kripto (jalan di CLOUD claude.ai
  sebagai scheduled routine) → diteruskan jadi pesan ke grup WA keluarga.
- Kontrak payload & arsitektur lengkap ada di `docs/trading-webhook.md`. BACA itu juga.

## STATUS SAAT INI (yang udah beres)
- ✅ Token udah diisi user di `.env` (`TRADING_WEBHOOK_TOKEN=...`). JANGAN diubah.
- ✅ Bot jalan sebagai Windows service `BotKeluarga`.
- ✅ Webhook lokal NYALA & sehat: `Invoke-RestMethod http://127.0.0.1:8787/health` → `ok True`.
- ❌ BELUM SELESAI: expose webhook (127.0.0.1:8787) ke internet via Tailscale Funnel.
  User coba jalanin `scripts/setup-tailscale-funnel.ps1` tapi Tailscale "gak bisa dibuka".

## Tugasmu (bikin webhook bisa dijangkau dari internet)
Target: hasilkan URL publik stabil bentuk `https://<mesin>.<tailnet>.ts.net/trade` yang
nge-proxy ke `http://127.0.0.1:8787`. Webhook TETAP bind 127.0.0.1 (Funnel proxy lokal).

Langkah:
1. Pastikan Tailscale kepasang. Coba `winget install --id tailscale.tailscale -e`.
   - KALAU winget gak ada (Windows Toshiba mungkin lama): download MSI dari
     https://tailscale.com/download/windows lewat `Invoke-WebRequest` lalu install
     (`msiexec /i <file> /quiet`), atau arahkan user download manual. Ini kemungkinan
     besar penyebab "gak bisa dibuka" tadi — diagnosa dulu.
2. `tailscale up` → user login browser (Sign in with Google). Kalau headless/gagal buka
   browser, pakai `tailscale up` yang nyetak URL login buat user klik manual.
3. Enable Funnel: di admin console https://login.tailscale.com/admin aktifin
   **HTTPS Certificates** + **Funnel**. Kalau langkah 4 error "Funnel not available",
   INI penyebabnya — kasih user link persisnya buat di-enable.
4. `tailscale funnel --bg 8787` (background, persist antar-reboot).
5. Ambil hostname: `tailscale funnel status` atau `(tailscale status --json | ConvertFrom-Json).Self.DNSName`.
6. VERIFIKASI dari mesin ini: `Invoke-RestMethod https://<dns>/health` → harus `ok True`.

## Hasil akhir yang harus kamu kasih ke user (tulis JELAS)
```
WEBHOOK_URL   = https://<dns>/trade
WEBHOOK_TOKEN = (isi dari TRADING_WEBHOOK_TOKEN di .env — tampilkan biar user gampang copy)
```
Lalu bilang ke user: tempel 2 nilai itu ke **env/pengaturan routine `TR-GC-Crypto-LS-9`
di website claude.ai** (bukan di mesin ini). Itu langkah terakhir.

## Catatan
- Jangan restart service atau ngutak-ngatik fitur lain kecuali perlu.
- `scripts/setup-tailscale-funnel.ps1` bisa kamu jalanin ATAU jadiin acuan.
- Funnel = publik ke internet tanpa auth di lapis Tailscale; token webhook (constant-time)
  yang jadi benteng. Itu udah bener, gak usah diubah.
