import baileys, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Interop CJS->ESM: default export Baileys kadang di .default
const makeWASocket = baileys.default || baileys;

let sock = null;
/** Ambil socket aktif (buat kirim pesan dari cron/handler lain). */
export function getSock() {
  return sock;
}

/**
 * Mulai koneksi WhatsApp.
 * @param {object} opts
 * @param {(sock, msg)=>Promise<void>} opts.onMessage callback tiap pesan masuk
 */
export async function startWhatsApp({ onMessage, onReady } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(
    config.whatsapp.authDir
  );
  const { version } = await fetchLatestBaileysVersion();
  logger.info(`Pakai WhatsApp Web versi ${version.join('.')}`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: logger.child({ module: 'baileys' }),
    printQRInTerminal: false, // QR kita render sendiri (opsi bawaan sudah deprecated)
    syncFullHistory: false, // hemat RAM: jangan sync semua riwayat
    markOnlineOnConnect: false, // biar HP tetap bisa terima notif normal
    generateHighQualityLinkPreview: true, // thumbnail/preview link (butuh link-preview-js)
    browser: ['BotKeluarga', 'Chrome', '120.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('=== SCAN QR INI PAKAI WHATSAPP (Linked Devices) ===');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info(`✅ Tersambung ke WhatsApp sebagai ${sock.user?.id}`);
      if (onReady) {
        try {
          await onReady(sock);
        } catch (e) {
          logger.warn(e, 'onReady error');
        }
      }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      if (loggedOut) {
        logger.error(
          '❌ Session logged out. Hapus folder auth/ lalu jalankan ulang untuk scan QR baru.'
        );
      } else {
        logger.warn(`Koneksi putus (code=${code}). Reconnect dalam 3 detik...`);
        setTimeout(() => startWhatsApp({ onMessage }), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async (ev) => {
    logger.info(`[upsert] type=${ev.type} count=${ev.messages?.length || 0}`);
    // 'notify' = pesan baru real-time (bukan sync riwayat lama)
    if (ev.type !== 'notify') return;
    for (const msg of ev.messages) {
      try {
        if (onMessage) await onMessage(sock, msg);
      } catch (e) {
        logger.error(e, 'Error saat menangani pesan');
      }
    }
  });

  return sock;
}
