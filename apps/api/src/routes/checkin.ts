import {
  bayQrResponseSchema,
  checkinResultSchema,
  checkinTokenSchema,
  gateTodayResponseSchema,
  idParamsSchema,
  manualCheckinSchema,
  qrResponseSchema,
  runningLateResponseSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../plugins/auth';
import {
  bayCheckin,
  bayQr,
  bookingQr,
  gateToday,
  manualCheckin,
  runningLate,
  scanCheckin,
} from '../services/checkin';

/** FR-21 check-in (QR at gate or bay, manual), FR-22 running late, and the gate view. */
export const checkinRoutes: FastifyPluginAsyncZod = async (app) => {
  const secret = app.env.QR_SIGNING_SECRET;
  const parker = requireRole('employee', 'admin');
  const gate = requireRole('security', 'admin');

  // --- employee ---
  app.get(
    '/bookings/:id/qr',
    {
      preHandler: parker,
      schema: { tags: ['check-in'], params: idParamsSchema, response: { 200: qrResponseSchema } },
    },
    async (req) => await bookingQr(app.db, actorOf(req), req.params.id, secret),
  );
  app.post(
    '/bookings/:id/running-late',
    {
      preHandler: parker,
      schema: {
        tags: ['check-in'],
        params: idParamsSchema,
        response: { 200: runningLateResponseSchema },
      },
    },
    async (req) => {
      const result = await runningLate(app.db, actorOf(req), req.params.id, app.clock());
      app.events.notifyUsers([actorOf(req).id]);
      return result;
    },
  );
  app.post(
    '/checkins/bay',
    {
      preHandler: parker,
      schema: {
        tags: ['check-in'],
        body: checkinTokenSchema,
        response: { 200: checkinResultSchema },
      },
    },
    async (req) => {
      const result = await bayCheckin(app.db, actorOf(req), req.body.token, secret, app.clock());
      app.events.notifyUsers([actorOf(req).id]);
      return result;
    },
  );

  // --- security at the gate ---
  app.post(
    '/checkins/scan',
    {
      preHandler: gate,
      schema: {
        tags: ['check-in'],
        body: checkinTokenSchema,
        response: { 200: checkinResultSchema },
      },
    },
    async (req) => await scanCheckin(app.db, actorOf(req), req.body.token, secret, app.clock()),
  );
  app.post(
    '/checkins/manual',
    {
      preHandler: gate,
      schema: {
        tags: ['check-in'],
        body: manualCheckinSchema,
        response: { 200: checkinResultSchema },
      },
    },
    async (req) => await manualCheckin(app.db, actorOf(req), req.body.bookingId, app.clock()),
  );
  app.get(
    '/gate/today',
    {
      preHandler: gate,
      schema: { tags: ['check-in'], response: { 200: gateTodayResponseSchema } },
    },
    async (req) => await gateToday(app.db, actorOf(req).siteId, app.clock()),
  );

  // --- admin: printable bay stickers ---
  app.get(
    '/admin/bays/:id/qr',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['check-in'],
        params: idParamsSchema,
        response: { 200: bayQrResponseSchema },
      },
    },
    async (req) => await bayQr(app.db, actorOf(req), req.params.id, secret),
  );
};
