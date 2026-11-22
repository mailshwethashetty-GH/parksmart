import { seed, type Db } from '@parksmart/db';
import { createTestDb } from '@parksmart/db/testing';
import { API_BASE, AUTH_BASE } from '@parksmart/shared';
import type { AiClient } from './ai/client';
import { buildApp } from './app';
import { loadEnv } from './config/env';

export const TEST_ENV = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  SESSION_SECRET: 'test-session-secret-0123456789abcdefghij',
  QR_SIGNING_SECRET: 'test-qr-secret-0123456789abcdefghijklmn',
} as const;

export async function createTestApp(
  envOverrides: Record<string, string> = {},
  opts: { clock?: () => Date; ai?: AiClient | null } = {},
) {
  const db: Db = createTestDb();
  seed(db, new Date('2026-11-22T04:00:00Z'));
  const env = loadEnv({ ...TEST_ENV, ...envOverrides });
  // Tests never call the real Claude API: no client unless a fake is passed.
  const app = await buildApp({ env, db, logger: false, clock: opts.clock, ai: opts.ai ?? null });
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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Signed-in client for tests: sends the session cookie, and the CSRF token on mutations. */
export async function clientFor(app: App, email: string) {
  const session = await devSignIn(app, email);
  const { token, cookie } = await csrf(app, session);
  const call = async (method: Method, url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url: `${API_BASE}${url}`,
      headers: {
        cookie,
        ...(method === 'GET' ? {} : { 'x-csrf-token': token }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  return {
    cookie,
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    put: (url: string, payload: unknown) => call('PUT', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    delete: (url: string) => call('DELETE', url),
  };
}
