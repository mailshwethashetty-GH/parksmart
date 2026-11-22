import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { API_BASE, AUTH_BASE } from '@parksmart/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const securityPlugin = fp(async (app: FastifyInstance) => {
  const isProd = app.env.NODE_ENV === 'production';

  await app.register(fastifyHelmet, {
    // Swagger UI (dev only) needs inline assets; production keeps the strict default CSP.
    contentSecurityPolicy: isProd ? undefined : false,
  });

  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) =>
      new AppError(429, 'RATE_LIMITED', `Too many requests. Try again in ${ctx.after}.`),
  });

  await app.register(fastifyCookie, { secret: app.env.SESSION_SECRET });
  await app.register(fastifyCsrf, {
    cookieOpts: { signed: true, httpOnly: true, sameSite: 'lax', path: '/', secure: isProd },
  });

  // Mutating API calls need the CSRF header. Better Auth routes use their own origin check.
  app.addHook('onRequest', (req, reply, done) => {
    const path = req.url.split('?')[0] ?? '';
    if (MUTATING.has(req.method) && path.startsWith(API_BASE) && !path.startsWith(AUTH_BASE)) {
      app.csrfProtection(req, reply, done);
      return;
    }
    done();
  });
});
