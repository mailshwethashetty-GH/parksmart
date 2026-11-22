/**
 * In-process scheduler (ADR-004) for a long-running server (local dev, Docker). Croner
 * fires on a fixed cadence; each job decides per site what is due and is idempotent.
 * Serverless hosting has no long-running process: there, /cron/tick runs the same jobs.
 */
import { Cron } from 'croner';
import type { FastifyInstance } from 'fastify';
import { tickNotifications, tickRecurring, tickRounds } from './tick';

export function startScheduler(app: FastifyInstance): () => void {
  // Awaiting each tick lets `protect` skip a run while the previous one is still going.
  const run = (tick: (a: FastifyInstance) => Promise<unknown>) => async () => {
    await tick(app);
  };
  const jobs = [
    // Rounds, deadlines and offer expiry: every minute, in a fixed order.
    new Cron('* * * * *', { name: 'rounds', protect: true }, run(tickRounds)),
    // Reminders, warnings and email, every minute (FR-25).
    new Cron('* * * * *', { name: 'notifications', protect: true }, run(tickNotifications)),
    new Cron('*/15 * * * *', { name: 'recurring-expand', protect: true }, run(tickRecurring)),
  ];
  return () => jobs.forEach((j) => j.stop());
}
