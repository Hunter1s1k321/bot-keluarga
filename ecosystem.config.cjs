// Konfigurasi PM2 buat bot keluarga.
// Jalanin: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'bot-keluarga',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true, // nyalain lagi kalau crash
      restart_delay: 5000, // jeda 5 detik sebelum restart
      max_restarts: 20, // batas restart beruntun (biar gak loop kalau error fatal)
      max_memory_restart: '450M', // restart kalau makan RAM > 450MB (laptop 4GB)
      env: {
        NODE_ENV: 'production',
      },
      // Log ke file (biar bisa dicek: pm2 logs bot-keluarga)
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
