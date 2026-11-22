import {
  approveRoundSchema,
  auditQuerySchema,
  auditResponseSchema,
  idParamsSchema,
  okResponseSchema,
  overrideSchema,
  roundDetailSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { exportAuditCsv, listAudit } from '../../services/audit-log';
import { approveRound, getRoundDetail, overrideAllocation } from '../../services/round-review';

/** Stage 1 review (FR-16): round detail, approve, override, and the audit log. Admin only. */
export const adminReviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: review'];

  app.get(
    '/rounds/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: roundDetailSchema } } },
    async (req) => await getRoundDetail(app.db, actorOf(req), req.params.id, app.clock()),
  );
  app.post(
    '/rounds/:id/approve',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: approveRoundSchema,
        response: { 200: roundDetailSchema },
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const now = app.clock();
      const affected = await approveRound(app.db, actor, req.params.id, now, req.body.note);
      app.events.notifyUsers(affected);
      return await getRoundDetail(app.db, actor, req.params.id, now);
    },
  );
  app.post(
    '/allocations/:id/override',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: overrideSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      await overrideAllocation(app.db, actorOf(req), req.params.id, req.body, app.clock());
      return { ok: true as const };
    },
  );

  app.get(
    '/audit',
    { schema: { tags, querystring: auditQuerySchema, response: { 200: auditResponseSchema } } },
    async (req) => await listAudit(app.db, actorOf(req).siteId, req.query),
  );
  app.get(
    '/audit/export',
    { schema: { tags, querystring: auditQuerySchema.omit({ cursor: true, limit: true }) } },
    async (req, reply) => {
      const csv = await exportAuditCsv(app.db, actorOf(req).siteId, req.query);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="parksmart-audit.csv"')
        .send(csv);
    },
  );
};
