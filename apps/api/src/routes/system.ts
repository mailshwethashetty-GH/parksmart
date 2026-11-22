import { csrfTokenResponseSchema, healthResponseSchema } from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { checkHealth } from '../services/health';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { tags: ['system'], response: { 200: healthResponseSchema } } },
    async () => checkHealth(app.db),
  );
};

export const csrfRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public: issues the token (and its signed secret cookie) the web app sends on mutations.
  app.get(
    '/csrf-token',
    { schema: { tags: ['system'], response: { 200: csrfTokenResponseSchema } } },
    async (_req, reply) => ({ token: reply.generateCsrf() }),
  );
};
