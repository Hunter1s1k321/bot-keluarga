/**
 * Install bot sebagai Windows Service (auto-start pas boot, TANPA login).
 *
 * Jalankan di terminal ADMINISTRATOR:
 *   node scripts/install-service.cjs
 *
 * Sebelum ini: pastikan `npm start` yang manual udah di-STOP (Ctrl+C),
 * biar gak dobel konek ke WhatsApp.
 */
const path = require('node:path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'BotKeluarga',
  description: 'WhatsApp bot jadwal keluarga (auto-start saat boot).',
  script: path.join(__dirname, '..', 'src', 'index.js'),
  workingDirectory: path.join(__dirname, '..'),
  // Restart otomatis kalau crash
  maxRestarts: 30,
  wait: 5, // detik jeda antar restart
});

svc.on('install', () => {
  console.log('✅ Service "BotKeluarga" terinstall. Menyalakan...');
  svc.start();
});
svc.on('alreadyinstalled', () => {
  console.log('ℹ️  Service udah terinstall sebelumnya. (uninstall dulu kalau mau re-install)');
});
svc.on('start', () => {
  console.log('✅ Bot JALAN sebagai service! Auto-nyala tiap boot, tanpa login.');
  console.log('   Cek: buka "services.msc" -> cari "BotKeluarga" (harus Running, Automatic).');
});
svc.on('error', (e) => console.error('❌ Error:', e));

console.log('Menginstall service (butuh hak Administrator)...');
svc.install();
