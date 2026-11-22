/**
 * One scheduler tick (ADR-004, ADR-016): rounds and deadlines, then notifications and
 * email, then recurring requests. Every job is idempotent (`runOnce`, status checks),
 * so a tick may run late, twice, or from several callers without double effects.
 * Used by the in-process scheduler and by the /cron/tick endpoint (serverless hosting).
 */
import type { FastifyInstance } from 'fastify';
import { reportError } from '../lib/monitoring';
import { dispatchEmails } from '../services/notifications';
import { afterJobs } from './after-jobs';
import { notificationJobs } from './notification-jobs';
import { recurringExpandJob } from './recurring-expand';
import { roundJobs } from './round-jobs';

export type TickPart = 'rounds' | 'notifications' | 'recurring';
export type TickSummary = Record<TickPart, { ok: boolean; ran: number }>;

async function guarded(app: FastifyInstance, job: TickPart, fn: () => Promise<number>) {
  try {
    return { ok: true, ran: await fn() };
  } catch (err) {
    app.log.error({ err, job }, 'job failed');
    reportError(err, { job });
    return { ok: false, ran: 0 };
  }
}

export function tickRounds(app: FastifyInstance) {
  return guarded(app, 'rounds', async () => {
    const events = await roundJobs(app.db, app.clock());
    for (const e of events) app.log.info(e, 'job ran');
    await afterJobs(app, events);
    return events.length;
  });
}

export function tickNotifications(app: FastifyInstance) {
  return guarded(app, 'notifications', async () => {
    const now = app.clock();
    const notices = await notificationJobs(app.db, now);
    for (const e of notices) {
      app.log.info({ job: e.job, key: e.key }, 'job ran');
      app.events.notifyUsers(e.userIds);
    }
    const sent = await dispatchEmails(app.db, app.mailer, now);
    if (sent.sent || sent.failed) app.log.info({ job: 'email', ...sent }, 'job ran');
    return notices.length + sent.sent;
  });
}

export function tickRecurring(app: FastifyInstance) {
  return guarded(app, 'recurring', async () => {
    const results = await recurringExpandJob(app.db, app.clock());
    const ran = results.filter((r) => r.created !== null);
    if (ran.length) app.log.info({ job: 'recurring-expand', results: ran }, 'job ran');
    return ran.length;
  });
}

/** Everything that is due, in order. Rounds first: notifications report their results. */
export async function runTick(app: FastifyInstance): Promise<TickSummary> {
  const rounds = await tickRounds(app);
  const notifications = await tickNotifications(app);
  const recurring = await tickRecurring(app);
  return { rounds, notifications, recurring };
}
