import { config } from './config.js';
import { logger } from './logger.js';

function mapPlace(p, query) {
  return {
    name: p.displayName?.text || query,
    address: p.formattedAddress || '',
    // buang param tracking (&g_mp=...) biar link bersih, cukup cid
    mapsUri: (p.googleMapsUri || '').replace(/&g_mp=[^&]*/g, ''),
    photoName: p.photos?.[0]?.name || null,
    rating: p.rating || null,
    ratingCount: p.userRatingCount || 0,
    reviews: (p.reviews || [])
      .slice(0, 3)
      .map((r) => ({
        author: r.authorAttribution?.displayName || 'Anonim',
        rating: r.rating || null,
        text: (r.text?.text || r.originalText?.text || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 220),
      }))
      .filter((r) => r.text),
  };
}

/**
 * Cari beberapa tempat via Places API (New). Ada fallback kalau query kelewat
 * spesifik (mis. "bebek goreng X" -> retry "tempat makan bebek X").
 * @returns {Promise<Array>} daftar tempat (bisa kosong)
 */
export async function searchPlaces(query, maxResults = 5) {
  const key = config.maps.apiKey;
  if (!key || !query) return [];

  async function call(q) {
    const res = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'places.displayName,places.formattedAddress,places.googleMapsUri,places.photos,places.rating,places.userRatingCount,places.reviews',
        },
        body: JSON.stringify({ textQuery: q, languageCode: 'id', maxResultCount: maxResults }),
      }
    );
    if (!res.ok) {
      logger.warn(`Places API status ${res.status}`);
      return [];
    }
    const j = await res.json();
    return (j.places || []).filter((p) => p.googleMapsUri).map((p) => mapPlace(p, q));
  }

  try {
    let places = await call(query);
    // fallback: query terlalu spesifik -> lebih luas
    if (!places.length && !/^tempat makan/i.test(query)) {
      places = await call(`tempat makan ${query}`);
    }
    return places;
  } catch (e) {
    logger.warn(e, 'Places API gagal');
    return [];
  }
}

/** Cari 1 tempat (buat kuliner info pagi). */
export async function searchPlace(query) {
  return (await searchPlaces(query, 1))[0] || null;
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
