/**
 * Vercel Function entry (ADR-016). One Fastify app per warm instance, built on the
 * first request. Migrations are not run here: `pnpm db:migrate` applies them to Turso
 * before a deploy (docs/14). The in-process scheduler does not run; /cron/tick does.
 */
import { createDb } from '@parksmart/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app';
import { EnvError, loadEnv } from './config/env';
import { initMonitoring } from './lib/monitoring';

async function start() {
  const env = loadEnv(process.env);
  initMonitoring({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const db = await createDb(env.db);
  const app = await buildApp({ env, db });
  await app.ready();
  return app;
}

let ready: ReturnType<typeof start> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= start().catch((err: unknown) => {
    ready = undefined; // retry on the next request
    throw err;
  });
  try {
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (err) {
    console.error(err instanceof EnvError ? `Refusing to start: ${err.message}` : err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'ParkSmart is not configured.', details: {} },
      }),
    );
  }
}
