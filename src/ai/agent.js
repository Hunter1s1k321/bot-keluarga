import { Type } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { generateWithRetry, groundedSearch } from './gemini.js';
import {
  listEvents,
  saveExtractedEvent,
  deleteEvent,
} from '../calendar/calendar.js';
import {
  nowContext,
  ymd,
  addDays,
  dayStartISO,
  dayEndISO,
  formatEventDate,
} from '../utils/dates.js';

// Kalau '1', operasi HAPUS jadi no-op (buat testing biar gak nyentuh calendar asli).
const DRY_RUN = process.env.AGENT_DRY_RUN === '1';

function whenText(event) {
  const st = event.start || {};
  return st.dateTime ? formatEventDate(st.dateTime) : `${st.date} (seharian)`;
}

function matchEvents(events, { person, keyword }) {
  return events.filter((e) => {
    const s = (e.summary || '').toLowerCase();
    if (person && !s.includes(person.toLowerCase())) return false;
    if (keyword && !s.includes(keyword.toLowerCase())) return false;
    return true;
  });
}

// ---- deklarasi "alat" yang bisa dipanggil Gemini ----
const functionDeclarations = [
  {
    name: 'list_events',
    description:
      'Ambil daftar acara dari Google Calendar keluarga pada rentang tanggal. WAJIB dipanggil sebelum menjawab pertanyaan jadwal atau sebelum menghapus (buat dapat eventId).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dateFrom: { type: Type.STRING, description: 'Tanggal mulai YYYY-MM-DD (WIB).' },
        dateTo: { type: Type.STRING, description: 'Tanggal akhir YYYY-MM-DD (WIB).' },
        person: { type: Type.STRING, description: 'Filter nama orang (opsional).' },
        keyword: { type: Type.STRING, description: 'Filter kata kunci nama acara (opsional).' },
      },
      required: ['dateFrom', 'dateTo'],
    },
  },
  {
    name: 'create_events',
    description:
      'Simpan satu atau lebih acara BARU ke Calendar. Untuk info dari teks maupun gambar/PDF jadwal.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        events: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              person: { type: Type.STRING, description: 'Nama orang (buat prefix judul).' },
              title: { type: Type.STRING, description: 'Nama acara.' },
              date: { type: Type.STRING, description: 'YYYY-MM-DD (WIB).' },
              startTime: { type: Type.STRING, description: 'HH:MM, kosong kalau tak ada.' },
              endTime: { type: Type.STRING, description: 'HH:MM, kosong kalau tak ada.' },
              allDay: { type: Type.BOOLEAN, description: 'true kalau seharian.' },
              location: { type: Type.STRING, description: 'Lokasi (opsional).' },
            },
            required: ['title', 'date', 'allDay'],
          },
        },
      },
      required: ['events'],
    },
  },
  {
    name: 'delete_events',
    description:
      'Hapus acara berdasarkan daftar eventId (dapatkan dari list_events). Untuk "hapus semua", list dulu lalu kirim semua id. Konfirmasi dulu ke user sebelum hapus banyak.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Daftar eventId yang mau dihapus.',
        },
      },
      required: ['eventIds'],
    },
  },
  {
    name: 'search_web',
    description:
      'Cari informasi terkini di internet (berita, kejadian, harga, fakta terbaru). Pakai kalau butuh info yang kamu tidak tahu / yang up-to-date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Kata kunci pencarian.' },
      },
      required: ['query'],
    },
  },
];

