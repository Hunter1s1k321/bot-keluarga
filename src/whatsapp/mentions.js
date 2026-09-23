/** Utility deteksi mention / info pesan WhatsApp. */

/** Buang suffix device (":1") dari sebuah JID. */
function stripDevice(jid = '') {
  const [user, domain] = jid.split('@');
  return `${user.split(':')[0]}@${domain || 's.whatsapp.net'}`;
}

/**
 * Semua kemungkinan JID bot: nomor biasa (@s.whatsapp.net) DAN LID (@lid).
 * WhatsApp baru kadang pakai LID untuk mention di grup.
 */
// LID/JID bot yang "dipelajari" dari pesan fromMe di grup. Abis re-link, LID bot
// DI GRUP (yg dipakai anggota buat nge-mention) sering BEDA dari sock.user.lid /
// creds.me.lid. Tiap bot ngirim ke grup, echo fromMe-nya bawa key.participant =
// identitas bot di grup itu. Kita rekam biar deteksi mention nyambung. Self-correct.
const learnedBotJids = new Set();
export function learnBotJid(jid) {
  if (jid && typeof jid === 'string') learnedBotJids.add(stripDevice(jid));
}
export function learnedBots() {
  return [...learnedBotJids];
}

export function botJids(sock) {
  const out = new Set();
  const add = (j) => {
    if (j && typeof j === 'string') out.add(stripDevice(j));
  };
  // Ambil dari SEMUA sumber yg mungkin — abis re-link (scan QR baru) kadang
  // sock.user.lid kosong tapi identitasnya ada di authState.creds.me.
  add(sock.user?.id); // 6285...@s.whatsapp.net
  add(sock.user?.lid); // xxxx@lid
  const me = sock.authState?.creds?.me;
  add(me?.id);
  add(me?.lid);
  for (const j of learnedBotJids) out.add(j); // LID grup yg dipelajari dari fromMe
  return out;
}

/** contextInfo dari berbagai tipe pesan. */
function contextInfo(msg) {
  const m = msg.message || {};
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    null
  );
}

/** Daftar JID yang di-mention di pesan (device-stripped). */
export function mentionedJids(msg) {
  return (contextInfo(msg)?.mentionedJid || []).map(stripDevice);
}

/** True kalau bot di-tag di pesan ini. */
export function isBotMentioned(sock, msg) {
  const bots = botJids(sock);
  return mentionedJids(msg).some((j) => bots.has(j));
}

/** True kalau pesan ini me-reply (quote) pesan si bot. */
export function isReplyToBot(sock, msg) {
  const ci = contextInfo(msg);
  if (!ci?.participant) return false;
  return botJids(sock).has(stripDevice(ci.participant));
}
