/**
 * End-to-end harness (M8). Runs the real API with:
 * - a fresh SQLite file, migrated and seeded for every run;
 * - a clock the tests set (no scheduler: tests tick jobs explicitly, so runs are
 *   deterministic and fast);
 * - a capturing mailer;
 * - the built web app (apps/web/dist) on the same origin, as in production.
 *
 * Test-only routes live here, never in apps/api, so they cannot reach a production
 * bundle: POST /__e2e/clock, POST /__e2e/tick, GET /__e2e/mail.
 */
import { createDb, runMigrations, seed } from '@parksmart/db';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app';
import { loadEnv } from '../../apps/api/src/config/env';
import { afterJobs } from '../../apps/api/src/jobs/after-jobs';
import { notificationJobs } from '../../apps/api/src/jobs/notification-jobs';
import { roundJobs } from '../../apps/api/src/jobs/round-jobs';
import type { Mailer } from '../../apps/api/src/lib/mailer';
import { webStaticPlugin } from '../../apps/api/src/plugins/web-static';
import { dispatchEmails } from '../../apps/api/src/services/notifications';
import { E2E_PORT, E2E_START } from './constants';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = resolve(repoRoot, 'e2e/.data/e2e.db');
mkdirSync(dirname(dbPath), { recursive: true });
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });

let now = new Date(E2E_START);
const db = createDb(dbPath);
runMigrations(db);
seed(db, now);

const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = {
  send: async (m) => {
    sent.push(m);
  },
};

const env = loadEnv(
  {
    NODE_ENV: 'test',
    APP_URL: `http://localhost:${E2E_PORT}`,
    DATABASE_PATH: dbPath,
    SESSION_SECRET: 'e2e-session-secret-0123456789abcdefghijklmn',
    QR_SIGNING_SECRET: 'e2e-qr-signing-secret-0123456789abcdefghij',
    DEV_LOGIN_ENABLED: 'true',
    LOG_LEVEL: 'warn',
  },
  repoRoot,
);

const app = await buildApp({ env, db, clock: () => now, ai: null, mailer });
await app.register(webStaticPlugin, { root: resolve(repoRoot, 'apps/web/dist') });

app.post<{ Body: { at: string } }>('/__e2e/clock', async (req) => {
  const at = new Date(req.body.at);
  if (Number.isNaN(at.getTime())) throw new Error('bad time');
  if (at.getTime() < now.getTime()) throw new Error('the e2e clock only moves forward');
  now = at;
  return { now: now.toISOString() };
});

/** One scheduler tick at the current clock: rounds, then notifications and email. */
app.post('/__e2e/tick', async () => {
  const events = roundJobs(db, now);
  afterJobs(app, events);
  const notices = notificationJobs(db, now);
  for (const e of notices) app.events.notifyUsers(e.userIds);
  const email = await dispatchEmails(db, mailer, now);
  return {
    rounds: events.map((e) => ({ job: e.job, detail: e.detail })),
    notices: notices.map((e) => e.job),
    email,
  };
});

app.get('/__e2e/mail', async () => ({ sent }));

await app.listen({ port: E2E_PORT, host: '127.0.0.1' });
console.log(`e2e harness on :${E2E_PORT} at ${now.toISOString()}`);
