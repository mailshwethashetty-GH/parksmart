import {
  approvalCreateSchema,
  approvalSchema,
  approvalsResponseSchema,
  idParamsSchema,
  userRoleUpdateSchema,
  userSummarySchema,
  usersQuerySchema,
  usersResponseSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { createApproval, listApprovals, listUsers, revokeApproval } from '../../services/approvals';
import { setUserRole } from '../../services/people';

/** User lookup, roles (FR-29) and accessible-bay approvals (FR-13). Admin only. */
export const adminPeopleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: people'];

  app.get(
    '/users',
    { schema: { tags, querystring: usersQuerySchema, response: { 200: usersResponseSchema } } },
    async (req) => ({
      items: await listUsers(app.db, actorOf(req).siteId, req.query.q, req.query.role),
    }),
  );

  app.patch(
    '/users/:id/role',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: userRoleUpdateSchema,
        response: { 200: userSummarySchema },
      },
    },
    async (req) => await setUserRole(app.db, actorOf(req), req.params.id, req.body, app.clock()),
  );

  app.get(
    '/approvals',
    { schema: { tags, response: { 200: approvalsResponseSchema } } },
    async (req) => ({
      items: await listApprovals(app.db, actorOf(req).siteId, app.clock()),
    }),
  );
  app.post(
    '/approvals',
    { schema: { tags, body: approvalCreateSchema, response: { 201: approvalSchema } } },
    async (req, reply) =>
      reply.status(201).send(await createApproval(app.db, actorOf(req), req.body, app.clock())),
  );
  app.post(
    '/approvals/:id/revoke',
    { schema: { tags, params: idParamsSchema, response: { 200: approvalSchema } } },
    async (req) => await revokeApproval(app.db, actorOf(req), req.params.id, app.clock()),
  );
};
