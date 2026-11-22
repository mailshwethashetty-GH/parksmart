import { seed, type Db } from '@parksmart/db';
import { createTestDb } from '@parksmart/db/testing';
import { API_BASE, AUTH_BASE } from '@parksmart/shared';
import type { AiClient } from './ai/client';
import type { Email, Mailer } from './lib/mailer';
import { buildApp } from './app';
import { loadEnv } from './config/env';

export const TEST_ENV = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-0123456789abcdefghij',
  QR_SIGNING_SECRET: 'test-qr-secret-0123456789abcdefghijklmn',
} as const;

export async function createTestApp(
  envOverrides: Record<string, string> = {},
  opts: { clock?: () => Date; ai?: AiClient | null; mailer?: Mailer } = {},
) {
  const db: Db = await createTestDb();
  await seed(db, new Date('2026-11-22T04:00:00Z'));
  const env = loadEnv({ ...TEST_ENV, ...envOverrides });
  // Tests never call the real Claude API: no client unless a fake is passed.
  const sent: Email[] = [];
  const mailer: Mailer = opts.mailer ?? { send: async (e) => void sent.push(e) };
  const app = await buildApp({
    env,
    db,
    logger: false,
    clock: opts.clock,
    ai: opts.ai ?? null,
    mailer,
  });
  return { app, db, env, sent };
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
    get: async (url: string) => await call('GET', url),
    post: async (url: string, payload: unknown = {}) => await call('POST', url, payload),
    put: async (url: string, payload: unknown) => await call('PUT', url, payload),
    patch: async (url: string, payload: unknown) => await call('PATCH', url, payload),
    delete: async (url: string) => await call('DELETE', url),
  };
}

/** Array helpers for async predicates (DB lookups are async with libSQL). */
export async function filterAsync<T>(xs: readonly T[], fn: (x: T) => Promise<unknown>) {
  const keep = await Promise.all(xs.map(fn));
  return xs.filter((_, i) => keep[i]);
}
export async function findAsync<T>(xs: readonly T[], fn: (x: T) => Promise<unknown>) {
  for (const x of xs) if (await fn(x)) return x;
  return undefined;
}
export async function mapAsync<T, U>(xs: readonly T[], fn: (x: T) => Promise<U>) {
  const out: U[] = [];
  for (const x of xs) out.push(await fn(x));
  return out;
}
