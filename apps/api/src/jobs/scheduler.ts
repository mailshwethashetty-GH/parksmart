/**
 * In-process scheduler (ADR-004). Croner fires on a fixed cadence; each job decides per
 * site what is due (site time zones and settings) and uses `runOnce` for idempotency.
 */
import { Cron } from 'croner';
import type { FastifyInstance } from 'fastify';
import { recurringExpandJob } from './recurring-expand';
import { dispatchEmails } from '../services/notifications';
import { afterJobs } from './after-jobs';
import { notificationJobs } from './notification-jobs';
import { roundJobs } from './round-jobs';
import { reportError } from '../lib/monitoring';

export function startScheduler(app: FastifyInstance): () => void {
  const jobs = [
    // Rounds, deadlines and offer expiry: every minute, in a fixed order.
    new Cron('* * * * *', { name: 'rounds', protect: true }, () => {
      try {
        const events = roundJobs(app.db, app.clock());
        for (const e of events) app.log.info(e, 'job ran');
        afterJobs(app, events);
      } catch (err) {
        app.log.error({ err, job: 'rounds' }, 'job failed');
        reportError(err, { job: 'rounds' });
      }
    }),
    // Reminders, warnings and email, every minute (FR-25).
    new Cron('* * * * *', { name: 'notifications', protect: true }, async () => {
      try {
        const now = app.clock();
        for (const e of notificationJobs(app.db, now)) {
          app.log.info({ job: e.job, key: e.key }, 'job ran');
          app.events.notifyUsers(e.userIds);
        }
        const sent = await dispatchEmails(app.db, app.mailer, now);
        if (sent.sent || sent.failed) app.log.info({ job: 'email', ...sent }, 'job ran');
      } catch (err) {
        app.log.error({ err, job: 'notifications' }, 'job failed');
        reportError(err, { job: 'notifications' });
      }
    }),
    new Cron('*/15 * * * *', { name: 'recurring-expand', protect: true }, () => {
      try {
        const results = recurringExpandJob(app.db, app.clock());
        const ran = results.filter((r) => r.created !== null);
        if (ran.length) app.log.info({ job: 'recurring-expand', results: ran }, 'job ran');
      } catch (err) {
        app.log.error({ err, job: 'recurring-expand' }, 'job failed');
        reportError(err, { job: 'recurring-expand' });
      }
    }),
  ];
  return () => jobs.forEach((j) => j.stop());
}
