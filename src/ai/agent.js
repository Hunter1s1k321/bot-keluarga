import { Type } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { generateWithRetry, groundedSearch } from './gemini.js';
import { searchPlaces, fetchPlacePhoto } from '../maps.js';
import {
  listEvents,
  saveExtractedEvent,
  deleteEvent,
  getEvent,
} from '../calendar/calendar.js';
import {
  nowContext,
  ymd,
  addDays,
  dayStartISO,
  dayEndISO,
  formatEventDate,
  formatTime,
} from '../utils/dates.js';
import { roster } from '../people.js';

// Daftar keluarga: "Marvel (panggilan: Vel)"
const ROSTER_TEXT = roster()
  .map((p) => `- ${p.name} (panggilan akrab: ${p.nick})`)
  .join('\n');

// Kalau '1', operasi HAPUS jadi no-op (buat testing biar gak nyentuh calendar asli).
const DRY_RUN = process.env.AGENT_DRY_RUN === '1';

function whenText(event) {
  const st = event.start || {};
  return st.dateTime ? formatEventDate(st.dateTime) : `${st.date} (seharian)`;
}

const DAY_ID = {
  MO: 'Senin', TU: 'Selasa', WE: 'Rabu', TH: 'Kamis',
  FR: 'Jumat', SA: 'Sabtu', SU: 'Minggu',
};
/** RRULE -> teks manusia, mis. "tiap Selasa/Kamis/Jumat, sampai 31/12/2026". */
function describeRecurrence(recurrence) {
  const rule = (recurrence || []).find((r) => r.startsWith('RRULE'));
  if (!rule) return 'berulang';
  const byday = rule.match(/BYDAY=([^;]+)/)?.[1];
  const until = rule.match(/UNTIL=(\d{8})/)?.[1];
  let s = byday
    ? 'tiap ' + byday.split(',').map((d) => DAY_ID[d] || d).join('/')
    : 'berulang';
  if (until) {
    s += `, sampai ${until.slice(6, 8)}/${until.slice(4, 6)}/${until.slice(0, 4)}`;
  }
  return s;
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
              person: {
                type: Type.STRING,
                description:
                  'Nama orang, pakai NAMA bukan panggilan (mis. "Marvel" bukan "Vel"). Jadi prefix judul.',
              },
              title: {
                type: Type.STRING,
                description:
                  'Nama acara SAJA, TANPA nama orang (mis. "Misdinar", "Latihan Basket"). Sistem otomatis nambahin prefix nama.',
              },
              date: { type: Type.STRING, description: 'YYYY-MM-DD (WIB).' },
              startTime: { type: Type.STRING, description: 'HH:MM, kosong kalau tak ada.' },
              endTime: { type: Type.STRING, description: 'HH:MM, kosong kalau tak ada.' },
              allDay: { type: Type.BOOLEAN, description: 'true kalau seharian.' },
              location: { type: Type.STRING, description: 'Lokasi (opsional).' },
              repeat: {
                type: Type.OBJECT,
                description:
                  'Isi HANYA kalau acara BERULANG (mis. "tiap selasa", "setiap hari"). Bikin SATU event berulang, JANGAN banyak event.',
                properties: {
                  freq: {
                    type: Type.STRING,
                    enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
                    description: 'Frekuensi ulang.',
                  },
                  days: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING,
                      enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
                    },
                    description:
                      'Hari (buat WEEKLY). senin=MO, selasa=TU, rabu=WE, kamis=TH, jumat=FR, sabtu=SA, minggu=SU.',
                  },
                  until: {
                    type: Type.STRING,
                    description: 'Tanggal berhenti YYYY-MM-DD (opsional).',
                  },
                  count: {
                    type: Type.NUMBER,
                    description: 'Jumlah kejadian (opsional, alternatif until).',
                  },
                },
              },
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
  {
    name: 'find_place',
    description:
      'Cari info tempat/kuliner/toko SPESIFIK: nama, alamat, link Maps, + FOTO tempatnya (foto otomatis dikirim ke chat). Pakai ini tiap user minta rekomendasi/nyari tempat makan/kuliner/toko/lokasi.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Nama/jenis tempat + area, mis. "bebek goreng Harapan Indah".',
        },
      },
      required: ['query'],
    },
  },
];

