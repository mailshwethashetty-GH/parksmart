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
import { meRoutes } from './routes/me';
import { csrfRoutes, healthRoutes } from './routes/system';
import './types';

export type BuildAppOptions = {
  env: Env;
  db: Db;
  logger?: FastifyServerOptions['logger'];
  /** Built web app to serve in production. */
  webRoot?: string;
};

export async function buildApp({ env, db, logger, webRoot }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? { level: env.LOG_LEVEL ?? 'info' },
    trustProxy: env.NODE_ENV === 'production', // behind Caddy
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('env', env);
  app.decorate('db', db);

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(openapiPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(
    async (api) => {
      await api.register(csrfRoutes);
      await api.register(meRoutes);
    },
    { prefix: API_BASE },
  );

  if (webRoot && env.NODE_ENV === 'production') {
    await app.register(webStaticPlugin, { root: webRoot });
  }

  return app;
}
