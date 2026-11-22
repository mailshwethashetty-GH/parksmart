import { auditLog, eq } from '@parksmart/db';
import { API_BASE, AUTH_BASE, CSRF_HEADER } from '@parksmart/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './config/env';
import { requireRole } from './plugins/auth';
import { writeAudit } from './services/audit';
import { resolveHomeForEmail } from './services/user-onboarding';
import { createTestApp, csrf, devSignIn, TEST_ENV } from './test-utils';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function setup(env: Record<string, string> = {}) {
  ctx = await createTestApp(env);
  // Test-only routes to exercise role guards and CSRF.
  ctx.app.get(`${API_BASE}/__test/admin`, { preHandler: requireRole('admin') }, async () => ({
    ok: true,
  }));
  ctx.app.post(`${API_BASE}/__test/echo`, { preHandler: requireRole() }, async () => ({
    ok: true,
  }));
  return ctx;
}

describe('system', () => {
  it('GET /health reports ok', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('unknown API routes return the standard error body', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `${API_BASE}/nope` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: {} },
    });
  });
});

describe('auth and roles (FR-29)', () => {
  it('GET /me needs a session', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `${API_BASE}/me` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('dev login signs in a seeded user and /me returns their site', async () => {
    const { app } = await setup();
    const cookie = await devSignIn(app, 'admin@parksmart.test');
    const res = await app.inject({ method: 'GET', url: `${API_BASE}/me`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      email: 'admin@parksmart.test',
      role: 'admin',
      site: { name: 'Bengaluru HQ', timezone: 'Asia/Kolkata' },
    });
  });

  it('dev login lists seeded users for every role', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `${AUTH_BASE}/dev/users` });
    const roles = new Set(res.json().items.map((u: { role: string }) => u.role));
    expect(roles).toEqual(new Set(['admin', 'security', 'employee']));
  });

  it('dev login rejects unknown emails', async () => {
    const { app } = await setup();
    await expect(devSignIn(app, 'nobody@parksmart.test')).rejects.toThrow(/404/);
  });

  it('role guard: employee gets 403 on an admin route, admin gets 200', async () => {
    const { app } = await setup();
    const employee = await devSignIn(app, 'divya@parksmart.test');
    const admin = await devSignIn(app, 'admin@parksmart.test');
    const url = `${API_BASE}/__test/admin`;
    const denied = await app.inject({ method: 'GET', url, headers: { cookie: employee } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');
    const allowed = await app.inject({ method: 'GET', url, headers: { cookie: admin } });
    expect(allowed.statusCode).toBe(200);
  });

  it('sign-out ends the session', async () => {
    const { app } = await setup();
    const cookie = await devSignIn(app, 'divya@parksmart.test');
    await app.inject({
      method: 'POST',
      url: `${AUTH_BASE}/sign-out`,
      headers: { cookie, origin: TEST_ENV.APP_URL, 'content-type': 'application/json' },
      payload: {},
    });
    const res = await app.inject({ method: 'GET', url: `${API_BASE}/me`, headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe('dev login is disabled in production (non-negotiable #6)', () => {
  it('refuses to start with DEV_LOGIN_ENABLED=true in production', () => {
    expect(() =>
      loadEnv({ ...TEST_ENV, NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' }),
    ).toThrow(/not allowed/);
  });

  it('turns dev login off in production by default and the route does not exist', async () => {
    expect(loadEnv({ ...TEST_ENV, NODE_ENV: 'production' }).devLoginEnabled).toBe(false);
    const { app } = await setup({ NODE_ENV: 'production' });
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_BASE}/dev/sign-in`,
      headers: { 'content-type': 'application/json', origin: TEST_ENV.APP_URL },
      payload: { email: 'admin@parksmart.test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('treats an empty DEV_LOGIN_ENABLED as unset (off in production)', () => {
    const env = loadEnv({ ...TEST_ENV, NODE_ENV: 'production', DEV_LOGIN_ENABLED: '' });
    expect(env.devLoginEnabled).toBe(false);
  });

  it('requires strong secrets', () => {
    expect(() => loadEnv({ ...TEST_ENV, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});

describe('CSRF on mutating API routes', () => {
  it('rejects a POST without the CSRF header', async () => {
    const { app } = await setup();
    const cookie = await devSignIn(app, 'divya@parksmart.test');
    const res = await app.inject({
      method: 'POST',
      url: `${API_BASE}/__test/echo`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_INVALID');
  });

  it('accepts a POST with a valid CSRF token', async () => {
    const { app } = await setup();
    const session = await devSignIn(app, 'divya@parksmart.test');
    const { token, cookie } = await csrf(app, session);
    const res = await app.inject({
      method: 'POST',
      url: `${API_BASE}/__test/echo`,
      headers: { cookie, [CSRF_HEADER]: token },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('services', () => {
  it('new SSO users join the org matching their email domain; unknown domains are refused', async () => {
    const { db } = await setup();
    expect(resolveHomeForEmail(db, 'new.person@PARKSMART.test')).toMatchObject({
      orgId: expect.any(String),
      siteId: expect.any(String),
    });
    expect(resolveHomeForEmail(db, 'someone@gmail.com')).toBeNull();
  });

  it('writeAudit appends an entry with actor, time and reason', async () => {
    const { db } = await setup();
    const at = new Date('2026-11-22T05:00:00Z');
    writeAudit(
      db,
      {
        siteId: null,
        actorId: 'u1',
        action: 'policy.publish',
        entity: 'policy_version',
        entityId: 'pv1',
        reason: 'test',
      },
      at,
    );
    const row = db.select().from(auditLog).where(eq(auditLog.action, 'policy.publish')).get();
    expect(row).toMatchObject({ actorId: 'u1', reason: 'test', at });
  });
});
