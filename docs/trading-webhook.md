# Webhook Notif Bot Trading → Grup WA

Family bot ("Keluarga binar") buka **webhook** buat nerima notif dari bot trading
kripto (TR-GC-Crypto-LS-9) dan meneruskannya sebagai pesan ke grup WA.

## Arsitektur (PENTING)

Bot trading jalan sebagai **scheduled routine di cloud Claude.ai**, family bot jalan
di **laptop rumah** (di balik NAT, gak punya IP publik). Jadi keduanya **beda mesin** —
`127.0.0.1` gak bisa dipakai.

Solusinya **Cloudflare Tunnel** (`cloudflared`) yang jalan di laptop:

```
[Cloud routine] --HTTPS--> [Cloudflare edge] --tunnel keluar--> [cloudflared di laptop] --> 127.0.0.1:8787 (family bot)
```

- Koneksi tunnel **keluar** dari laptop → gak perlu buka port router, gak ada lubang inbound.
- Webhook family bot **tetap bind 127.0.0.1** → cuma cloudflared (lokal) yang bisa nyentuh.
- Satu-satunya jalan dari internet = hostname tunnel + **token** (dicek constant-time).
- Coexist sama WARP yang udah kepasang.

## A. Setup family bot (laptop)

Isi `.env`:
```
TRADING_WEBHOOK_TOKEN=<token-acak-32-hex>   # WAJIB, kalau kosong webhook OFF
TRADING_WEBHOOK_PORT=8787                    # opsional
TRADING_OWNER=Marvel                         # opsional (di-tag di pesan intro)
USD_IDR_FALLBACK=16500                       # opsional (cadangan kalau API kurs down)
# TRADING_WEBHOOK_BIND=127.0.0.1             # JANGAN diubah kalau pakai tunnel
```
Restart bot → log: `💹 Webhook trading aktif di http://127.0.0.1:8787/trade (health: /health)`.

Bikin token acak yang kuat (PowerShell, 48 hex):
```powershell
$b = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
```

## B. Setup Cloudflare Tunnel (laptop, sekali doang)

> Butuh **domain di Cloudflare** (buat hostname stabil). Kalau belum punya, lihat "Alternatif" di bawah.

1. Install cloudflared:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. Login ke akun Cloudflare (buka browser, pilih domain):
   ```powershell
   cloudflared tunnel login
   ```
3. Bikin tunnel:
   ```powershell
   cloudflared tunnel create botkeluarga
   ```
4. Buat file config `C:\Users\<user>\.cloudflared\config.yml`:
   ```yaml
   tunnel: <TUNNEL_ID_dari_langkah_3>
   credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL_ID>.json
   ingress:
     - hostname: trade-bot.contohdomain.com
       service: http://127.0.0.1:8787
     - service: http_status:404
   ```
5. Arahin DNS ke tunnel:
   ```powershell
   cloudflared tunnel route dns botkeluarga trade-bot.contohdomain.com
   ```
6. Tes: `cloudflared tunnel run botkeluarga`, lalu dari mana aja:
   ```
   curl https://trade-bot.contohdomain.com/health   →   {"ok":true}
   ```
7. Pasang jadi service Windows (jalan otomatis pas boot, hands-off):
   ```powershell
   cloudflared service install
   ```

**Hardening opsional (disarankan):** aktifin **Cloudflare Access** di hostname itu +
bikin *service token*, jadi request tanpa header `CF-Access-Client-Id`/`CF-Access-Client-Secret`
ditolak di edge (sebelum nyampe token webhook). Zero-trust dua lapis.

### Alternatif kalau gak punya domain
- **Cloudflare quick tunnel** (`cloudflared tunnel --url http://127.0.0.1:8787`) TIDAK cocok:
  URL-nya acak & ganti tiap restart, padahal routine butuh URL tetap.

## B2. Setup Tailscale Funnel (DIPILIH — tanpa perlu domain)

Funnel kasih hostname publik stabil `<mesin>.<tailnet>.ts.net` tanpa beli domain.
Webhook TETAP bind 127.0.0.1 (Funnel proxy lokal ke localhost:8787), token tetap benteng utama.

**Cara cepat — pakai script (jalanin SEKALI di laptop):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-tailscale-funnel.ps1
```
Script bakal: install tailscale (winget) → `tailscale up` (login browser) →
`tailscale funnel --bg 8787` → cetak `WEBHOOK_URL` + link `/health` yang siap dipasang.

**Manual (kalau mau step-by-step):**
1. `winget install --id tailscale.tailscale`
2. `tailscale up` (login akun Tailscale, gratis)
3. Di [admin console](https://login.tailscale.com/admin): enable **HTTPS Certificates** + **Funnel**
4. `tailscale funnel --bg 8787`  (background, persist antar-reboot)
5. `tailscale funnel status` → catat hostname. URL = `https://<mesin>.<tailnet>.ts.net/trade`
6. Tes: `curl https://<mesin>.<tailnet>.ts.net/health` → `{"ok":true}`

> Catatan: Funnel = publik ke internet (tanpa auth di lapis Tailscale), jadi **token webhook
> tetap wajib** (udah constant-time).

### ⚠️ B2.1 — Konflik WARP ↔ Tailscale (WAJIB dibaca kalau WARP kepasang)

