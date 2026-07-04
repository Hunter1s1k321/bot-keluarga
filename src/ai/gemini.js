import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { nowContext } from '../utils/dates.js';

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

/** Panggil Gemini dengan retry buat jaringan yang suka ngedip (home wifi). */
async function generateWithRetry(params, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e) {
      lastErr = e;
      const retriable =
        /fetch failed|timeout|ECONNRESET|ETIMEDOUT|503|429|UND_ERR/i.test(
          e?.message || ''
        );
      if (!retriable || i === tries - 1) throw e;
      const wait = 1000 * (i + 1);
      logger.warn(`Gemini gagal (${e.message}), retry ${i + 1}/${tries - 1} dalam ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Skema output ekstraksi acara. Bisa banyak event (mis. dari 1 gambar jadwal).
const eventsSchema = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
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
      },
    },
  },
  required: ['events'],
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
    '- "person" = nama orang yang terlibat untuk prefix judul (mis. "Marvel"). Kalau jadwal berisi banyak nama/baris, buat satu event per baris.',
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

/** Cek koneksi & API key valid (dipakai buat verifikasi Step 3). */
export async function ping() {
  const res = await generateWithRetry({
    model: config.gemini.model,
    contents: 'Balas satu kata: OK',
  });
  return res.text?.trim();
}
