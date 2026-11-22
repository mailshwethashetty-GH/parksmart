import {
  approvalCreateSchema,
  approvalSchema,
  approvalsResponseSchema,
  idParamsSchema,
  usersQuerySchema,
  usersResponseSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { createApproval, listApprovals, listUsers, revokeApproval } from '../../services/approvals';

/** User lookup and accessible-bay approvals (FR-13). Admin only. */
export const adminPeopleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: people'];

  app.get(
    '/users',
    { schema: { tags, querystring: usersQuerySchema, response: { 200: usersResponseSchema } } },
    async (req) => ({ items: listUsers(app.db, actorOf(req).siteId, req.query.q, req.query.role) }),
  );

  app.get(
    '/approvals',
    { schema: { tags, response: { 200: approvalsResponseSchema } } },
    async (req) => ({
      items: listApprovals(app.db, actorOf(req).siteId, app.clock()),
    }),
  );
  app.post(
    '/approvals',
    { schema: { tags, body: approvalCreateSchema, response: { 201: approvalSchema } } },
    async (req, reply) =>
      reply.status(201).send(createApproval(app.db, actorOf(req), req.body, app.clock())),
  );
  app.post(
    '/approvals/:id/revoke',
    { schema: { tags, params: idParamsSchema, response: { 200: approvalSchema } } },
    async (req) => revokeApproval(app.db, actorOf(req), req.params.id, app.clock()),
  );
};
