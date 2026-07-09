import { config } from '../config.js';
import { logger } from '../logger.js';

// Kurs USD->IDR di-cache biar gak nge-fetch tiap notif (bisa banyak dalam sehari).
let cache = { rate: 0, at: 0 };
const TTL_MS = 30 * 60 * 1000; // 30 menit

/**
 * Ambil kurs 1 USD dalam IDR (real-time, di-cache 30 menit).
 * Sumber: open.er-api.com (gratis, tanpa API key). Kalau gagal -> pakai
 * kurs terakhir yang sukses, atau fallback dari .env.
 * @returns {Promise<number>}
 */
export async function usdIdrRate() {
  const now = Date.now();
  if (cache.rate && now - cache.at < TTL_MS) return cache.rate;

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const rate = data?.rates?.IDR;
    if (Number.isFinite(rate) && rate > 0) {
      cache = { rate, at: now };
      return rate;
    }
    throw new Error('field rates.IDR kosong/invalid');
  } catch (e) {
    logger.warn(e, '[fx] gagal ambil kurs USD->IDR, pakai fallback');
    return cache.rate || config.trading.fxFallback;
  }
}
