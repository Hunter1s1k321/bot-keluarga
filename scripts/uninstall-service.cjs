/**
 * Hapus Windows Service "BotKeluarga".
 * Jalankan di terminal ADMINISTRATOR:
 *   node scripts/uninstall-service.cjs
 */
const path = require('node:path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'BotKeluarga',
  script: path.join(__dirname, '..', 'src', 'index.js'),
});

svc.on('uninstall', () => console.log('✅ Service "BotKeluarga" udah dihapus.'));
svc.on('error', (e) => console.error('❌ Error:', e));

svc.uninstall();
