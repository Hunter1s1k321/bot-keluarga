#requires -Version 5
<#
  Setup Tailscale Funnel buat expose webhook trading (127.0.0.1:PORT) ke internet.
  Bot trading jalan di CLOUD Claude.ai, family bot di laptop ini -> perlu URL publik.
  Funnel kasih hostname stabil <mesin>.<tailnet>.ts.net TANPA perlu beli domain.

  Jalanin SEKALI di laptop yang jalanin family bot:
      powershell -ExecutionPolicy Bypass -File scripts\setup-tailscale-funnel.ps1

  Sebagian langkah interaktif (login browser Tailscale) — ikutin aja promptnya.
  Butuh akun Tailscale (gratis). Port default 8787 (samain sama TRADING_WEBHOOK_PORT).
#>
param([int]$Port = 8787)

$ErrorActionPreference = 'Stop'

function Find-Tailscale {
  $c = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $p) { return $p }
  return $null
}

Write-Host "== Setup Tailscale Funnel buat webhook trading (port $Port) ==" -ForegroundColor Cyan

# 0) Pastikan tailscale kepasang
$ts = Find-Tailscale
if (-not $ts) {
  Write-Host "Tailscale belum ada, install via winget..." -ForegroundColor Yellow
  winget install --id tailscale.tailscale -e --accept-source-agreements --accept-package-agreements
  $ts = Find-Tailscale
  if (-not $ts) {
    throw "Gagal nemu tailscale.exe. Install manual dari https://tailscale.com/download lalu jalanin ulang script ini."
  }
}
Write-Host "tailscale: $ts" -ForegroundColor Green

# 1) Login / connect ke tailnet (buka browser kalau belum login)
Write-Host "`n[1/3] Nyambung ke tailnet (login browser kalau diminta)..." -ForegroundColor Cyan
& $ts up

# 2) Nyalain Funnel ke port webhook, background + persist antar-reboot
Write-Host "`n[2/3] Nyalain Funnel -> localhost:$Port ..." -ForegroundColor Cyan
& $ts funnel --bg $Port
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n[!] Funnel belum aktif. Biasanya karena fitur Funnel/HTTPS belum di-enable" -ForegroundColor Yellow
  Write-Host "    di admin console. Buka link yang muncul di atas (atau https://login.tailscale.com/admin)," -ForegroundColor Yellow
  Write-Host "    enable 'HTTPS Certificates' + 'Funnel', lalu jalanin lagi:" -ForegroundColor Yellow
  Write-Host "        tailscale funnel --bg $Port" -ForegroundColor White
  exit 1
}

# 3) Tampilin URL publik yang harus dipasang di routine cloud
Write-Host "`n[3/3] Status Funnel:" -ForegroundColor Cyan
& $ts funnel status

$dns = $null
try { $dns = (& $ts status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.') } catch {}

Write-Host "`n==================================================" -ForegroundColor Green
if ($dns) {
  $url = "https://$dns/trade"
  Write-Host " WEBHOOK_URL (buat env routine Claude.ai):" -ForegroundColor Green
  Write-Host "   $url" -ForegroundColor White
  Write-Host " Health check (tes di browser/curl):" -ForegroundColor Green
  Write-Host "   https://$dns/health   -> harusnya {""ok"":true}" -ForegroundColor White
  Write-Host "==================================================" -ForegroundColor Green
  Write-Host " Set 2 env di Claude.ai routine (TR-GC-Crypto-LS-9):"
  Write-Host "   WEBHOOK_URL   = $url"
  Write-Host "   WEBHOOK_TOKEN = (SAMA PERSIS dgn TRADING_WEBHOOK_TOKEN di .env laptop)"
} else {
  Write-Host " Gak bisa auto-detect DNS name. Cek manual: tailscale status" -ForegroundColor Yellow
  Write-Host " URL-nya bentuk: https://<mesin>.<tailnet>.ts.net/trade" -ForegroundColor Yellow
}
