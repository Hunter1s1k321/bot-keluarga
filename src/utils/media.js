import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';

// Batas ukuran biar aman (inline data Gemini ~20MB/request). 15MB cukup buat foto/PDF jadwal.
const MAX_BYTES = 15 * 1024 * 1024;

/** Buka bungkus pesan (document+caption / view-once) supaya media-nya kebaca. */
function unwrap(msg) {
  const m = msg.message || {};
  if (m.documentWithCaptionMessage?.message) {
    return { key: msg.key, message: m.documentWithCaptionMessage.message };
  }
  if (m.viewOnceMessageV2?.message) {
    return { key: msg.key, message: m.viewOnceMessageV2.message };
  }
  return msg;
}

/**
 * Deteksi lampiran yang bisa dibaca Gemini (gambar / PDF).
 * @returns {{inner:object, mimeType:string, unsupported?:boolean}|null}
 */
export function detectMedia(msg) {
  const inner = unwrap(msg);
  const m = inner.message || {};
  if (m.imageMessage) {
    return { inner, mimeType: m.imageMessage.mimetype || 'image/jpeg' };
  }
  if (m.documentMessage) {
    const mt = m.documentMessage.mimetype || '';
    if (mt.includes('pdf') || mt.startsWith('image/')) {
      return { inner, mimeType: mt || 'application/pdf' };
    }
    return { inner, mimeType: mt, unsupported: true };
  }
  return null;
}

/**
 * Download lampiran jadi { mimeType, base64 } buat dikirim ke Gemini vision.
 * @returns {Promise<{mimeType:string, base64:string}|null>}
 */
export async function downloadAsBase64(sock, msg) {
  const det = detectMedia(msg);
  if (!det || det.unsupported) return null;
  const buffer = await downloadMediaMessage(
    det.inner,
    'buffer',
    {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );
  if (buffer.length > MAX_BYTES) {
    logger.warn(`Lampiran kegedean (${buffer.length} bytes), dilewati.`);
    return null;
  }
  return { mimeType: det.mimeType, base64: buffer.toString('base64') };
}
