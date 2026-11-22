/**
 * Better Auth: SSO only (OIDC/SAML via the SSO plugin). Local passwords are disabled.
 * New SSO users join the org whose `email_domain` matches; unknown domains are refused.
 */
import { sso } from '@better-auth/sso';
import { schema, type Db } from '@parksmart/db';
import { AUTH_BASE } from '@parksmart/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import type { Env } from '../config/env';
import { resolveHomeForEmail } from '../services/user-onboarding';
import { devLogin } from './dev-login';

export function createAuth(db: Db, env: Env) {
  return betterAuth({
    appName: 'ParkSmart',
    baseURL: env.APP_URL,
    basePath: AUTH_BASE,
    secret: env.SESSION_SECRET,
    trustedOrigins: [env.APP_URL],
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
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const home = resolveHomeForEmail(db, user.email);
            if (!home) {
              throw new APIError('FORBIDDEN', {
                message: 'Your organisation is not set up for ParkSmart.',
              });
            }
            return { data: { ...user, ...home, role: 'employee', active: true } };
          },
        },
      },
    },
    plugins: [
      sso({
        schema: { ssoProvider: { modelName: 'ssoProviders' } },
        // Only admins may register an identity provider for their org.
        providersLimit: (user) => ((user as { role?: string }).role === 'admin' ? 5 : 0),
      }),
      ...(env.devLoginEnabled ? [devLogin(db)] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
