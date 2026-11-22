import {
  feasibilityRequestSchema,
  feasibilityResponseSchema,
  okResponseSchema,
  policyResponseSchema,
  policyVersionDetailSchema,
  publishSchema,
  rulesUpdateSchema,
  versionParamsSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { checkFeasibility } from '../../services/feasibility';
import {
  createDraft,
  discardDraft,
  getPolicy,
  getPolicyVersion,
  publishDraft,
  updateDraftRules,
} from '../../services/policy';

/** Rule builder, feasibility and publication (FR-8, FR-9, FR-11, FR-12). Admin only. */
export const adminPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: policy'];
  const detail = { 200: policyVersionDetailSchema };

  app.get(
    '/policy',
    { schema: { tags, response: { 200: policyResponseSchema } } },
    async (req) => await getPolicy(app.db, actorOf(req).siteId, app.clock()),
  );
  app.get(
    '/policy/versions/:version',
    { schema: { tags, params: versionParamsSchema, response: detail } },
    async (req) =>
      await getPolicyVersion(app.db, actorOf(req).siteId, req.params.version, app.clock()),
  );
  app.post(
    '/policy/versions',
    { schema: { tags, response: { 201: policyVersionDetailSchema } } },
    async (req, reply) =>
      reply.status(201).send(await createDraft(app.db, actorOf(req), app.clock())),
  );
  app.put(
    '/policy/versions/:version/rules',
    { schema: { tags, params: versionParamsSchema, body: rulesUpdateSchema, response: detail } },
    async (req) =>
      await updateDraftRules(app.db, actorOf(req), req.params.version, req.body.rules, app.clock()),
  );
  app.delete(
    '/policy/versions/:version',
    { schema: { tags, params: versionParamsSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      await discardDraft(app.db, actorOf(req), req.params.version, app.clock());
      return { ok: true as const };
    },
  );
  app.post(
    '/policy/versions/:version/publish',
    { schema: { tags, params: versionParamsSchema, body: publishSchema, response: detail } },
    async (req) =>
      await publishDraft(app.db, actorOf(req), req.params.version, req.body.reason, app.clock()),
  );
  app.post(
    '/rules/feasibility',
    {
      schema: {
        tags,
        body: feasibilityRequestSchema,
        response: { 200: feasibilityResponseSchema },
      },
    },
    async (req) => await checkFeasibility(app.db, actorOf(req).siteId, req.body.rules),
  );
};
