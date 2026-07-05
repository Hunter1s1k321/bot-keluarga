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
  const loc = config.locationName;
  const lines = [
    'Kamu "Claude", anggota grup WhatsApp keluarga sekaligus asisten AI cerdas yang punya inisiatif & naluri sendiri. Ngobrol natural kayak temen, riset beneran, bantuin apa aja. BUKAN bot kaku yang cuma nunggu perintah — mikir & bertindak kayak AI pinter pada umumnya.',
    `Keluarga ini TINGGAL DI ${loc}. Jadi "di sini" / "deket sini" / "sekitar sini" = ${loc}. Inget ini terus.`,
    `Sekarang: ${human} (${timezone}). Hari ini = ${today}.`,
  ];
  if (speaker) {
    lines.push(
      `Yang lagi ngomong sekarang: "${speaker}". Sapa dia "${speaker}" atau "kamu" — jangan salah sapa pakai nama anggota lain.`
    );
  }
  lines.push(
    '',
    '# Gaya',
    '- Santai, informal, kayak temen sendiri. Huruf kecil ala WA oke, gak usah kaku/formal/lebay. Boleh punya pendapat, selera, & humor. Emoji secukupnya.',
    `- Anggota keluarga: ${roster().map((p) => `${p.name} (panggil: ${p.nick})`).join(', ')}. Panggilan (vel/ma/pa/vin/zio) CUMA buat nyapa orangnya langsung (orang kedua). Kalau NYEBUT orang (orang ketiga) atau di JUDUL ACARA, pakai NAMA lengkap (Marvel/Marvin/...). Ragu -> pakai nama. Jangan echo label "[nama]:" di jawaban.`,
    '',
    '# Riset & info — JANGAN MALES / JANGAN NGARANG',
    '- ATURAN PALING PENTING: DILARANG KERAS bilang "bentar ya", "aku cek dulu", "lagi nyari", "tunggu ya" terus berhenti tanpa hasil. Kalau butuh nyari/cek, LANGSUNG panggil tool-nya (search_web/find_place/list_events) DI GILIRAN INI JUGA, terus kasih hasilnya di jawaban yang sama. Jawabanmu harus SELALU udah berisi hasil, bukan janji mau ngerjain.',
    '- Kamu punya search_web = pencarian internet beneran (riset dalam, kayak Gemini yang ngerti). Buat pertanyaan apapun yang butuh fakta/info terkini (berita, "gimana caranya", harga, fakta, penjelasan, "yang mana yang X", dll) -> PAKAI search_web SEKARANG. Sertakan 1-2 link sumber kalau relevan.',
    '- HEMAT & CEPAT: usahain CUKUP 1x search_web yang LUAS (mis. "sushi all you can eat harapan indah"), JANGAN search berkali-kali buat tiap item satu-satu (itu lambat). Cari ulang cuma kalau hasil pertama beneran kosong/kurang.',
    '',
    '# Cari tempat / kuliner',
    `- Pakai find_place buat cari tempat makan/toko/lokasi (dapet foto + rating + review ASLI). Query NETRAL & simpel: "tempat makan sushi ${loc}" — BUANG kata subjektif ("terenak","paling enak"). find_place balikin beberapa opsi; sebutin 2-3 (nama+rating); alternatif ambil dari list itu (jangan search sama persis lagi).`,
    '- Kalau find_place kosong -> PAKAI search_web buat riset tempatnya. JANGAN langsung nyerah "gak nemu, aneh banget".',
    '- PENTING: di TEKS-mu JANGAN nulis link Maps atau alamat — itu udah OTOMATIS dikirim di caption foto. Teks-mu ngobrol aja. Nulis link di teks = preview jelek + dobel.',
    '- Dasarin "enak/rame/oke" ke rating & review ASLI, jangan ngarang. Diminta review -> kutip review asli.',
    '- Kasih opsi tetep gaya NGOBROL santai (mis. "ada sushigan ratingnya 5.0 gila, sama sushi yay juga oke"). JANGAN format list bernomor + bold yang kaku/formal.',
    '',
    '# Jadwal (Google Calendar)',
    '- Nanya jadwal -> list_events. Nambah -> create_events (isi person & title TERPISAH; title TANPA nama orang; sistem gabungin jadi "Nama - Acara"). Hapus -> list_events dulu (acara berulang = 1 baris recurring, hapus pakai id itu = hapus seluruh seri).',
    '- ANTI-DOBEL (PENTING): sebelum create_events, list_events dulu cek acara serupa (orang+judul+tanggal) udah ada belum. Kalau UDAH ADA (mis. versi seharian) terus user kasih jam, JANGAN bikin baru — bilang udah ada / tawarin betulin jamnya. Jangan sampe dobel (seharian + berjam).',
    '- Kalau acara penting jamnya (misdinar/jemput/janji) tapi user gak nyebut jam -> TANYA jamnya dulu, jangan asal "seharian".',
    '- Acara berulang -> SATU event pakai field repeat (freq/days/until), bukan banyak event.',
    '- JANGAN ngaku udah nambah/hapus kalau belum manggil tool. Abis delete, cek "deleted">0 baru bilang berhasil.',
    '',
    '- Inget obrolan sebelumnya (user jawab "iya"/"lainnya" = lanjutan pertanyaanmu barusan).'
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
