import { bookingCancelSchema, idParamsSchema, okResponseSchema } from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterJobs } from '../jobs/after-jobs';
import { sameDayNow } from '../jobs/round-jobs';
import { actorOf, requireRole } from '../plugins/auth';
import { cancelBooking } from '../services/bookings';

const HEARTBEAT_MS = 25_000;

/**
 * Live updates (FR-20) over Server-Sent Events, and booking cancellation (FR-4).
 * The stream carries only "your requests changed" signals; the app refetches.
 */
export const liveRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/stream/me',
    { preHandler: requireRole('employee', 'admin'), schema: { tags: ['live'], hide: true } },
    async (req, reply) => {
      const actor = actorOf(req);
      // Serverless functions can't hold a stream open. 204 tells EventSource to stop
      // reconnecting; the app's 30 s polling keeps screens current (ADR-016).
      if (app.env.serverless) return reply.code(204).send();
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no', // don't let a proxy buffer the stream
      });
      res.write('retry: 5000\n\n');
      const send = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('ready', {});
      const off = app.events.onUser(actor.id, (e) => send(e.kind, e));
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        off();
      });
    },
  );

  app.post(
    '/bookings/:id/cancel',
    {
      preHandler: requireRole('employee', 'admin'),
      schema: {
        tags: ['bookings'],
        params: idParamsSchema,
        body: bookingCancelSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const now = app.clock();
      const { siteId, date } = await cancelBooking(
        app.db,
        actor,
        req.params.id,
        now,
        req.body.reason,
      );
      app.events.notifyUsers([actor.id]);
      // Freed today? Offer it at once (FR-4: back in a round within a minute).
      await afterJobs(
        app,
        await sameDayNow(app.db, siteId, date, `after-cancel:${req.params.id}`, now),
      );
      return { ok: true as const };
    },
  );
};
