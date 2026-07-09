import http from 'node:http';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSock } from '../whatsapp/client.js';
import { usdIdrRate } from './fx.js';
import { applyMentions } from '../whatsapp/tagging.js';
import {
  buildOpened,
  buildStopLoss,
  buildTakeProfit,
  buildDailySummary,
  buildIntro,
} from './format.js';

const GROUP = config.whatsapp.familyGroupJid;
const MAX_BODY = 1_000_000; // 1 MB guard

/** Kirim teks ke grup keluarga. mention=true buat nge-tag nama (mis. owner). */
async function sendGroup(text, { mention = false } = {}) {
  const sock = getSock();
  if (!sock) throw new Error('WhatsApp belum tersambung');
  if (mention) {
    const { text: t, mentions } = applyMentions(text);
    await sock.sendMessage(GROUP, { text: t, mentions });
  } else {
    await sock.sendMessage(GROUP, { text });
  }
}

/** Rakit pesan dari payload webhook. Return null kalau type gak dikenal. */
async function buildMessage(body) {
  const rate = await usdIdrRate();
  switch (body.type) {
    case 'opened':
      return { text: buildOpened(body, rate) };
    case 'stop_loss':
      return { text: buildStopLoss(body, rate) };
    case 'take_profit':
      return { text: buildTakeProfit(body, rate) };
    case 'daily_summary':
      return { text: buildDailySummary(body, rate) };
    case 'intro':
      return { text: buildIntro(config.trading.owner), mention: true };
    default:
      return null;
  }
}

/**
 * Nyalain webhook lokal buat nerima notif dari bot trading kripto.
 * POST http://127.0.0.1:<port>/trade  (header: Authorization: Bearer <token>)
 * Body JSON: { type: 'opened'|'stop_loss'|'take_profit'|'daily_summary'|'intro', ... }
 *
 * Kalau TRADING_WEBHOOK_TOKEN kosong -> webhook OFF (fitur trading nonaktif).
 * Bind 127.0.0.1 aja: ini endpoint finansial, jangan kebuka ke jaringan.
 */
export function startTradingWebhook() {
  const { webhookToken, webhookPort } = config.trading;
  if (!webhookToken) {
    logger.warn(
      '[trading] TRADING_WEBHOOK_TOKEN kosong -> webhook trading OFF (fitur notif trading nonaktif)'
    );
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/trade') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'not found' }));
    }
    if ((req.headers['authorization'] || '') !== `Bearer ${webhookToken}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    }

    let raw = '';
    let aborted = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        aborted = true;
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'payload kegedean' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(raw || '{}');
        const msg = await buildMessage(body);
        if (!msg) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({ ok: false, error: `type '${body.type}' gak dikenal` })
          );
        }
        await sendGroup(msg.text, { mention: msg.mention });
        logger.info(`[trading] notif '${body.type}' terkirim ke grup`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        logger.error(e, '[trading] gagal proses webhook');
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
  });

  server.on('error', (e) => logger.error(e, '[trading] webhook server error'));
  server.listen(webhookPort, '127.0.0.1', () => {
    logger.info(
      `💹 Webhook trading aktif di http://127.0.0.1:${webhookPort}/trade`
    );
  });
  return server;
}
