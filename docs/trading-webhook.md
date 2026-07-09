# Webhook Notif Bot Trading → Grup WA

Family bot ("Keluarga binar") buka **webhook lokal** buat nerima notif dari bot
trading kripto (TR-GC-Crypto-LS-9) dan meneruskannya sebagai pesan ke grup WA.

## Setup (di laptop yang jalanin family bot)

1. Isi `.env`:
   ```
   TRADING_WEBHOOK_TOKEN=<token-acak>   # WAJIB, kalau kosong webhook OFF
   TRADING_WEBHOOK_PORT=8787            # opsional
   TRADING_OWNER=Marvel                 # opsional (di-tag di pesan intro)
   USD_IDR_FALLBACK=16500               # opsional (cadangan kalau API kurs down)
   ```
2. Restart bot. Log muncul: `💹 Webhook trading aktif di http://127.0.0.1:8787/trade`.

> Server cuma listen di `127.0.0.1` → bot trading HARUS jalan di laptop yang sama.
> USD→IDR di-fetch otomatis oleh family bot (real-time, cache 30 mnt). Payload
> cukup kirim angka **USD** aja.

## Cara panggil

`POST http://127.0.0.1:8787/trade`
Header: `Authorization: Bearer <TRADING_WEBHOOK_TOKEN>`, `Content-Type: application/json`
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

## Contoh perintah (buat prompt Claude Code bot trading)

PowerShell (Windows):
```powershell
$body = @{ type='daily_summary'; tpCount=3; slCount=1; netPnlUsd=340; portfolioPct=2.1; navUsd=16000 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/trade `
  -Headers @{ Authorization = "Bearer $env:TRADING_WEBHOOK_TOKEN" } `
  -ContentType 'application/json' -Body $body
```

curl:
```bash
curl -s -X POST http://127.0.0.1:8787/trade \
  -H "Authorization: Bearer $TRADING_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"take_profit","asset":"SOL","side":"SHORT","entry":150,"exit":97.5,"pnlUsd":210,"durationDays":12}'
```

## Tes tanpa bot trading

Di grup WA, kirim:
- `!trading-intro` → kirim pesan perkenalan
- `!trading-test` → preview format notif "posisi dibuka" (data contoh)
