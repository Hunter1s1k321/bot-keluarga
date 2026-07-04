/**
 * Ingatan percakapan jangka pendek per-chat (grup/JID).
 * Disimpan di memori (RAM) — cukup buat nyambungin follow-up.
 * Auto-expire biar hemat & gak nyampur konteks basi.
 */
const store = new Map(); // jid -> { turns:[{role,text}], ts }

const TTL_MS = 20 * 60 * 1000; // 20 menit
const MAX_TURNS = 12; // simpan 12 giliran terakhir

/** Ambil history dalam format contents Gemini (role user/model). */
export function getHistory(jid) {
  const e = store.get(jid);
  if (!e) return [];
  if (Date.now() - e.ts > TTL_MS) {
    store.delete(jid);
    return [];
  }
  return e.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

/** Tambah 1 giliran. role: 'user' | 'model'. */
export function pushTurn(jid, role, text) {
  if (!text) return;
  let e = store.get(jid);
  if (!e || Date.now() - e.ts > TTL_MS) {
    e = { turns: [], ts: Date.now() };
    store.set(jid, e);
  }
  e.turns.push({ role, text });
  if (e.turns.length > MAX_TURNS) e.turns = e.turns.slice(-MAX_TURNS);
  e.ts = Date.now();
}

/** Reset ingatan sebuah chat (buat command !reset kalau perlu). */
export function clearHistory(jid) {
  store.delete(jid);
}
