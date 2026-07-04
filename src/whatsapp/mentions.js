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
export function botJids(sock) {
  const out = new Set();
  const id = sock.user?.id;
  if (id) out.add(stripDevice(id)); // 6285...@s.whatsapp.net
  const lid = sock.user?.lid;
  if (lid) out.add(stripDevice(lid)); // xxxx@lid
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
