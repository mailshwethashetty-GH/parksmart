import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { existsSync } from 'node:fs';

/** In production, serve the built web app and fall back to index.html for client routes. */
export const webStaticPlugin = fp(async (app: FastifyInstance, opts: { root: string }) => {
  if (!existsSync(opts.root)) {
    app.log.warn({ root: opts.root }, 'web build not found; serving API only');
    return;
  }
  await app.register(fastifyStatic, { root: opts.root, wildcard: false });
  app.decorate('sendSpa', true);
  app.decorateReply('sendSpa', function (this: FastifyReply) {
    return this.sendFile('index.html');
  });
});
