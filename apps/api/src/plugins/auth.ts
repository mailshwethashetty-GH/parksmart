import { AUTH_BASE, type Role } from '@parksmart/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createAuth } from '../auth/auth';
import { forbidden, unauthenticated } from '../lib/errors';
import type { Actor } from '../types';

/** Mounts Better Auth at /api/v1/auth/* and decorates `app.auth` and `request.actor`. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  const auth = createAuth(app.db, app.env);
  app.decorate('auth', auth);
  app.decorateRequest('actor', null);

  await app.register(async (scope) => {
    // Hand Better Auth the raw body for every content type (JSON, and form posts from SAML).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

    scope.route({
      method: ['GET', 'POST'],
      url: `${AUTH_BASE}/*`,
      schema: { hide: true },
      handler: async (req, reply) => {
        const url = new URL(req.url, app.env.APP_URL);
        const hasBody = req.method !== 'GET' && typeof req.body === 'string' && req.body.length > 0;
        const response = await auth.handler(
          new Request(url, {
            method: req.method,
            headers: fromNodeHeaders(req.headers),
            body: hasBody ? (req.body as string) : undefined,
          }),
        );
        reply.status(response.status);
        const setCookies = response.headers.getSetCookie();
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie') reply.header(key, value);
        });
        if (setCookies.length > 0) reply.header('set-cookie', setCookies);
        return reply.send(response.body ? await response.text() : null);
      },
    });
  });
});

/**
 * preHandler that requires a signed-in, active user with one of `roles`
 * (any role when none are given) and sets `request.actor`.
 */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    const result = await req.server.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!result) throw unauthenticated();
    const user = result.user as typeof result.user & Omit<Actor, 'id'> & { active: boolean };
    if (!user.active) throw forbidden('Your account is inactive.');
    if (roles.length > 0 && !roles.includes(user.role)) throw forbidden();
    req.actor = { id: user.id, orgId: user.orgId, siteId: user.siteId, role: user.role };
  };
}

/** The actor set by `requireRole`. Throws if a route forgot to declare its roles. */
export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}
