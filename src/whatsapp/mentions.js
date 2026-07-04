/** Utility deteksi mention / info pesan WhatsApp. */

/** JID bot dalam bentuk normal "nomor@s.whatsapp.net" (tanpa :device). */
export function botJid(sock) {
  const id = sock.user?.id || '';
  const num = id.split(':')[0].split('@')[0];
  return `${num}@s.whatsapp.net`;
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

/** Daftar JID yang di-mention di pesan. */
export function mentionedJids(msg) {
  return contextInfo(msg)?.mentionedJid || [];
}

/** True kalau bot di-tag di pesan ini. */
export function isBotMentioned(sock, msg) {
  return mentionedJids(msg).includes(botJid(sock));
}

/** True kalau pesan ini me-reply (quote) pesan si bot. */
export function isReplyToBot(sock, msg) {
  const ci = contextInfo(msg);
  return !!ci?.participant && ci.participant === botJid(sock);
}