function agentInstruction() {
  const { human, today, timezone } = nowContext();
  return [
    'Kamu "Claude", asisten cerdas di grup WhatsApp keluarga. Ngobrol santai & natural pakai bahasa Indonesia sehari-hari, gak kaku, gak template-an. Punya kepribadian hangat, boleh berpendapat & bercanda tipis.',
    'Spesialisasimu: kelola jadwal keluarga di Google Calendar (kalender "Keluarga"). Tapi kamu juga bisa ngobrol/jawab pertanyaan umum kayak AI asisten biasa.',
    `Sekarang: ${human} (${timezone}). Hari ini = ${today}.`,
    'Cara kerja (pakai alat/tools yang tersedia):',
    '- Judul acara SELALU pakai prefix nama orang: "Marvel - Misdinar".',
    '- Pertanyaan jadwal ("acara Marvel minggu ini?") -> panggil list_events dgn rentang tanggal yang tepat, lalu jawab natural. JANGAN mengarang acara.',
    '- Menambah acara (teks / gambar / PDF jadwal) -> pahami detailnya lalu panggil create_events.',
    '- Menghapus/membatalkan/"reset" acara -> panggil list_events dulu buat dapat id yang cocok. Kalau yang mau dihapus LEBIH DARI SATU (atau "semua"), TANYA KONFIRMASI dulu ("Yakin hapus N acara ini?") dan tunggu user bilang iya, BARU panggil delete_events. Kalau cuma 1 dan jelas, boleh langsung.',
    '- Butuh info terkini/berita -> panggil search_web.',
    '- Obrolan biasa / pertanyaan umum -> jawab langsung tanpa alat.',
    'Ingat konteks percakapan sebelumnya (mis. user jawab "iya"/"semuanya" itu lanjutan pertanyaanmu barusan).',
    'Jawaban ringkas, hangat, jelas. Setelah melakukan aksi, konfirmasikan hasilnya dengan enak dibaca (boleh emoji secukupnya).',
  ].join('\n');
}

async function executeTool(name, args) {
  logger.info({ tool: name, args }, '[agent tool]');
  try {
    switch (name) {
      case 'list_events': {
        const from = args.dateFrom || ymd();
        const to = args.dateTo || addDays(ymd(), 60);
        let evs = await listEvents(dayStartISO(from), dayEndISO(to));
        evs = matchEvents(evs, args);
        return {
          events: evs.map((e) => ({
            id: e.id,
            summary: e.summary,
            when: whenText(e),
            location: e.location || '',
          })),
        };
      }
      case 'create_events': {
        const saved = [];
        for (const ev of args.events || []) {
          try {
            saved.push((await saveExtractedEvent(ev)).summary);
          } catch (err) {
            logger.error(err, 'create_events gagal 1 item');
          }
        }
        return { created: saved, count: saved.length };
      }
      case 'delete_events': {
        const ids = args.eventIds || [];
        if (DRY_RUN) return { deleted: ids.length, dryRun: true };
        let n = 0;
        for (const id of ids) {
          try {
            await deleteEvent(id);
            n++;
          } catch (err) {
            logger.error(err, `delete gagal id=${id}`);
          }
        }
        return { deleted: n };
      }
      case 'search_web': {
        const result = await groundedSearch(args.query || '');
        return { result };
      }
      default:
        return { error: `tool tidak dikenal: ${name}` };
    }
  } catch (e) {
    logger.error(e, `executeTool ${name} error`);
    return { error: e.message };
  }
}

/**
 * Jalankan agent: mikir + pakai alat + jawab natural.
 * @param {object} p
 * @param {string} [p.text]
 * @param {Array<{mimeType,base64}>} [p.media]
 * @param {Array} [p.history] contents Gemini (dari conversation.js)
 * @returns {Promise<{reply:string, toolsUsed:string[]}>}
 */
export async function runAgent({ text = '', media = [], history = [] } = {}) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const m of media) {
    userParts.push({ inlineData: { mimeType: m.mimeType, data: m.base64 } });
  }
  if (userParts.length === 0) userParts.push({ text: '(kosong)' });

  const contents = [...history, { role: 'user', parts: userParts }];
  const toolsUsed = [];

  for (let i = 0; i < 6; i++) {
    const res = await generateWithRetry({
      model: config.gemini.model,
      contents,
      config: {
        systemInstruction: agentInstruction(),
        tools: [{ functionDeclarations }],
        temperature: 0.6,
      },
    });

    const calls = res.functionCalls || [];
    if (calls.length === 0) {
      return { reply: res.text?.trim() || '', toolsUsed };
    }

    // simpan giliran model (yang berisi functionCall) ke konteks
    const modelContent = res.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    // eksekusi tiap tool, balikin hasilnya ke model
    const responseParts = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      const result = await executeTool(call.name, call.args || {});
      responseParts.push({
        functionResponse: { name: call.name, response: result },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    reply: 'Hmm, kepanjangan mikirnya 😅 coba ulang perintahnya ya.',
    toolsUsed,
  };
}
