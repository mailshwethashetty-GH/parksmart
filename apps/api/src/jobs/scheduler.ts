/**
 * In-process scheduler (ADR-004). Croner fires on a fixed cadence; each job decides per
 * site what is due (site time zones and settings) and uses `runOnce` for idempotency.
 * M4 adds the round jobs here.
 */
import { Cron } from 'croner';
import type { FastifyInstance } from 'fastify';
import { recurringExpandJob } from './recurring-expand';

export function startScheduler(app: FastifyInstance): () => void {
  const jobs = [
    new Cron('*/15 * * * *', { name: 'recurring-expand', protect: true }, () => {
      try {
        const results = recurringExpandJob(app.db, app.clock());
        const ran = results.filter((r) => r.created !== null);
        if (ran.length) app.log.info({ job: 'recurring-expand', results: ran }, 'job ran');
      } catch (err) {
        app.log.error({ err, job: 'recurring-expand' }, 'job failed');
      }
    }),
  ];
  return () => jobs.forEach((j) => j.stop());
}
