import type { Db } from '@parksmart/db';
import { API_BASE } from '@parksmart/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { createAiClient, type AiClient } from './ai/client';
import type { Env } from './config/env';
import { EventBus } from './lib/events';
import { createMailer, type Mailer } from './lib/mailer';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';
import { openapiPlugin } from './plugins/openapi';
import { securityPlugin } from './plugins/security';
import { webStaticPlugin } from './plugins/web-static';
import { adminPeopleRoutes } from './routes/admin/people';
import { adminPolicyRoutes } from './routes/admin/policy';
import { adminReportRoutes } from './routes/admin/reports';
import { adminReviewRoutes } from './routes/admin/review';
import { adminRoundRoutes } from './routes/admin/rounds';
import { adminSiteRoutes } from './routes/admin/site';
import { checkinRoutes } from './routes/checkin';
import { cronRoutes } from './routes/cron';
import { liveRoutes } from './routes/live';
import { meRoutes } from './routes/me';
import { meProfileRoutes } from './routes/me-profile';
import { policyRoutes } from './routes/policy';
import { requestRoutes } from './routes/requests';
import { csrfRoutes, healthRoutes } from './routes/system';
import './types';

export type BuildAppOptions = {
  env: Env;
  db: Db;
  logger?: FastifyServerOptions['logger'];
  /** Built web app to serve in production. */
  webRoot?: string;
  clock?: () => Date;
  /** Inject a fake in tests; defaults to the real client when ANTHROPIC_API_KEY is set. */
  ai?: AiClient | null;
  /** Inject a fake in tests; defaults to SMTP (or log-only without SMTP settings). */
  mailer?: Mailer;
};

export async function buildApp({ env, db, logger, webRoot, clock, ai, mailer }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? { level: env.LOG_LEVEL ?? 'info' },
    trustProxy: env.NODE_ENV === 'production', // behind Caddy or Vercel's edge
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('env', env);
  app.decorate('db', db);
  app.decorate('clock', clock ?? (() => new Date()));
  app.decorate(
    'ai',
    ai !== undefined
      ? ai
      : createAiClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL_FAST }),
  );
  app.decorate('events', new EventBus());
  app.decorate(
    'mailer',
    mailer ??
      createMailer({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.MAIL_FROM,
        log: (msg, data) => app.log.info(data ?? {}, msg),
      }),
  );

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(openapiPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(
    async (api) => {
      await api.register(csrfRoutes);
      await api.register(cronRoutes);
      await api.register(meRoutes);
      await api.register(meProfileRoutes);
      await api.register(policyRoutes);
      await api.register(requestRoutes);
      await api.register(liveRoutes);
      await api.register(checkinRoutes);
      await api.register(
        async (admin) => {
          await admin.register(adminSiteRoutes);
          await admin.register(adminPeopleRoutes);
          await admin.register(adminPolicyRoutes);
          await admin.register(adminRoundRoutes);
          await admin.register(adminReviewRoutes);
          await admin.register(adminReportRoutes);
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
