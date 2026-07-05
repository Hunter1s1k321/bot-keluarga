import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { nowContext } from '../utils/dates.js';
import { searchPlace, mapsSearchUrl, fetchPlacePhoto } from '../maps.js';

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

/**
 * Panggil Gemini dengan retry HANYA untuk error jaringan/transient.
 * PENTING: jangan retry 429 (kuota) — buat limit harian percuma & malah boros.
 */
export async function generateWithRetry(params, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e) {
      lastErr = e;
      const msg = e?.message || '';
      const isQuota = e?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg);
      const retriable =
        !isQuota &&
        /fetch failed|ETIMEDOUT|ECONNRESET|UND_ERR|socket hang up|network|503|overloaded/i.test(
          msg
        );
      if (!retriable || i === tries - 1) throw e;
      const wait = 1000 * (i + 1);
      logger.warn(`Gemini transient (${msg.slice(0, 80)}), retry ${i + 1}/${tries - 1} dalam ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** True kalau error karena kuota Gemini habis (buat pesan ramah ke user). */
export function isQuotaError(e) {
  return e?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(e?.message || '');
}

// Skema satu event (dipakai ulang oleh ekstraksi & router).
const eventItemSchema = {
  type: Type.OBJECT,
  properties: {
    person: {
      type: Type.STRING,
      description:
        'Nama orang yang terlibat, buat prefix judul. Kosongkan jika tidak jelas.',
    },
    title: {
      type: Type.STRING,
      description: 'Nama/jenis acara, mis. "Misdinar", "Rapat RT".',
    },
    date: {
      type: Type.STRING,
      description: 'Tanggal acara format YYYY-MM-DD (WIB).',
    },
    startTime: {
      type: Type.STRING,
      description: 'Jam mulai "HH:MM" 24 jam. Kosongkan jika tak ada.',
    },
    endTime: {
      type: Type.STRING,
      description: 'Jam selesai "HH:MM". Kosongkan jika tak ada.',
    },
    allDay: {
      type: Type.BOOLEAN,
      description: 'true kalau acara seharian / tanpa jam spesifik.',
    },
    location: {
      type: Type.STRING,
      description: 'Lokasi acara kalau disebut. Boleh kosong.',
    },
  },
  required: ['person', 'title', 'date', 'allDay'],
};

// Skema output ekstraksi acara. Bisa banyak event (mis. dari 1 gambar jadwal).
const eventsSchema = {
  type: Type.OBJECT,
  properties: {
    events: { type: Type.ARRAY, items: eventItemSchema },
  },
  required: ['events'],
};

// Skema router: klasifikasi maksud pesan + parameter.
const routeSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['add', 'query', 'delete', 'chat'],
      description: 'Maksud pesan pengguna.',
    },
    events: {
      type: Type.ARRAY,
      items: eventItemSchema,
      description: 'Diisi HANYA kalau intent=add.',
    },
    dateFrom: {
      type: Type.STRING,
      description: 'Rentang mulai YYYY-MM-DD untuk query/delete. Kosong kalau tak jelas.',
    },
    dateTo: {
      type: Type.STRING,
      description: 'Rentang akhir YYYY-MM-DD untuk query/delete. Kosong kalau tak jelas.',
    },
    person: {
      type: Type.STRING,
      description: 'Filter nama orang untuk query/delete. Boleh kosong.',
    },
    keyword: {
      type: Type.STRING,
      description: 'Kata kunci nama acara untuk query/delete. Boleh kosong.',
    },
  },
  required: ['intent'],
};

function extractionSystemInstruction() {
  const { human, today, timezone } = nowContext();
  return [
    'Kamu asisten yang mengekstrak detail acara dari pesan keluarga (teks atau gambar/PDF jadwal).',
    `Sekarang: ${human} (timezone ${timezone}). Hari ini = ${today}.`,
    'Aturan:',
    '- Ubah tanggal relatif ("besok", "Sabtu depan", "lusa") jadi tanggal absolut YYYY-MM-DD berdasarkan "hari ini" di atas.',
    '- Kalau tahun tidak disebut, pakai kejadian terdekat ke depan (jangan tanggal yang sudah lewat).',
    '- Jam pakai 24 jam "HH:MM" (WIB). Kalau tidak ada jam, set allDay=true dan kosongkan startTime/endTime.',
    '- "person" = nama orang yang terlibat untuk prefix judul (mis. "Marvel"). Kalau jadwal (gambar/PDF) berisi banyak nama/baris, buat satu event per baris.',
    '- Kalau pesan pengguna menyebut nama tertentu yang diminta (mis. "ambil punya Marvel & Zio aja"), ekstrak HANYA baris yang cocok nama itu.',
    '- Kalau tidak ada acara yang bisa diekstrak sama sekali, kembalikan events: [] (array kosong).',
    '- Jangan mengarang detail yang tidak ada di sumber.',
  ].join('\n');
}

/**
 * Ekstrak acara dari teks dan/atau gambar/PDF.
 * @param {object} p
 * @param {string} [p.text]
 * @param {Array<{mimeType:string, base64:string}>} [p.media]
 * @returns {Promise<Array<object>>} daftar event mentah
 */
export async function extractEvents({ text = '', media = [] } = {}) {
  const parts = [];
  if (text) parts.push({ text });
  for (const m of media) {
    parts.push({ inlineData: { mimeType: m.mimeType, data: m.base64 } });
  }
  if (parts.length === 0) return [];

  const res = await generateWithRetry({
    model: config.gemini.model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: extractionSystemInstruction(),
      responseMimeType: 'application/json',
      responseSchema: eventsSchema,
      temperature: 0.2,
    },
  });

  let out;
  try {
    out = JSON.parse(res.text);
  } catch (e) {
    logger.error({ raw: res.text }, 'Gagal parse JSON dari Gemini');
    return [];
  }
  return Array.isArray(out?.events) ? out.events : [];
}

function routerInstruction() {
  const { human, today, timezone } = nowContext();
  return [
    'Kamu router niat untuk bot jadwal keluarga. Klasifikasikan pesan pengguna.',
    `Sekarang: ${human} (${timezone}). Hari ini = ${today}.`,
    'Intent:',
    '- "add": pesan berisi info acara BARU untuk dicatat (ada acara+tanggal/jam), atau minta mencatat. Isi "events" (format ekstraksi acara).',
    '- "query": menanyakan jadwal/acara yang sudah ada ("jadwal Marvel bulan ini?", "acara minggu ini apa?").',
    '- "delete": minta membatalkan/menghapus acara ("hapus...", "batalin...", "cancel...").',
    '- "chat": obrolan umum / pertanyaan lain di luar jadwal (berita, rekomendasi, tanya fakta, basa-basi).',
    'Untuk query & delete, tentukan rentang tanggal dateFrom..dateTo berbasis "hari ini":',
    '  "hari ini"=hari ini; "besok"=besok..besok; "minggu ini"=Senin..Minggu minggu ini; "bulan ini"=tanggal 1..akhir bulan ini. Kalau tidak jelas, kosongkan.',
    '- WAJIB isi "person" kalau pesan menyebut nama orang (mis. "acara Marvel..." -> person="Marvel"), untuk query MAUPUN delete.',
    '- keyword: kata kunci nama acara SPESIFIK kalau ada (mis. "latihan basket", "misdinar").',
    '- JANGAN jadikan kata generik sebagai keyword (mis. "acara", "jadwal", "kegiatan", "acara keluarga") — kosongkan keyword kalau pertanyaannya umum (minta semua acara).',
    '- events hanya diisi untuk intent=add. Jangan mengarang detail yang tidak disebut.',
  ].join('\n');
}

/** Router: klasifikasi maksud pesan + parameter. */
export async function understand({ text }) {
  const res = await generateWithRetry({
    model: config.gemini.model,
    contents: text,
    config: {
      systemInstruction: routerInstruction(),
      responseMimeType: 'application/json',
      responseSchema: routeSchema,
      temperature: 0.2,
    },
  });
  try {
    return JSON.parse(res.text);
  } catch (e) {
    logger.error({ raw: res.text }, 'Gagal parse router');
    return { intent: 'chat' };
  }
}

/** Jawab pertanyaan jadwal secara natural berdasar DATA calendar (anti-ngarang). */
export async function answerQuery({ question, eventsText }) {
  const res = await generateWithRetry({
    model: config.gemini.model,
    contents:
      `Pertanyaan: ${question}\n\n` +
      `Data acara dari Google Calendar Keluarga:\n${eventsText || '(tidak ada acara pada rentang itu)'}`,
    config: {
      systemInstruction: [
        'Kamu asisten keluarga yang ramah & santai (bahasa Indonesia sehari-hari).',
        'Jawab pertanyaan jadwal HANYA berdasarkan DATA acara yang diberikan.',
        'JANGAN mengarang acara yang tidak ada di data. Kalau data kosong, bilang tidak ada acara.',
        'Jawab ringkas, natural, boleh emoji secukupnya.',
      ].join('\n'),
      temperature: 0.5,
    },
  });
  return res.text?.trim();
}

/** Obrolan umum / pertanyaan bebas; pakai Google Search buat info terkini. */
export async function chat({ text }) {
  const base = {
    model: config.gemini.model,
    contents: text,
    config: {
      systemInstruction: [
        'Kamu "Claude", asisten di grup WhatsApp keluarga. Ramah, santai, ngobrol pakai bahasa Indonesia sehari-hari.',
        'Kamu spesialis jadwal keluarga (terhubung Google Calendar), tapi boleh menjawab obrolan/pertanyaan umum juga.',
        `Lokasi keluarga: ${config.locationName}.`,
        'Jawab ringkas & natural, boleh berpendapat, emoji secukupnya. Kalau butuh info terkini, andalkan hasil pencarian.',
      ].join('\n'),
      temperature: 0.8,
    },
  };
  // Coba dengan grounding Google Search; kalau gagal, fallback tanpa search.
  try {
    const res = await generateWithRetry({
      ...base,
      config: { ...base.config, tools: [{ googleSearch: {} }] },
    });
    return res.text?.trim();
  } catch (e) {
    logger.warn(`chat grounding gagal (${e.message}), fallback tanpa search`);
    const res = await generateWithRetry(base);
    return res.text?.trim();
  }
}

/** Ambil sumber (judul+url) dari grounding metadata Gemini. */
function extractSources(res) {
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const sources = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title: c.web?.title || '', uri });
    }
  }
  return sources;
}

/** Resolve URL redirect Gemini (vertexaisearch...) jadi URL asli biar preview cakep. */
async function resolveUrl(uri) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(uri, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    clearTimeout(t);
    return res.url || uri;
  } catch {
    return uri;
  }
}

/** Resolve maksimal 4 sumber teratas (paralel) jadi link asli. */
async function resolveSources(sources) {
  const top = sources.slice(0, 4);
  const resolved = await Promise.all(
    top.map(async (s) => ({ title: s.title, uri: await resolveUrl(s.uri) }))
  );
  return resolved;
}

/**
 * Cari info terkini via Google Search grounding (dipakai agent sbagai "alat").
 * @returns {Promise<{result:string, sources:Array<{title,uri}>}>}
 */
export async function groundedSearch(query) {
  const base = {
    model: config.gemini.model,
    contents: query,
    config: {
      systemInstruction: `Jawab ringkas & faktual (bahasa Indonesia) berdasar hasil pencarian. Lokasi konteks: ${config.locationName}. Kalau info spesifik tak ketemu, bilang apa adanya.`,
      temperature: 0.4,
    },
  };
  try {
    const res = await generateWithRetry({
      ...base,
      config: { ...base.config, tools: [{ googleSearch: {} }] },
    });
    const sources = await resolveSources(extractSources(res));
    return { result: res.text?.trim() || '', sources };
  } catch (e) {
    logger.warn(`groundedSearch gagal (${e.message}), fallback tanpa search`);
    const res = await generateWithRetry(base);
    return { result: res.text?.trim() || '', sources: [] };
  }
}

/**
 * Info pagi buat digabung ke rekap: berita/kejadian sekitar + saran kuliner.
 * Format rapi (section berlabel + spasi), link kuliner pakai Places API kalau ada.
 * Best-effort — kalau gak nemu berita spesifik, kasih konten menarik umum.
 * @returns {Promise<string>}
 */
export async function morningInfo() {
  const loc = config.locationName;

  // 1) Berita/kejadian sekitar (grounded)
  const news = await groundedSearch(
    `Kasih 1-2 kalimat kabar/kejadian menarik terkini seputar ${loc} atau Bekasi (bahasa Indonesia santai). ` +
      `Kalau gak ada yang spesifik, kasih 1 fakta/tips menarik umum. JANGAN nyapa/salam, langsung isi, singkat.`
  );

  // 2) Nama tempat kuliner (grounded) — jawaban singkat biar bisa dicari di Maps
  const kul = await groundedSearch(
    `Sebutin 1 nama tempat makan/kuliner enak & spesifik di ${loc} yang ada di Google Maps. ` +
      `Jawab HANYA nama tempatnya saja (tanpa kalimat lain, tanpa tanda kutip).`
  );
  const kulinerName = (kul.result || '')
    .replace(/["*\n]/g, ' ')
    .split(/[.,;]/)[0]
    .trim()
    .slice(0, 60);

  // Link Maps: Places API (rich) kalau ada key, kalau nggak fallback search
  const place = kulinerName
    ? await searchPlace(`${kulinerName} ${loc}`)
    : null;
  const kulName = place?.name || kulinerName || 'kuliner sekitar';
  const kulUri = place?.mapsUri || mapsSearchUrl(`${kulinerName} ${loc}`);

  // Foto tempat (dikirim sbg gambar WA -> dijamin ada gambarnya, gak ngandelin preview)
  const photo = place?.photoName ? await fetchPlacePhoto(place.photoName) : null;

  const newsText =
    `📰 *Kabar sekitar:*\n${news.result || '-'}` +
    (news.sources[0]?.uri ? `\n\n🔗 ${news.sources[0].uri}` : '');
  const kulinerText =
    `🍽️ *Kuliner hari ini:*\n*${kulName}*` +
    (place?.address ? `\n${place.address}` : '') +
    `\n\n📍 ${kulUri}`;

  return { news: newsText, kuliner: { text: kulinerText, photo } };
}

/** Cek koneksi & API key valid (dipakai buat verifikasi Step 3). */
export async function ping() {
  const res = await generateWithRetry({
    model: config.gemini.model,
    contents: 'Balas satu kata: OK',
  });
  return res.text?.trim();
}
