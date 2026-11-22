import { errorResponseSchema, meResponseSchema } from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../plugins/auth';
import { getMe } from '../services/me';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    {
      preHandler: requireRole(),
      schema: {
        tags: ['profile'],
        security: [{ session: [] }],
        response: { 200: meResponseSchema, 401: errorResponseSchema },
      },
    },
    async (req) => await getMe(app.db, actorOf(req).id),
  );
};
