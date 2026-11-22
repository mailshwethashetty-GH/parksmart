/**
 * Better Auth: SSO only (OIDC/SAML via the SSO plugin). Local passwords are disabled.
 * New SSO users join the org whose `email_domain` matches; unknown domains are refused.
 */
import { sso } from '@better-auth/sso';
import { schema, SEED_EMAIL_DOMAIN, type Db } from '@parksmart/db';
import { AUTH_BASE } from '@parksmart/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import type { Env } from '../config/env';
import { resolveHomeForEmail } from '../services/user-onboarding';
import { devLogin } from './dev-login';
import { idpOrigins, roleForNewUser, ssoProvidersFromEnv } from './sso-config';

export function createAuth(db: Db, env: Env) {
  return betterAuth({
    appName: 'ParkSmart',
    baseURL: env.APP_URL,
    basePath: AUTH_BASE,
    secret: env.SESSION_SECRET,
    trustedOrigins: [env.APP_URL, ...idpOrigins(env)],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        ssoProviders: schema.ssoProviders,
      },
    }),
    emailAndPassword: { enabled: false },
    user: {
      modelName: 'users',
      additionalFields: {
        orgId: { type: 'string', required: true, input: false },
        siteId: { type: 'string', required: true, input: false },
        role: { type: 'string', required: false, defaultValue: 'employee', input: false },
        active: { type: 'boolean', required: false, defaultValue: true, input: false },
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications' },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      cookiePrefix: 'parksmart',
      // Production runs behind Caddy, which sets X-Forwarded-For (and drops it from
      // untrusted clients), so Better Auth's sign-in rate limit sees real client IPs.
      ...(env.NODE_ENV === 'production'
        ? { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } }
        : {}),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const home = await resolveHomeForEmail(db, user.email, env.allowedEmails);
            if (!home) {
              throw new APIError('FORBIDDEN', {
                message: 'Your organisation is not set up for ParkSmart.',
              });
            }
            const role = roleForNewUser(env, user.email);
            return { data: { ...user, ...home, role, active: true } };
          },
        },
      },
    },
    plugins: [
      sso({
        schema: { ssoProvider: { modelName: 'ssoProviders' } },
        defaultSSO: ssoProvidersFromEnv(env),
        // Only admins may register an identity provider for their org.
        providersLimit: (user) => ((user as { role?: string }).role === 'admin' ? 5 : 0),
      }),
      ...(env.devLoginEnabled
        ? [devLogin(db)]
        : env.demoMode
          ? [devLogin(db, { onlyDomain: SEED_EMAIL_DOMAIN })]
          : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
