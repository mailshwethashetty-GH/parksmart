import {
  collationQuerySchema,
  collationResponseSchema,
  roundsQuerySchema,
  roundsResponseSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { getCollation, listRounds } from '../../services/collation';

/** FR-7 collation view and the rounds list. Review and approval arrive in M5 (FR-16). */
export const adminRoundRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: rounds'];

  app.get(
    '/collation',
    {
      schema: {
        tags,
        querystring: collationQuerySchema,
        response: { 200: collationResponseSchema },
      },
    },
    async (req) =>
      await getCollation(app.db, actorOf(req).siteId, app.clock(), req.query.from, req.query.days),
  );
  app.get(
    '/rounds',
    { schema: { tags, querystring: roundsQuerySchema, response: { 200: roundsResponseSchema } } },
    async (req) => ({
      items: await listRounds(
        app.db,
        actorOf(req).siteId,
        app.clock(),
        req.query.status,
        req.query.limit,
      ),
    }),
  );
};
