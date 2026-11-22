import {
  calendarQuerySchema,
  calendarResponseSchema,
  idParamsSchema,
  recurringPatternCreateSchema,
  recurringPatternSchema,
  recurringPatternsResponseSchema,
  recurringPatternUpdateSchema,
  requestCreateSchema,
  requestSchema,
  requestsQuerySchema,
  requestsResponseSchema,
  requestUpdateSchema,
  skipBodySchema,
  skipParamsSchema,
  offerAcceptResponseSchema,
  okResponseSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { reofferAfter } from '../jobs/round-jobs';
import { actorOf, requireRole } from '../plugins/auth';
import { acceptOffer, declineOffer } from '../services/offers';
import {
  createPattern,
  listPatterns,
  skipDate,
  unskipDate,
  updatePattern,
} from '../services/recurring';
import {
  createRequests,
  getCalendar,
  listRequests,
  updateRequest,
  withdrawRequest,
} from '../services/requests';

/** FR-1, FR-3, FR-4: an employee's own requests and recurring patterns. */
export const requestRoutes: FastifyPluginAsyncZod = async (app) => {
  // Admins may also park, so they use the employee app too.
  app.addHook('preHandler', requireRole('employee', 'admin'));
  const tags = ['requests'];

  app.get(
    '/requests',
    {
      schema: { tags, querystring: requestsQuerySchema, response: { 200: requestsResponseSchema } },
    },
    async (req) => ({
      items: listRequests(app.db, actorOf(req), app.clock(), req.query.from, req.query.to),
    }),
  );
  app.get(
    '/requests/calendar',
    {
      schema: { tags, querystring: calendarQuerySchema, response: { 200: calendarResponseSchema } },
    },
    async (req) => getCalendar(app.db, actorOf(req), app.clock(), req.query.from, req.query.days),
  );
  app.post(
    '/requests',
    { schema: { tags, body: requestCreateSchema, response: { 201: requestsResponseSchema } } },
    async (req, reply) =>
      reply
        .status(201)
        .send({ items: createRequests(app.db, actorOf(req), req.body, app.clock()) }),
  );
  app.patch(
    '/requests/:id',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: requestUpdateSchema,
        response: { 200: requestSchema },
      },
    },
    async (req) => updateRequest(app.db, actorOf(req), req.params.id, req.body, app.clock()),
  );
  app.delete(
    '/requests/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: requestSchema } } },
    async (req) => {
      const actor = actorOf(req);
      const now = app.clock();
      const { request, releasedOfferId } = withdrawRequest(app.db, actor, req.params.id, now);
      if (releasedOfferId) reofferAfter(app.db, actor.siteId, request.date, releasedOfferId, now);
      return request;
    },
  );

  app.get(
    '/recurring-patterns',
    { schema: { tags, response: { 200: recurringPatternsResponseSchema } } },
    async (req) => ({ items: listPatterns(app.db, actorOf(req), app.clock()) }),
  );
  app.post(
    '/recurring-patterns',
    {
      schema: {
        tags,
        body: recurringPatternCreateSchema,
        response: { 201: recurringPatternSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(createPattern(app.db, actorOf(req), req.body, app.clock())),
  );
  app.patch(
    '/recurring-patterns/:id',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: recurringPatternUpdateSchema,
        response: { 200: recurringPatternSchema },
      },
    },
    async (req) => updatePattern(app.db, actorOf(req), req.params.id, req.body, app.clock()),
  );
  app.post(
    '/recurring-patterns/:id/skips',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: skipBodySchema,
        response: { 200: recurringPatternSchema },
      },
    },
    async (req) => skipDate(app.db, actorOf(req), req.params.id, req.body.date, app.clock()),
  );
  app.delete(
    '/recurring-patterns/:id/skips/:date',
    { schema: { tags, params: skipParamsSchema, response: { 200: recurringPatternSchema } } },
    async (req) => unskipDate(app.db, actorOf(req), req.params.id, req.params.date, app.clock()),
  );

  // Same-day offers (FR-20): accept within the window, or decline to pass it on.
  app.post(
    '/offers/:id/accept',
    { schema: { tags, params: idParamsSchema, response: { 200: offerAcceptResponseSchema } } },
    async (req) => acceptOffer(app.db, actorOf(req), req.params.id, app.clock()),
  );
  app.post(
    '/offers/:id/decline',
    { schema: { tags, params: idParamsSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const now = app.clock();
      const { siteId, date } = declineOffer(app.db, actorOf(req), req.params.id, now);
      reofferAfter(app.db, siteId, date, req.params.id, now);
      return { ok: true as const };
    },
  );
};
