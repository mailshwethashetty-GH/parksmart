import { monthlyReportSchema, reportQuerySchema } from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { monthlyReport, monthlyReportCsv } from '../../services/reports';

/** FR-28 (P0): monthly report and one-click export. Admin only. */
export const adminReportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: reports'];
  app.get(
    '/reports/monthly',
    { schema: { tags, querystring: reportQuerySchema, response: { 200: monthlyReportSchema } } },
    async (req) => await monthlyReport(app.db, actorOf(req).siteId, req.query.month, app.clock()),
  );
  app.get(
    '/reports/export',
    { schema: { tags, querystring: reportQuerySchema } },
    async (req, reply) => {
      const csv = monthlyReportCsv(
        await monthlyReport(app.db, actorOf(req).siteId, req.query.month, app.clock()),
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="parksmart-${req.query.month}.csv"`)
        .send(csv);
    },
  );
};
