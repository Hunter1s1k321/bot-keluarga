import pino from 'pino';

// Logger tunggal dipakai di seluruh app (Baileys juga nerima instance ini).
// pino-pretty bikin log kebaca di terminal; aman juga di bawah PM2.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});
