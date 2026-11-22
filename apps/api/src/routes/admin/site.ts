import {
  bayBlockCreateSchema,
  bayBlocksQuerySchema,
  bayBlocksResponseSchema,
  bayBulkCreateSchema,
  bayCreateSchema,
  baySchema,
  baysQuerySchema,
  baysResponseSchema,
  bayUpdateSchema,
  idParamsSchema,
  okResponseSchema,
  siteResponseSchema,
  siteSettingsInputSchema,
  zoneCreateSchema,
  zoneSchema,
  zonesResponseSchema,
  zoneUpdateSchema,
} from '@parksmart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, requireRole } from '../../plugins/auth';
import { createBayBlocks, deleteBayBlock, listBayBlocks } from '../../services/bay-blocks';
import { getSite, updateSiteSettings } from '../../services/site';
import {
  bulkCreateBays,
  createBay,
  createZone,
  listBays,
  listZones,
  updateBay,
  updateZone,
} from '../../services/zones-bays';

/** FR-26: site settings, zones, bays and bay blocks. Admin only. */
export const adminSiteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireRole('admin'));
  const tags = ['admin: site'];

  app.get('/site', { schema: { tags, response: { 200: siteResponseSchema } } }, async (req) =>
    getSite(app.db, actorOf(req).siteId, app.clock()),
  );
  app.put(
    '/site/settings',
    { schema: { tags, body: siteSettingsInputSchema, response: { 200: siteResponseSchema } } },
    async (req) => updateSiteSettings(app.db, actorOf(req), req.body, app.clock()),
  );

  app.get('/zones', { schema: { tags, response: { 200: zonesResponseSchema } } }, async (req) => ({
    items: listZones(app.db, actorOf(req).siteId),
  }));
  app.post(
    '/zones',
    { schema: { tags, body: zoneCreateSchema, response: { 201: zoneSchema } } },
    async (req, reply) =>
      reply.status(201).send(createZone(app.db, actorOf(req), req.body, app.clock())),
  );
  app.patch(
    '/zones/:id',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: zoneUpdateSchema,
        response: { 200: zoneSchema },
      },
    },
    async (req) => updateZone(app.db, actorOf(req), req.params.id, req.body, app.clock()),
  );

  app.get(
    '/bays',
    { schema: { tags, querystring: baysQuerySchema, response: { 200: baysResponseSchema } } },
    async (req) => ({ items: listBays(app.db, actorOf(req).siteId, req.query.zoneId) }),
  );
  app.post(
    '/bays',
    { schema: { tags, body: bayCreateSchema, response: { 201: baySchema } } },
    async (req, reply) =>
      reply.status(201).send(createBay(app.db, actorOf(req), req.body, app.clock())),
  );
  app.post(
    '/bays/bulk',
    { schema: { tags, body: bayBulkCreateSchema, response: { 201: baysResponseSchema } } },
    async (req, reply) =>
      reply
        .status(201)
        .send({ items: bulkCreateBays(app.db, actorOf(req), req.body, app.clock()) }),
  );
  app.patch(
    '/bays/:id',
    {
      schema: { tags, params: idParamsSchema, body: bayUpdateSchema, response: { 200: baySchema } },
    },
    async (req) => updateBay(app.db, actorOf(req), req.params.id, req.body, app.clock()),
  );

  app.get(
    '/bay-blocks',
    {
      schema: {
        tags,
        querystring: bayBlocksQuerySchema,
        response: { 200: bayBlocksResponseSchema },
      },
    },
    async (req) => ({
      items: listBayBlocks(app.db, actorOf(req).siteId, req.query.from, req.query.to),
    }),
  );
  app.post(
    '/bay-blocks',
    { schema: { tags, body: bayBlockCreateSchema, response: { 201: bayBlocksResponseSchema } } },
    async (req, reply) =>
      reply
        .status(201)
        .send({ items: createBayBlocks(app.db, actorOf(req), req.body, app.clock()) }),
  );
  app.delete(
    '/bay-blocks/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      deleteBayBlock(app.db, actorOf(req), req.params.id, app.clock());
      return { ok: true as const };
    },
  );
};
