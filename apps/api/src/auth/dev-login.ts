/**
 * Dev-only login (non-negotiable #6). A Better Auth plugin that signs in an existing
 * seeded user by email, with no password. It is only registered when
 * `env.devLoginEnabled` is true, which `loadEnv` never allows in production.
 */
import { users, type Db } from '@parksmart/db';
import { devSignInBodySchema } from '@parksmart/shared';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { asc, eq } from 'drizzle-orm';

export const devLogin = (db: Db) =>
  ({
    id: 'parksmart-dev-login',
    endpoints: {
      devListUsers: createAuthEndpoint('/dev/users', { method: 'GET' }, async (ctx) => {
        const items = db
          .select({ email: users.email, name: users.name, role: users.role })
          .from(users)
          .where(eq(users.active, true))
          .orderBy(asc(users.role), asc(users.name))
          .all();
        return ctx.json({ items });
      }),
      devSignIn: createAuthEndpoint(
        '/dev/sign-in',
        { method: 'POST', body: devSignInBodySchema },
        async (ctx) => {
          const found = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email);
          if (!found?.user || (found.user as { active?: boolean }).active === false) {
            throw new APIError('NOT_FOUND', { message: 'No active user with that email.' });
          }
          const session = await ctx.context.internalAdapter.createSession(found.user.id);
          if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
          await setSessionCookie(ctx, { session, user: found.user });
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
