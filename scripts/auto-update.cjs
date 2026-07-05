/**
 * Auto-update: cek GitHub, kalau ada commit baru -> pull + (npm install kalau
 * deps berubah) + restart service. Dijalanin scheduled task tiap beberapa menit.
 *
 * Aman: kalau GitHub gak kejangkau (WARP mati) -> gagal diam, gak ngutak-atik apa2.
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const run = (cmd) =>
  execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const log = (m) => console.log(`[auto-update ${new Date().toISOString()}] ${m}`);

try {
  run('git fetch origin main');
  const behind = run('git rev-list HEAD..origin/main --count');
  if (behind === '0') {
    log('sudah terbaru');
    process.exit(0);
  }
  log(`ada ${behind} commit baru, update...`);

  const changed = run('git diff --name-only HEAD origin/main');
  run('git pull --ff-only origin main');

  if (/package(-lock)?\.json/.test(changed)) {
    log('dependency berubah -> npm install...');
    run('npm install --no-audit --no-fund');
  }

  // Tulis penanda biar bot ngumumin update di grup pas restart nanti
  try {
    const version = require(path.join(root, 'package.json')).version;
    const subject = run('git log -1 --format=%s');
    fs.writeFileSync(
      path.join(root, '.pending-announce'),
      JSON.stringify({ version, subject })
    );
  } catch {
    /* gak fatal */
  }

  try {
    run('net stop BotKeluarga');
  } catch {
    /* mungkin udah stop */
  }
  run('net start BotKeluarga');
  log('✅ updated & service di-restart');
} catch (e) {
  log('gagal (skip): ' + (e.message || e));
  process.exit(1);
}
