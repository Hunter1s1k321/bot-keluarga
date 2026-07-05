# 🚀 Deploy ke Laptop Server (Toshiba)

Panduan pindahin bot ke laptop tua biar jalan 24/7. Ikutin urut.

## 0. Siapin di laptop (sekali)

- **Node.js** (versi 20+): download dari [nodejs.org](https://nodejs.org) → install.
- **Git**: download dari [git-scm.com](https://git-scm.com) → install.
- **Cloudflare WARP** ("1.1.1.1" app): install, mode **WARP**, **Connect ON**, set biar nyala otomatis. *(Wajib — GitHub di-block ISP tanpa ini.)*
- Cek di CMD: `node -v` dan `git --version` keluar versinya.

## 1. Clone kode

```cmd
cd /d C:\
git clone https://github.com/Hunter1s1k321/bot-keluarga.git
cd bot-keluarga
npm install
```
> Boleh taruh di C:\ atau D:\ — bebas. Sesuaikan aja path-nya.

## 2. Copy file RAHASIA via USB

File ini GAK ada di GitHub (sengaja). Copy dari **PC utama** (`D:\bot-keluarga\`) ke folder yang sama di laptop:

- [ ] `.env`
- [ ] `credentials.json`
- [ ] `token.json`
- [ ] `people.json`
- [ ] folder `auth/` **(seluruh isinya — ini session WhatsApp)**

> ⚠️ Setelah `auth/` dipindah & laptop jalan, **JANGAN jalanin bot di PC utama lagi** (session WA cuma boleh 1 mesin, nanti bentrok).

## 3. Tes jalan manual (mastiin OK)

```cmd
npm start
```
Harus muncul `✅ Tersambung ke WhatsApp` (gak perlu scan QR lagi karena `auth/` udah dicopy). Coba `ping` di grup → `pong`. Kalau OK, **Ctrl+C**.

## 4. Jadiin Windows Service (auto-start tanpa login)

Terminal **Administrator**, di folder project:
```cmd
npm run service:install
```
Cek `services.msc` → "BotKeluarga" = Running + Automatic.

## 5. Setup auto-update (push dari PC → laptop nyusul sendiri)

Terminal **Administrator**:
```cmd
scripts\setup-autoupdate.bat
```
Ini bikin scheduled task yang tiap 5 menit cek GitHub, kalau ada update → pull + restart service otomatis.

**Alur update ke depan:** di PC utama tinggal `git push` → dalam ≤5 menit laptop narik sendiri & restart. Gak perlu buka laptop. ✅

## 6. (Opsional) Auto-nyala pas listrik balik

Kalau mau laptop nyala sendiri abis mati listrik: masuk **BIOS** (tekan F2/Del pas boot) → cari **"Restore on AC Power Loss"** / **"AC Recovery"** → set **Power On**. (Gak semua laptop punya.) Baterai laptop juga bantu nahan mati pas listrik kedip.

---

## 🔧 Perintah berguna (di laptop)

| Aksi | Command (Admin) |
|---|---|
| Restart bot | `net stop BotKeluarga && net start BotKeluarga` |
| Update manual sekarang | `scripts\update.bat` |
| Lihat log bot | cek folder `logs/` (out.log / error.log) |
| Hapus service | `npm run service:uninstall` |
| Hapus auto-update | `schtasks /Delete /TN "BotKeluargaAutoUpdate" /F` |

Troubleshooting umum ada di [README.md](README.md).
