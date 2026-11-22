import {
  csrfTokenResponseSchema,
  healthResponseSchema,
  loginOptionsResponseSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { checkHealth } from '../services/health';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { tags: ['system'], response: { 200: healthResponseSchema } } },
    async () => await checkHealth(app.db),
  );
};

export const csrfRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public: issues the token (and its signed secret cookie) the web app sends on mutations.
  app.get(
    '/csrf-token',
    { schema: { tags: ['system'], response: { 200: csrfTokenResponseSchema } } },
    async (_req, reply) => ({ token: reply.generateCsrf() }),
  );

  // Public: the login screen shows only the sign-in methods that work here.
  app.get(
    '/login-options',
    { schema: { tags: ['system'], response: { 200: loginOptionsResponseSchema } } },
    async () => ({
      sso: app.env.ssoProvider,
      samplePeople: app.env.devLoginEnabled
        ? ('dev' as const)
        : app.env.demoMode
          ? ('demo' as const)
          : null,
    }),
  );
};