function agentInstruction(mode = 'direct', speaker = '') {
  const { human, today, timezone } = nowContext();
  const lines = [
    'Kamu "Claude", anggota grup WhatsApp keluarga (bukan bawahan). Ngobrol kayak temen/anggota keluarga: santai, cuek/nonchalant, apa adanya.',
    `Sekarang: ${human} (${timezone}). Hari ini = ${today}.`,
  ];
  if (speaker) {
    lines.push(
      `# SIAPA YANG LAGI NGOMONG SEKARANG: "${speaker}"`,
      `- Pesan paling baru dikirim oleh "${speaker}". Kalau mau nyapa/ngomong ke dia, panggil "${speaker}" atau "kamu". JANGAN sapa dia pakai nama anggota keluarga LAIN. Salah manggil orang itu fatal.`
    );
  }
  lines.push(
    '# Gaya bahasa (PENTING)',
    '- Super santai, informal, kayak ngetik ke temen sendiri. JANGAN lebay/kelewat semangat ("Wah, ini dia!!", "Sip banget!!"). Jangan kaku/formal.',
    '- Gaya WA: huruf kecil semua gpp, gak usah kapital di awal, gak usah titik di akhir. Panggilan orang boleh huruf kecil juga (vel, ma, pa). Singkat & to the point.',
    '- Emoji seperlunya aja, jangan tiap kalimat.',
    '- TAPI: judul acara di kalender tetap rapi & kapital wajar ("Marvel - Misdinar"), jangan huruf kecil.'
  );
  lines.push(
    '# Anggota keluarga (NAMA vs PANGGILAN — PENTING)',
    ROSTER_TEXT,
    '- Panggilan & nama = ORANG YANG SAMA (Vel=Marvel, ma=Mama, vin=Marvin, zio=Zio, pa=Papa). "Vel besok misdinar" = "Marvel besok misdinar" = acara buat Marvel.',
    '- ATURAN WAJIB (jangan ketuker!): panggilan (Vel/pa/ma/vin/zio) CUMA boleh dipakai buat MANGGIL/ngomong LANGSUNG ke lawan bicara (orang kedua). Contoh bener: "oke vin, jadwalmu udah masuk" (lagi ngomong ke Marvin).',
    '- Kalau NYEBUT orang di PERNYATAAN / orang ketiga (bukan lawan bicara) & di JUDUL ACARA & di KONFIRMASI: WAJIB pakai NAMA lengkap (Marvel/Marvin/Mama/...), DILARANG pakai panggilan. Contoh bener: "udah tak tambahin Marvin organis minggu jam 6". Contoh SALAH: "udah tak tambahin vin organis" (vin itu buat manggil, bukan buat nyebut).',
    '- Ragu? Pakai NAMA lengkap aja (lebih aman). Panggilan cuma kalau jelas lagi negur orangnya langsung.',
    '- Kalau lagi ngomong ke si pembicara & nyebut dia sendiri, boleh pakai "kamu": "di kalender kamu udah ada misdinar jam 6".',
    '# Identitas pembicara',
    '- Tiap pesan user diawali label [nama]: (mis. "[ma]: ..."), itu penanda INTERNAL siapa yang lagi ngomong (pakai panggilan). Sapa dia sesuai aturan di atas.',
    '- DILARANG KERAS menulis/mengulang label "[nama]:" di jawabanmu. Jangan echo pesan user. Langsung jawab isinya. Jangan masukin label ke judul acara.',
    '# Tugas (pakai tools)',
    '- ATURAN KERAS: JANGAN pernah bilang "udah tak tambahin/catat/hapus" kalau kamu BELUM benar-benar memanggil tool create_events/delete_events. Panggil tool-nya DULU, baru konfirmasi hasilnya. Dilarang ngaku-ngaku.',
    '- Judul acara akhirnya jadi "Nama - Acara" (mis. "Marvel - Misdinar"). Tapi di tool create_events isi TERPISAH: person="Marvel", title="Misdinar" (tanpa nama). Sistem yang gabungin. JANGAN masukin nama orang ke field title.',
    '- Pertanyaan jadwal -> panggil list_events (rentang tanggal yang pas), jawab natural. JANGAN ngarang acara.',
    '- Nambah acara (teks/gambar/PDF) -> pahami detail -> create_events. Cek dulu pakai list_events biar gak dobel.',
    '- ACARA BERULANG (mis. "les tiap selasa kamis jumat", "meeting tiap hari sampai akhir bulan"): bikin SATU event aja dengan field "repeat" (freq/days/until). JANGAN pernah bikin banyak event satu-satu (dilarang keras). Field date = tanggal kejadian PERTAMA. Contoh: les Sel/Kam/Jum sampai 31 Des 2026 -> repeat={freq:"WEEKLY", days:["TU","TH","FR"], until:"2026-12-31"}.',
    '- Hapus/batalin/"reset" acara -> list_events dulu buat dapet id. Kalau yang mau dihapus LEBIH DARI SATU (atau "semua"), KONFIRMASI dulu ("yakin hapus N acara?") tunggu user iya, baru delete_events. Kalau cuma 1 & jelas, langsung.',
    '- Acara "berulang" di list_events udah 1 baris (recurring:true). Hapus pakai id itu = hapus SELURUH seri sekaligus (jangan minta hapus tiap tanggal).',
    '- Setelah delete_events, CEK hasil "deleted". Kalau deleted=0, JANGAN bilang berhasil — bilang gagal / gak ketemu. Cuma konfirmasi "udah dihapus" kalau deleted > 0.',
    '- Butuh info terkini/berita/fakta -> panggil search_web.',
    '# Sumber & link (PENTING)',
    '- Setelah pakai search_web, SELALU cantumin link sumbernya (dari field "sources") di jawaban, biar bisa dicek. Cukup 1-3 link paling relevan.',
    '- Rekomendasi TEMPAT/KULINER/toko/lokasi: pakai find_place (otomatis kirim FOTO opsi teratas + alamat + link Maps). JANGAN kasih link /maps/search/ generik. Teks-mu singkat aja; alamat/link/foto udah otomatis.',
    '- QUERY find_place harus LUAS, jangan kelewat spesifik. Contoh BENER: "tempat makan bebek Harapan Indah". Contoh SALAH (sering 0 hasil): "bebek goreng harapan indah". Pola: "tempat makan [jenis] di [area]".',
    '- find_place balikin BEBERAPA opsi (places[], bisa 5). Pas rekomendasi, SEBUTIN 2-3 opsi sekaligus (nama + rating), JANGAN cuma 1. Contoh: "ada Bebek Setan (4.4), sama Bebek Kaleyo (4.6, paling rame)". Foto opsi teratas otomatis kekirim.',
    '- Kalau user minta "lainnya/selain X": sebutin opsi LAIN dari places[] hasil find_place SEBELUMNYA (masih ada di konteks obrolan) — JANGAN search query yang sama (hasil #1-nya bakal sama lagi). Cuma kalau butuh KATEGORI beda baru search ulang.',
    '- ANTI-NGARANG: pakai rating & review ASLI (dasarin "enak/rame" ke rating). Kalau diminta review, kutip review asli dari topReviews. Jangan bilang bingung.',
    '- Kalau bener-bener 0 hasil (found:false), coba SEKALI lagi dgn kata kunci lebih umum sebelum nyerah. Jangan buru-buru "aneh banget, cari manual".',
    '# Lain-lain',
    '- Inget konteks obrolan sebelumnya (user jawab "iya"/"semuanya" = lanjutan pertanyaanmu barusan).'
  );

  if (mode === 'proactive') {
    lines.push(
      '# MODE PROAKTIF (kamu TIDAK dipanggil langsung, cuma nyimak obrolan)',
      '- Kamu lagi ngikutin obrolan keluarga. JANGAN kepo/nyerobot.',
      '- Nimbrung HANYA kalau: (a) ada permintaan jelas soal jadwal (catat/tambah/hapus), ATAU (b) dari obrolan ada acara KONKRET (jelas siapa + apa + kapan) yang kelihatannya BELUM tercatat di kalender.',
      '- Cek dulu pakai list_events sebelum menyimpulkan sesuatu belum tercatat.',
      '- Kalau ada permintaan jelas -> lakukan (create/delete) lalu konfirmasi singkat.',
      '- Kalau cuma obrolan & acaranya belum jelas/masih wacana -> tawarin singkat ("mau tak tambahin ... ke kalender?"), jangan langsung bikin.',
      '- Kalau TIDAK ADA yang perlu ditindak (obrolan biasa aja) -> balas HANYA dengan satu kata: SKIP',
      '- Jangan pernah bikin acara halu / yang gak jelas detailnya.'
    );
  } else {
    lines.push('- Obrolan biasa -> jawab langsung tanpa tool.');
  }
  return lines.join('\n');
}

