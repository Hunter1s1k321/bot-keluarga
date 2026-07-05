import { peopleList, numberToJid, normalizeNumber } from '../people.js';

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ubah nama anggota keluarga di teks jadi MENTION/tag WhatsApp.
 * "Marvel - Misdinar 1 jam lagi" -> teks "@6283... - Misdinar..." + mentions[jid].
 * WA nampilinnya jadi tag @Marvel yang beneran nge-ping orangnya.
 * @returns {{text:string, mentions:string[]}}
 */
export function applyMentions(text) {
  if (!text) return { text: text || '', mentions: [] };
  let out = text;
  const jids = new Set();
  for (const p of peopleList()) {
    // cocokin NAMA (case-insensitive) sebagai kata utuh
    const re = new RegExp(`\\b${esc(p.name)}\\b`, 'gi');
    if (re.test(out)) {
      out = out.replace(re, `@${normalizeNumber(p.number)}`);
      jids.add(numberToJid(p.number));
    }
  }
  return { text: out, mentions: [...jids] };
}

/** JID semua anggota (buat "tag all" acara keluarga). */
export function allMemberJids() {
  return peopleList().map((p) => numberToJid(p.number));
}
