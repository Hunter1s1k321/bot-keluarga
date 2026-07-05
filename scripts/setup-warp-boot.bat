@echo off
REM =====================================================================
REM  Set WARP auto-connect pas BOOT (sebelum login) -> GitHub kejangkau
REM  buat auto-update, tapi WhatsApp tetep tembus. JALANIN SEBAGAI ADMIN.
REM =====================================================================

set "WARPCLI=C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe"

if not exist "%WARPCLI%" (
  echo [X] warp-cli gak ketemu di "%WARPCLI%"
  echo     Cek lokasi install WARP-mu, edit path di script ini.
  pause
  exit /b 1
)

REM Scheduled task: pas startup, SYSTEM, connect WARP
schtasks /Create /TN "WARPAutoConnect" /TR "\"%WARPCLI%\" --accept-tos connect" /SC ONSTART /RU SYSTEM /RL HIGHEST /F

REM Connect sekarang juga
"%WARPCLI%" --accept-tos connect

echo.
echo ============================================================
echo  WARP di-set auto-connect saat boot (sebelum login).
echo  Cek status : "%WARPCLI%" status
echo  Hapus task : schtasks /Delete /TN "WARPAutoConnect" /F
echo ============================================================
pause