async function executeTool(name, args, attachments) {
  logger.info({ tool: name, args }, '[agent tool]');
  try {
    switch (name) {
      case 'list_events': {
        const from = args.dateFrom || ymd();
        const to = args.dateTo || addDays(ymd(), 60);
        let evs = await listEvents(dayStartISO(from), dayEndISO(to));
        evs = matchEvents(evs, args);
        // Kolaps instance recurring jadi 1 baris (biar gak banjir & gampang dihapus seri-nya)
        const seen = new Set();
        const rows = [];
        for (const e of evs) {
          const seriesId = e.recurringEventId || null;
          if (seriesId) {
            if (seen.has(seriesId)) continue; // 1 baris per seri
            seen.add(seriesId);
          }
          let when = whenText(e);
          if (seriesId) {
            // ambil master buat baca pola berulangnya (hari + tanggal akhir)
            const master = await getEvent(seriesId).catch(() => null);
            const jam = e.start?.dateTime ? ` jam ${formatTime(e.start.dateTime)}` : '';
            when = `${describeRecurrence(master?.recurrence)}${jam}`;
          }
          rows.push({
            id: seriesId || e.id, // buat hapus: seri pakai seriesId
            summary: e.summary,
            when,
            location: e.location || '',
            recurring: !!seriesId,
          });
        }
        return { events: rows };
      }
      case 'create_events': {
        if (DRY_RUN) {
          const names = (args.events || []).map(
            (e) => `${e.person ? e.person + ' - ' : ''}${e.title}`
          );
          return { created: names, count: names.length, dryRun: true };
        }
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
        const { result, sources } = await groundedSearch(args.query || '');
        return { result, sources };
      }
      case 'find_place': {
        const places = await searchPlaces(args.query || '', 5);
        if (!places.length) {
          return { found: false, note: 'gak nemu di Maps, saranin cari manual / ganti kata kunci' };
        }
        const top = places[0];
        const ratingStr = top.rating
          ? `⭐ ${top.rating} (${top.ratingCount} review)`
          : '';
        // foto opsi TERATAS aja (biar gak spam)
        if (top.photoName) {
          const photo = await fetchPlacePhoto(top.photoName);
          if (photo) {
            attachments.push({
              photo,
              caption:
                `📍 *${top.name}*` +
                (ratingStr ? ` ${ratingStr}` : '') +
                `\n${top.address}\n${top.mapsUri}`,
            });
          }
        }
        return {
          found: true,
          // beberapa opsi biar bisa kasih alternatif tanpa search ulang
          places: places.map((p) => ({
            name: p.name,
            rating: p.rating,
            ratingCount: p.ratingCount,
            address: p.address,
            mapsUri: p.mapsUri,
          })),
          topReviews: top.reviews, // review asli opsi teratas
          note: 'Foto yang dikirim = opsi teratas (places[0]).',
        };
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
export async function runAgent({ text = '', media = [], history = [], mode = 'direct', speaker = '' } = {}) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const m of media) {
    userParts.push({ inlineData: { mimeType: m.mimeType, data: m.base64 } });
  }
  if (userParts.length === 0) userParts.push({ text: '(kosong)' });

  const contents = [...history, { role: 'user', parts: userParts }];
  const toolsUsed = [];
  const attachments = []; // gambar (mis. foto tempat) yang mau dikirim ke chat

  for (let i = 0; i < 6; i++) {
    const res = await generateWithRetry({
      model: config.gemini.model,
      contents,
      config: {
        systemInstruction: agentInstruction(mode, speaker),
        tools: [{ functionDeclarations }],
        temperature: 0.5,
      },
    });

    const calls = res.functionCalls || [];
    if (calls.length === 0) {
      return { reply: res.text?.trim() || '', toolsUsed, attachments };
    }

    // simpan giliran model (yang berisi functionCall) ke konteks
    const modelContent = res.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    // eksekusi tiap tool, balikin hasilnya ke model
    const responseParts = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      const result = await executeTool(call.name, call.args || {}, attachments);
      responseParts.push({
        functionResponse: { name: call.name, response: result },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    reply: 'Hmm, kepanjangan mikirnya 😅 coba ulang perintahnya ya.',
    toolsUsed,
    attachments,
  };
}