Laptop Toshiba butuh **Cloudflare WARP** karena ISP (MyRepublic) suka blokir GitHub —
`git pull` auto-update gak jalan tanpa WARP. Tapi **WARP mode full-tunnel ("warp")
nangkep SEMUA trafik jaringan** → Tailscale kehabisan UDP/DERP (`netcheck` → `UDP: false`,
`Nearest DERP: unknown`) → `tailscale up` **ngegantung DIAM tanpa AuthURL / tanpa error**.
Inilah gejala "Tailscale gak bisa dibuka" — bukan masalah instalasi Tailscale.

**Solusi coexistence (dua-duanya hidup bareng):**
1. Taruh WARP di **proxy mode** (SOCKS5, gak nangkep network stack):
   ```powershell
   & "C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe" mode proxy
   & "C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe" proxy port 40000
   & "C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe" connect
   ```
   Mode ini persist antar-reboot. Verifikasi Tailscale sehat lagi: `tailscale netcheck` → `UDP: true`.
2. Arahin **cuma GitHub** lewat proxy WARP (repo-local, kena ke user manapun yg jalanin task):
   ```powershell
   git -C C:\bot-keluarga config http.https://github.com/.proxy socks5h://127.0.0.1:40000
   ```
   Tes: `git -C C:\bot-keluarga fetch origin main` → sukses.

> JANGAN balikin WARP ke full-tunnel (`warp-cli mode warp`) — itu bakal matiin Tailscale Funnel lagi.
> Di mesin ini: **WARP proxy mode + Tailscale Funnel = jalan bareng**, sudah terverifikasi.

## C. Setup bot trading (cloud routine)

Di prompt routine, simpan 2 secret: `WEBHOOK_URL` = `https://trade-bot.contohdomain.com/trade`
dan `WEBHOOK_TOKEN` = token yang **sama persis** dengan `.env` laptop. Lalu POST tiap event.

## Cara panggil

`POST <WEBHOOK_URL>` (lokal: `http://127.0.0.1:8787/trade`)
Header: `Authorization: Bearer <token>`, `Content-Type: application/json`
Body: JSON dengan field `type`. Respon sukses: `{"ok":true}`.

### 1. Posisi dibuka — `opened`
```json
{
  "type": "opened",
  "positions": [
    { "asset": "BTC", "side": "SHORT", "sizeUsd": 1200, "entry": 63500, "tp": 41275, "sl": 65000, "reason": "daily close nembus bawah GC Filter" },
    { "asset": "ETH", "side": "SHORT", "sizeUsd": 900,  "entry": 3400,  "tp": 2210,  "sl": 3550,  "reason": "momentum melemah" }
  ]
}
```

### 2. Stop Loss kena — `stop_loss` (satu request per posisi)
```json
{ "type": "stop_loss", "asset": "ETH", "side": "SHORT", "entry": 3400, "exit": 3550, "pnlUsd": -85, "durationDays": 3 }
```
`pnlUsd` boleh negatif atau positif — otomatis ditampilkan sebagai rugi.

### 3. Take Profit kena — `take_profit` (satu request per posisi)
```json
{ "type": "take_profit", "asset": "SOL", "side": "SHORT", "entry": 150, "exit": 97.5, "pnlUsd": 210, "durationDays": 12 }
```

### 4. Rekap harian — `daily_summary` (setelah semua posisi hari itu close)
```json
{ "type": "daily_summary", "tpCount": 3, "slCount": 1, "netPnlUsd": 340, "portfolioPct": 2.1, "navUsd": 16000 }
```

### 5. Perkenalan — `intro` (kirim SEKALI aja)
```json
{ "type": "intro" }
```

### 6. Pesan bebas — `message` (teks apa aja ke grup)
```json
{ "type": "message", "text": "FYI tiap pagi ~07.30 botnya mulai buka posisi ya 🌅", "mention": false }
```
`text` wajib (string). `mention` opsional (default false); kalau `true`, nama anggota
keluarga yang kesebut di teks bakal di-tag. Bold WhatsApp pakai `*satu bintang*`.

## Contoh perintah (buat prompt routine bot trading)

curl (ganti `$WEBHOOK_URL` & `$WEBHOOK_TOKEN` dgn secret routine):
```bash
curl -s -X POST "$WEBHOOK_URL" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"take_profit","asset":"SOL","side":"SHORT","entry":150,"exit":97.5,"pnlUsd":210,"durationDays":12}'
```

PowerShell:
```powershell
$body = @{ type='daily_summary'; tpCount=3; slCount=1; netPnlUsd=340; portfolioPct=2.1; navUsd=16000 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $env:WEBHOOK_URL `
  -Headers @{ Authorization = "Bearer $($env:WEBHOOK_TOKEN)" } `
  -ContentType 'application/json' -Body $body
```

## Tes tanpa bot trading

Di grup WA, kirim:
- `!trading-intro` → kirim pesan perkenalan
- `!trading-test` → preview format notif "posisi dibuka" (data contoh)

Cek tunnel hidup: `curl https://trade-bot.contohdomain.com/health` → `{"ok":true}`.

## Catatan keamanan

- Token = satu-satunya benteng begitu endpoint online. Pakai 32+ karakter acak, jangan di-commit.
- Token disimpan di DUA tempat (`.env` laptop + secret routine cloud) — perlakukan sbagai password.
- Kalau token bocor: ganti di dua tempat, restart bot + routine.
- Lapis ekstra: Cloudflare Access service token (lihat B). Webhook bind tetap 127.0.0.1.
