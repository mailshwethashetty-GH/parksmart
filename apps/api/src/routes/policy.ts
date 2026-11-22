import { currentPolicyResponseSchema, errorResponseSchema } from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../plugins/auth';
import { getCurrentPolicy } from '../services/policy';

/** FR-12: every employee can read the policy in force, in plain language. */
export const policyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/policy/current',
    {
      preHandler: requireRole(),
      schema: {
        tags: ['policy'],
        response: { 200: currentPolicyResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req) => await getCurrentPolicy(app.db, actorOf(req).siteId, app.clock()),
  );
};
