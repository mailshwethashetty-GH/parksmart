import { createDb, runMigrations, setupOrganisation } from '@parksmart/db';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { EnvError, loadEnv } from './config/env';
import { startScheduler } from './jobs/scheduler';
import { flushMonitoring, initMonitoring } from './lib/monitoring';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

async function main() {
  const env = loadEnv(process.env, repoRoot);
  const monitored = initMonitoring({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.APP_VERSION,
  });
  const db = await createDb(env.db);
  await runMigrations(db);
  const setup =
    env.SETUP_ORG_NAME && env.SETUP_SITE_NAME && env.ORG_EMAIL_DOMAIN
      ? await setupOrganisation(db, {
          orgName: env.SETUP_ORG_NAME,
          siteName: env.SETUP_SITE_NAME,
          emailDomain: env.ORG_EMAIL_DOMAIN,
          timezone: env.DEFAULT_TIMEZONE,
        })
      : { created: false };

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
  if (monitored) app.log.info('Error monitoring is on (Sentry).');
  if (setup.created)
    app.log.info({ org: env.SETUP_ORG_NAME }, 'First-run setup created the org and site.');
  if (env.ssoProvider)
    app.log.info({ provider: env.ssoProvider }, 'SSO identity provider configured.');

  const stopScheduler = startScheduler(app);

  const shutdown = async () => {
    stopScheduler();
    await app.close();
    await flushMonitoring();
    db.$client.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await app.listen({
    port: env.PORT,
    host: env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  });
}

await main().catch((err) => {
  console.error(err instanceof EnvError ? `Refusing to start: ${err.message}` : err);
  process.exit(1);
});
