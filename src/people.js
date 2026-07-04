import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { logger } from './logger.js';

const FILE = path.join(ROOT, 'people.json');

let people = [];
try {
  people = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  logger.warn('people.json tidak ada / tidak valid — bot pakai nama default.');
  people = [];
}

/** Rapikan nomor jadi format 62xxxx (buang non-digit, 0 depan -> 62). */
export function normalizeNumber(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d;
}

const byNumber = new Map(
  people.map((p) => [normalizeNumber(p.number), p])
);

/** Cari orang dari nomor. @returns {{name,nick,number}|null} */
export function identify(number) {
  return byNumber.get(normalizeNumber(number)) || null;
}

/** Daftar anggota (nama referensi + panggilan) buat konteks agent. */
export function roster() {
  return people.map((p) => ({ name: p.name, nick: p.nick }));
}

/**
 * Ambil nomor pengirim dari pesan WA (grup / japri).
 * Coba beberapa field karena WA baru kadang pakai LID.
 */
export function senderNumber(msg) {
  const cand =
    msg.key?.participantPn ||
    msg.key?.participant ||
    msg.participant ||
    (msg.key?.remoteJid?.endsWith('@s.whatsapp.net')
      ? msg.key.remoteJid
      : '') ||
    '';
  return cand.split('@')[0].split(':')[0];
}
