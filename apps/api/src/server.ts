import { createDb, runMigrations } from '@parksmart/db';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { EnvError, loadEnv } from './config/env';
import { startScheduler } from './jobs/scheduler';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

async function main() {
  const env = loadEnv(process.env, repoRoot);
  const db = createDb(env.DATABASE_PATH);
  runMigrations(db);

  const app = await buildApp({
    env,
    db,
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL ?? 'info', transport: { target: 'pino-pretty' } }
        : undefined,
    webRoot: resolve(repoRoot, 'apps/web/dist'),
  });
  if (env.devLoginEnabled) app.log.warn('Dev-only login is ENABLED. Never use in production.');

  const stopScheduler = startScheduler(app);

  const shutdown = async () => {
    stopScheduler();
    await app.close();
    db.$client.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({
    port: env.PORT,
    host: env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  });
}

main().catch((err) => {
  console.error(err instanceof EnvError ? `Refusing to start: ${err.message}` : err);
  process.exit(1);
});
