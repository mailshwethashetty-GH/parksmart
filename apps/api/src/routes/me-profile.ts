import {
  consentUpdateSchema,
  idParamsSchema,
  inboxResponseSchema,
  markReadSchema,
  okResponseSchema,
  profileResponseSchema,
  profileUpdateSchema,
  vehicleCreateSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../plugins/auth';
import {
  addVehicle,
  deleteMyAccount,
  exportMyData,
  getProfile,
  removeVehicle,
  setConsent,
  updateProfile,
} from '../services/me-profile';
import { listInbox, markRead } from '../services/notifications';
import { loadSite } from '../services/site';

/** Inbox (FR-25), profile and vehicles, consent, data export and deletion (DPDP). */
export const meProfileRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['me'];
  const anyone = requireRole();
  const parker = requireRole('employee', 'admin');

  app.get(
    '/me/notifications',
    { preHandler: anyone, schema: { tags, response: { 200: inboxResponseSchema } } },
    async (req) => {
      const actor = actorOf(req);
      return await listInbox(app.db, actor.id, (await loadSite(app.db, actor.siteId)).timezone);
    },
  );
  app.post(
    '/me/notifications/read',
    {
      preHandler: anyone,
      schema: { tags, body: markReadSchema, response: { 200: okResponseSchema } },
    },
    async (req) => {
      await markRead(app.db, actorOf(req).id, req.body.ids, app.clock());
      return { ok: true as const };
    },
  );

  app.get(
    '/me/profile',
    { preHandler: parker, schema: { tags, response: { 200: profileResponseSchema } } },
    async (req) => await getProfile(app.db, actorOf(req)),
  );
  app.patch(
    '/me/profile',
    {
      preHandler: parker,
      schema: { tags, body: profileUpdateSchema, response: { 200: profileResponseSchema } },
    },
    async (req) => await updateProfile(app.db, actorOf(req), req.body, app.clock()),
  );
  app.post(
    '/me/vehicles',
    {
      preHandler: parker,
      schema: { tags, body: vehicleCreateSchema, response: { 200: profileResponseSchema } },
    },
    async (req) => await addVehicle(app.db, actorOf(req), req.body, app.clock()),
  );
  app.delete(
    '/me/vehicles/:id',
    {
      preHandler: parker,
      schema: { tags, params: idParamsSchema, response: { 200: profileResponseSchema } },
    },
    async (req) => await removeVehicle(app.db, actorOf(req), req.params.id),
  );
  app.post(
    '/me/consents',
    {
      preHandler: parker,
      schema: { tags, body: consentUpdateSchema, response: { 200: profileResponseSchema } },
    },
    async (req) =>
      await setConsent(app.db, actorOf(req), req.body.purpose, req.body.granted, app.clock()),
  );

  app.get('/me/data-export', { preHandler: anyone, schema: { tags } }, async (req, reply) =>
    reply
      .header('content-disposition', 'attachment; filename="parksmart-my-data.json"')
      .send(await exportMyData(app.db, actorOf(req))),
  );
  app.delete(
    '/me',
    { preHandler: anyone, schema: { tags, response: { 200: okResponseSchema } } },
    async (req) => {
      await deleteMyAccount(app.db, actorOf(req), app.clock());
      return { ok: true as const };
    },
  );
};
