import { auditLog, eq, users } from '@parksmart/db';
import { API_BASE, AUTH_BASE, CSRF_HEADER } from '@parksmart/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './config/env';
import { roleForNewUser, ssoProvidersFromEnv } from './auth/sso-config';
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

  it('rate-limits per session, not per shared office IP', async () => {
    const { app } = await setup();
    const get = async (cookie?: string) =>
      await app.inject({
        method: 'GET',
        url: `${API_BASE}/csrf-token`,
        headers: cookie ? { cookie } : {},
      });
    const a = 'parksmart.session_token=aaa.sig';
    for (let i = 0; i < 300; i++) expect((await get(a)).statusCode).toBe(200);
    expect((await get(a)).statusCode).toBe(429);
    // Someone else behind the same IP is unaffected, signed in or not.
    expect((await get('__Secure-parksmart.session_token=bbb.sig')).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
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

/** A production config needs an identity provider (ADR-014). */
const PROD_SSO = {
  NODE_ENV: 'production',
  ORG_EMAIL_DOMAIN: 'parksmart.test',
  SSO_GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  SSO_GOOGLE_CLIENT_SECRET: 'client-secret',
};

describe('dev login is disabled in production (non-negotiable #6)', () => {
  it('refuses to start with DEV_LOGIN_ENABLED=true in production', () => {
    expect(() =>
      loadEnv({ ...TEST_ENV, NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' }),
    ).toThrow(/not allowed/);
  });

  it('turns dev login off in production by default and the route does not exist', async () => {
    expect(loadEnv({ ...TEST_ENV, ...PROD_SSO }).devLoginEnabled).toBe(false);
    const { app } = await setup(PROD_SSO);
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_BASE}/dev/sign-in`,
      headers: { 'content-type': 'application/json', origin: TEST_ENV.APP_URL },
      payload: { email: 'admin@parksmart.test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('treats an empty DEV_LOGIN_ENABLED as unset (off in production)', () => {
    const env = loadEnv({ ...TEST_ENV, ...PROD_SSO, DEV_LOGIN_ENABLED: '' });
    expect(env.devLoginEnabled).toBe(false);
  });

  it('requires strong secrets', () => {
    expect(() => loadEnv({ ...TEST_ENV, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});

describe('SSO configuration (ADR-014)', () => {
  it('refuses to start in production without an identity provider', () => {
    expect(() => loadEnv({ ...TEST_ENV, NODE_ENV: 'production' })).toThrow(/identity provider/);
  });

  it('rejects partial, doubled or domain-less provider settings', () => {
    expect(() => loadEnv({ ...TEST_ENV, SSO_GOOGLE_CLIENT_ID: 'x' })).toThrow(/SECRET/);
    expect(() =>
      loadEnv({ ...TEST_ENV, SSO_ENTRA_TENANT_ID: 't', SSO_ENTRA_CLIENT_ID: 'c' }),
    ).toThrow(/ENTRA/);
    expect(() =>
      loadEnv({
        ...TEST_ENV,
        ...PROD_SSO,
        SSO_ENTRA_TENANT_ID: 't',
        SSO_ENTRA_CLIENT_ID: 'c',
        SSO_ENTRA_CLIENT_SECRET: 's',
      }),
    ).toThrow(/not both/);
    expect(() => loadEnv({ ...TEST_ENV, ...PROD_SSO, ORG_EMAIL_DOMAIN: '' })).toThrow(
      /ORG_EMAIL_DOMAIN/,
    );
  });

  it('builds the Google or Entra OIDC provider for the org domain', () => {
    expect(ssoProvidersFromEnv(loadEnv({ ...TEST_ENV, ...PROD_SSO }))).toMatchObject([
      {
        domain: 'parksmart.test',
        providerId: 'google',
        oidcConfig: { issuer: 'https://accounts.google.com', pkce: true },
      },
    ]);
    const entra = loadEnv({
      ...TEST_ENV,
      NODE_ENV: 'production',
      ORG_EMAIL_DOMAIN: 'Acme.com',
      SSO_ENTRA_TENANT_ID: 'tenant-1',
      SSO_ENTRA_CLIENT_ID: 'c',
      SSO_ENTRA_CLIENT_SECRET: 's',
    });
    expect(ssoProvidersFromEnv(entra)).toMatchObject([
      {
        domain: 'acme.com',
        providerId: 'entra',
        oidcConfig: {
          issuer: 'https://login.microsoftonline.com/tenant-1/v2.0',
          discoveryEndpoint:
            'https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration',
        },
      },
    ]);
    expect(ssoProvidersFromEnv(loadEnv(TEST_ENV))).toEqual([]);
  });

  it('makes only the listed people admins on first sign-in', () => {
    const env = loadEnv({ ...TEST_ENV, INITIAL_ADMIN_EMAILS: ' Meera@Acme.com, ops@acme.com ' });
    expect(roleForNewUser(env, 'meera@acme.com')).toBe('admin');
    expect(roleForNewUser(env, 'OPS@acme.com')).toBe('admin');
    expect(roleForNewUser(env, 'divya@acme.com')).toBe('employee');
  });

  it('first-run setup needs the org name, site name and domain together', () => {
    expect(() => loadEnv({ ...TEST_ENV, SETUP_ORG_NAME: 'Acme' })).toThrow(/First-run setup/);
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
    expect(await resolveHomeForEmail(db, 'new.person@PARKSMART.test')).toMatchObject({
      orgId: expect.any(String),
      siteId: expect.any(String),
    });
    expect(await resolveHomeForEmail(db, 'someone@gmail.com')).toBeNull();
  });

  it('writeAudit appends an entry with actor, time and reason', async () => {
    const { db } = await setup();
    const at = new Date('2026-11-22T05:00:00Z');
    await writeAudit(
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
    const row = await db.select().from(auditLog).where(eq(auditLog.action, 'policy.publish')).get();
    expect(row).toMatchObject({ actorId: 'u1', reason: 'test', at });
  });
});

describe('Vercel + Turso hosting (ADR-016)', () => {
  const CRON_SECRET = 'cron-secret-0123456789abcdefghijklmnopq';
  const VERCEL = { VERCEL: '1', CRON_SECRET, DATABASE_URL: 'libsql://parksmart-test.turso.io' };

  it('needs Turso and a cron secret on Vercel', () => {
    expect(() => loadEnv({ ...TEST_ENV, VERCEL: '1', CRON_SECRET })).toThrow(/DATABASE_URL/);
    expect(() =>
      loadEnv({ ...TEST_ENV, VERCEL: '1', DATABASE_URL: 'libsql://x.turso.io' }),
    ).toThrow(/CRON_SECRET/);
    const env = loadEnv({ ...TEST_ENV, ...VERCEL, DATABASE_AUTH_TOKEN: 'tok' });
    expect(env).toMatchObject({
      serverless: true,
      db: { url: 'libsql://parksmart-test.turso.io', authToken: 'tok' },
    });
    expect(loadEnv(TEST_ENV).db.url).toMatch(/^file:\/.*parksmart\.db$/);
  });

  it('runs scheduled jobs on /cron/tick only with the secret', async () => {
    const { app } = await setup(VERCEL);
    const tick = (authorization?: string) =>
      app.inject({
        method: 'GET',
        url: `${API_BASE}/cron/tick`,
        headers: authorization ? { authorization } : {},
      });
    expect((await tick()).statusCode).toBe(401);
    expect((await tick('Bearer wrong')).statusCode).toBe(401);
    const ok = await tick(`Bearer ${CRON_SECRET}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      rounds: { ok: true },
      notifications: { ok: true },
      recurring: { ok: true },
    });
  });

  it('has no tick endpoint without a cron secret', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `${API_BASE}/cron/tick` });
    expect(res.statusCode).toBe(404);
  });

  it('answers the live stream with 204 on Vercel (the app polls instead)', async () => {
    const { app } = await setup(VERCEL);
    const cookie = await devSignIn(app, 'divya@parksmart.test');
    const res = await app.inject({
      method: 'GET',
      url: `${API_BASE}/stream/me`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('prototype demo mode and sign-in options (ADR-017)', () => {
  const DEMO = { NODE_ENV: 'production', DEMO_MODE: 'true' };

  it('reports the sign-in methods for the login screen', async () => {
    const dev = await setup();
    expect(
      (await dev.app.inject({ method: 'GET', url: `${API_BASE}/login-options` })).json(),
    ).toEqual({ sso: null, samplePeople: 'dev' });
    await dev.app.close();
    const { app } = await setup({ ...PROD_SSO, DEMO_MODE: 'true' });
    expect((await app.inject({ method: 'GET', url: `${API_BASE}/login-options` })).json()).toEqual({
      sso: 'google',
      samplePeople: 'demo',
    });
  });

  it('lets demo mode start in production without SSO, but never dev login', () => {
    expect(loadEnv({ ...TEST_ENV, ...DEMO })).toMatchObject({
      demoMode: true,
      devLoginEnabled: false,
    });
    expect(() => loadEnv({ ...TEST_ENV, ...DEMO, DEV_LOGIN_ENABLED: 'true' })).toThrow(
      /not allowed/,
    );
  });

  it('demo sign-in only opens sample people, never a real account', async () => {
    const { app, db } = await setup(DEMO);
    await db
      .update(users)
      .set({ email: 'real.person@gmail.com' })
      .where(eq(users.email, 'farhan@parksmart.test'))
      .run();
    const list = await app.inject({ method: 'GET', url: `${AUTH_BASE}/dev/users` });
    const emails: string[] = list.json().items.map((u: { email: string }) => u.email);
    expect(emails.length).toBeGreaterThan(5);
    expect(emails.every((e) => e.endsWith('@parksmart.test'))).toBe(true);
    await expect(devSignIn(app, 'real.person@gmail.com')).rejects.toThrow(/404/);
    expect(await devSignIn(app, 'admin@parksmart.test')).toMatch(/session_token/);
  });

  it('lets ALLOWED_EMAILS in from any domain; other domains stay out', async () => {
    const { db } = await setup();
    const allowed = ['reviewer@gmail.com'];
    expect(await resolveHomeForEmail(db, 'Reviewer@gmail.com', allowed)).toMatchObject({
      orgId: expect.any(String),
      siteId: expect.any(String),
    });
    expect(await resolveHomeForEmail(db, 'someone@gmail.com', allowed)).toBeNull();
  });
});
