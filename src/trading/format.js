// Formatter pesan notif trading. PURE & sinkron (kurs USD->IDR di-pass dari luar)
// biar gampang dites tanpa jaringan. Semua bold pakai *satu* bintang (WhatsApp).

const usdFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const idrFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** "$1,200.00" */
export function fmtUsd(n) {
  return `$${usdFmt.format(n)}`;
}
/** "Rp19.800.000" */
export function fmtIdr(n) {
  return `Rp${idrFmt.format(Math.round(n))}`;
}
/** Harga/angka dgn desimal adaptif: koin gede 2 dp, koin receh sampai 10 dp
 * (trailing zero dibuang otomatis) biar micro-cap gak nyaru. */
export function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  const dp = Math.abs(n) >= 1 ? 2 : 10;
  return `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  }).format(n)}`;
}

/** "$1,200.00 (Rp19.800.000)" */
function money(usd, rate) {
  return `${fmtUsd(usd)} (${fmtIdr(usd * rate)})`;
}
/** Bertanda: "+$210.00 (+Rp3.465.000)" / "-$85.00 (-Rp1.402.500)" */
function signedMoney(usd, rate) {
  const sign = usd >= 0 ? '+' : '-';
  const a = Math.abs(usd);
  return `${sign}$${usdFmt.format(a)} (${sign}Rp${idrFmt.format(Math.round(a * rate))})`;
}

function sideTag(side) {
  const s = String(side || '').toUpperCase();
  return s === 'LONG' ? 'LONG 🔺' : 'SHORT 🔻';
}
function days(n) {
  if (n == null) return '';
  return `${n} hari`;
}

/** (1) Posisi baru dibuka — daftar posisi. */
export function buildOpened(p, rate) {
  const list = p.positions || [];
  const head = `🟢 *Posisi baru dibuka* (${list.length})\n`;
  const blocks = list.map((pos, i) => {
    const lines = [
      `${i + 1}. *${pos.asset}* — ${sideTag(pos.side)}`,
      `   💰 ukuran: ${money(pos.sizeUsd, rate)}`,
      `   🎯 entry ${fmtPrice(pos.entry)}  |  TP ${fmtPrice(pos.tp)}  |  SL ${fmtPrice(pos.sl)}`,
    ];
    if (pos.reason) lines.push(`   💬 ${pos.reason}`);
    return lines.join('\n');
  });
  return `${head}\n${blocks.join('\n\n')}`;
}

/** (2) Stop Loss kena — per posisi. */
export function buildStopLoss(p, rate) {
  return (
    `🛑 *Stop Loss kena* — *${p.asset}*\n\n` +
    `📊 ${sideTag(p.side)}  |  masuk ${fmtPrice(p.entry)} → keluar ${fmtPrice(p.exit)}\n` +
    `📉 rugi: ${signedMoney(-Math.abs(p.pnlUsd), rate)}\n` +
    `⏱️ durasi: ${days(p.durationDays)}\n\n` +
    `_santai, ini emang SL otomatis biar rugi gak melebar_ 🙏`
  );
}

/** (3) Take Profit kena — per posisi. */
export function buildTakeProfit(p, rate) {
  return (
    `✅ *Take Profit kena!* — *${p.asset}* 🎉\n\n` +
    `📊 ${sideTag(p.side)}  |  masuk ${fmtPrice(p.entry)} → keluar ${fmtPrice(p.exit)}\n` +
    `📈 untung: ${signedMoney(Math.abs(p.pnlUsd), rate)}\n` +
    `⏱️ durasi: ${days(p.durationDays)}`
  );
}

/** (4) Semua posisi hari ini sudah close — rekap harian. */
export function buildDailySummary(p, rate) {
  const net = Number(p.netPnlUsd) || 0;
  const pctStr =
    p.portfolioPct == null
      ? ''
      : `📊 dari portofolio: ${net >= 0 ? '+' : ''}${p.portfolioPct}%\n`;
  const mood =
    net > 0
      ? '_ijo hari ini, mantap_ 😎'
      : net < 0
        ? '_merah tipis, besok lanjut_ 😌'
        : '_impas, aman_ 🙂';
  return (
    `📋 *Rekap trading hari ini*\n\n` +
    `✅ TP: ${p.tpCount ?? 0}    🛑 SL: ${p.slCount ?? 0}\n` +
    `💵 net: ${signedMoney(net, rate)}\n` +
    pctStr +
    `🏦 NAV terkini: ${money(p.navUsd, rate)}\n\n` +
    mood
  );
}

/** (5) Pesan perkenalan — dikirim sekali, buat nenangin ortu. */
export function buildIntro(owner = 'Marvel') {
  return (
    `Halo semuanya 👋 ada kabar baru nih.\n\n` +
    `Mulai sekarang aku bakal sekalian nyampein update dari *bot trading kripto* punya ${owner} ke grup ini. Biar transparan, jadi kalian tau apa yang dia lakuin.\n\n` +
    `Tenang, ini *bukan judi*. Cara kerjanya sederhana & hati-hati:\n\n` +
    `🎯 Tiap hari dia analisa ratusan koin, cuma masuk yang trennya jelas\n` +
    `🛡️ Tiap posisi cuma pakai *3–8% dari total dana* — gak pernah taruh semua telur di satu keranjang\n` +
    `⚖️ Leverage cuma *1x* (gak minjem/gak gambling), jadi *gak bisa kena likuidasi* kayak cerita horor kripto\n` +
    `✂️ Ada *Stop Loss* otomatis yang mutus rugi kecil sebelum membengkak\n` +
    `📈 Ada *Take Profit* otomatis yang ngunci untung\n\n` +
    `Dan yang paling penting: *semua kelihatan di sini*. Tiap buka posisi, tiap untung, tiap rugi — muncul di grup ini real-time. Jadi Papah Mamah bisa pantau langsung, gak ada yang disembunyiin 🙏\n\n` +
    `Santai aja ya, ini dijaga baik-baik kok. Kalau ada yang mau ditanya, tanya aja di sini 😊`
  );
}
