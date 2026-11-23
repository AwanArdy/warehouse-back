import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { checkSystemHealth } from './utils/health.js';
import { logger } from './utils/logger.js';
import { documentStorage } from './utils/storage.js';
import { latexCompilerWorker } from './workers/latex-compiler.worker.js';

async function bootstrap(): Promise<void> {
  await documentStorage.init();

  const initialHealth = await checkSystemHealth();
  logger.info({ health: initialHealth }, 'Hasil pemeriksaan awal infrastruktur');

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Warehouse Administration API berjalan pada port ${env.PORT} (${env.NODE_ENV})`);
    latexCompilerWorker.start();
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Menerima sinyal berhenti, menutup koneksi secara bersih...');
    latexCompilerWorker.stop();
    server.close(() => {
      void pool.end().then(() => {
        logger.info('Pool PostgreSQL ditutup. Proses keluar.');
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, 'Gagal menjalankan server saat bootstrap');
  process.exit(1);
});
