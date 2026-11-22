import type { Db } from '@parksmart/db';
import { API_BASE } from '@parksmart/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Env } from './config/env';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';
import { openapiPlugin } from './plugins/openapi';
import { securityPlugin } from './plugins/security';
import { webStaticPlugin } from './plugins/web-static';
import { adminPeopleRoutes } from './routes/admin/people';
import { adminPolicyRoutes } from './routes/admin/policy';
import { adminSiteRoutes } from './routes/admin/site';
import { meRoutes } from './routes/me';
import { policyRoutes } from './routes/policy';
import { csrfRoutes, healthRoutes } from './routes/system';
import './types';

export type BuildAppOptions = {
  env: Env;
  db: Db;
  logger?: FastifyServerOptions['logger'];
  /** Built web app to serve in production. */
  webRoot?: string;
  clock?: () => Date;
};

export async function buildApp({ env, db, logger, webRoot, clock }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? { level: env.LOG_LEVEL ?? 'info' },
    trustProxy: env.NODE_ENV === 'production', // behind Caddy
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('env', env);
  app.decorate('db', db);
  app.decorate('clock', clock ?? (() => new Date()));

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(openapiPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(
    async (api) => {
      await api.register(csrfRoutes);
      await api.register(meRoutes);
      await api.register(policyRoutes);
      await api.register(
        async (admin) => {
          await admin.register(adminSiteRoutes);
          await admin.register(adminPeopleRoutes);
          await admin.register(adminPolicyRoutes);
        },
        { prefix: '/admin' },
      );
    },
    { prefix: API_BASE },
  );

  if (webRoot && env.NODE_ENV === 'production') {
    await app.register(webStaticPlugin, { root: webRoot });
  }

  return app;
}
