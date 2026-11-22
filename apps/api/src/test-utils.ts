import { seed, type Db } from '@parksmart/db';
import { createTestDb } from '@parksmart/db/testing';
import { API_BASE, AUTH_BASE } from '@parksmart/shared';
import { buildApp } from './app';
import { loadEnv } from './config/env';

export const TEST_ENV = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  SESSION_SECRET: 'test-session-secret-0123456789abcdefghij',
  QR_SIGNING_SECRET: 'test-qr-secret-0123456789abcdefghijklmn',
} as const;

export async function createTestApp(envOverrides: Record<string, string> = {}) {
  const db: Db = createTestDb();
  seed(db, new Date('2026-11-22T04:00:00Z'));
  const env = loadEnv({ ...TEST_ENV, ...envOverrides });
  const app = await buildApp({ env, db, logger: false });
  return { app, db, env };
}

type App = Awaited<ReturnType<typeof createTestApp>>['app'];

/** Cookie header from a response's set-cookie values (name=value pairs only). */
export function cookieHeader(setCookie: string | string[] | undefined, existing = ''): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const pairs = new Map(
    existing
      .split('; ')
      .filter(Boolean)
      .map((p) => [p.split('=')[0]!, p] as const),
  );
  for (const c of list) {
    const pair = c.split(';')[0]!;
    pairs.set(pair.split('=')[0]!, pair);
  }
  return [...pairs.values()].join('; ');
}

export async function devSignIn(app: App, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `${AUTH_BASE}/dev/sign-in`,
    headers: { 'content-type': 'application/json', origin: TEST_ENV.APP_URL },
    payload: { email },
  });
  if (res.statusCode !== 200) throw new Error(`dev sign-in failed: ${res.statusCode} ${res.body}`);
  return cookieHeader(res.headers['set-cookie']);
}

export async function csrf(app: App, cookie: string): Promise<{ token: string; cookie: string }> {
  const res = await app.inject({
    method: 'GET',
    url: `${API_BASE}/csrf-token`,
    headers: { cookie },
  });
  return { token: res.json().token, cookie: cookieHeader(res.headers['set-cookie'], cookie) };
}
