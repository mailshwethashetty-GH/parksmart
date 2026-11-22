/**
 * Dev-only login (non-negotiable #6). A Better Auth plugin that signs in an existing
 * seeded user by email, with no password. It is only registered when
 * `env.devLoginEnabled` is true, which `loadEnv` never allows in production, or in
 * prototype demo mode (ADR-017), where it is limited to the sample people
 * (`onlyDomain`, the seed domain) so it can never open a real person's account.
 */
import { and, asc, type Db, eq, like, users } from '@parksmart/db';
import { devSignInBodySchema } from '@parksmart/shared';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

export const devLogin = (db: Db, opts: { onlyDomain?: string } = {}) =>
  ({
    id: 'parksmart-dev-login',
    endpoints: {
      devListUsers: createAuthEndpoint('/dev/users', { method: 'GET' }, async (ctx) => {
        const items = await db
          .select({ email: users.email, name: users.name, role: users.role })
          .from(users)
          .where(
            and(
              eq(users.active, true),
              opts.onlyDomain ? like(users.email, `%@${opts.onlyDomain}`) : undefined,
            ),
          )
          .orderBy(asc(users.role), asc(users.name))
          .all();
        return await ctx.json({ items });
      }),
      devSignIn: createAuthEndpoint(
        '/dev/sign-in',
        { method: 'POST', body: devSignInBodySchema },
        async (ctx) => {
          const email = ctx.body.email.toLowerCase();
          if (opts.onlyDomain && !email.endsWith(`@${opts.onlyDomain}`)) {
            throw new APIError('NOT_FOUND', { message: 'No active user with that email.' });
          }
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          if (!found?.user || (found.user as { active?: boolean }).active === false) {
            throw new APIError('NOT_FOUND', { message: 'No active user with that email.' });
          }
          const session = await ctx.context.internalAdapter.createSession(found.user.id);
          if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
          await setSessionCookie(ctx, { session, user: found.user });
          return await ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
