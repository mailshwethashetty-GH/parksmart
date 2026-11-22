import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { timingSafeEqual } from 'node:crypto';
import { unauthenticated } from '../lib/errors';
import { runTick } from '../jobs/tick';

const partSchema = z.object({ ok: z.boolean(), ran: z.number().int() });
const tickResponseSchema = z.object({
  rounds: partSchema,
  notifications: partSchema,
  recurring: partSchema,
});

function bearerMatches(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled jobs for serverless hosting (ADR-016). An outside scheduler (GitHub Actions,
 * Vercel Cron) calls this every few minutes with `Authorization: Bearer <CRON_SECRET>`.
 * Only registered when CRON_SECRET is set. Jobs are idempotent, so extra calls are safe.
 */
export const cronRoutes: FastifyPluginAsyncZod = async (app) => {
  const secret = app.env.CRON_SECRET;
  if (!secret) return;
  app.get(
    '/cron/tick',
    { schema: { tags: ['system'], hide: true, response: { 200: tickResponseSchema } } },
    async (req) => {
      if (!bearerMatches(req.headers.authorization, secret)) throw unauthenticated();
      return await runTick(app);
    },
  );
};
