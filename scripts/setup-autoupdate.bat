@echo off
REM =====================================================================
REM  Bikin scheduled task auto-update (cek GitHub tiap 5 menit).
REM  JALANIN SEBAGAI ADMINISTRATOR.
REM =====================================================================

schtasks /Create /TN "BotKeluargaAutoUpdate" /TR "\"%~dp0update.bat\"" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F

echo.
echo ============================================================
echo  Task "BotKeluargaAutoUpdate" dibuat -> cek update tiap 5 menit.
echo  Sekarang: push dari PC utama -> laptop nyusul sendiri (max 5 menit).
echo.
echo  Cek task   : schtasks /Query /TN "BotKeluargaAutoUpdate"
echo  Tes manual : "%~dp0update.bat"
echo  Hapus task : schtasks /Delete /TN "BotKeluargaAutoUpdate" /F
echo ============================================================
pause
