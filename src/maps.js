import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Cari tempat via Places API (New) -> dapet link Maps tempat SPESIFIK
 * (yang bikin preview kaya: nama + foto di WhatsApp).
 * Butuh MAPS_API_KEY. Kalau gak ada / gagal -> null (nanti fallback search link).
 * @returns {Promise<{name:string, address:string, mapsUri:string}|null>}
 */
export async function searchPlace(query) {
  const key = config.maps.apiKey;
  if (!key) return null;
  try {
    const res = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'places.displayName,places.formattedAddress,places.googleMapsUri,places.photos',
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'id',
          maxResultCount: 1,
        }),
      }
    );
    if (!res.ok) {
      logger.warn(`Places API status ${res.status} (cek key / enable Places API)`);
      return null;
    }
    const j = await res.json();
    const p = j.places?.[0];
    if (!p?.googleMapsUri) return null;
    return {
      name: p.displayName?.text || query,
      address: p.formattedAddress || '',
      // buang param tracking (&g_mp=...) biar link bersih, cukup cid
      mapsUri: p.googleMapsUri.replace(/&g_mp=[^&]*/g, ''),
      photoName: p.photos?.[0]?.name || null,
    };
  } catch (e) {
    logger.warn(e, 'Places API gagal');
    return null;
  }
}

/**
 * Download foto tempat dari Places Photo API -> Buffer (buat dikirim sbg gambar WA).
 * @returns {Promise<Buffer|null>}
 */
export async function fetchPlacePhoto(photoName, maxPx = 800) {
  const key = config.maps.apiKey;
  if (!key || !photoName) return null;
  try {
    const url =
      `https://places.googleapis.com/v1/${photoName}/media` +
      `?maxHeightPx=${maxPx}&maxWidthPx=${maxPx}&key=${key}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      logger.warn(`Places photo status ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    logger.warn(e, 'fetch foto tempat gagal');
    return null;
  }
}

/** Link Maps fallback (search biasa) kalau Places API gak ada. */
export function mapsSearchUrl(query) {
  const q = encodeURIComponent(query.replace(/,/g, ' '))
    .replace(/%20/g, '+');
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
