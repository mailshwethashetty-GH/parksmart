/**
 * Idempotent job runs (ADR-004). Each run claims a unique `job_runs.job_key` first;
 * if the key already exists the job has run (or is running) and is skipped, so a
 * restart never runs a job twice.
 */
import { type Db, eq, jobRuns } from '@parksmart/db';
import { isUniqueViolation } from '../services/_scope';

export type JobOutcome<T> = { ran: true; result: T } | { ran: false };

export function runOnce<T>(db: Db, jobKey: string, now: Date, fn: () => T): JobOutcome<T> {
  try {
    db.insert(jobRuns).values({ jobKey, startedAt: now, status: 'running' }).run();
  } catch (err) {
    if (isUniqueViolation(err)) return { ran: false };
    throw err;
  }
  try {
    const result = fn();
    db.update(jobRuns)
      .set({ status: 'succeeded', finishedAt: new Date(now.getTime()) })
      .where(eq(jobRuns.jobKey, jobKey))
      .run();
    return { ran: true, result };
  } catch (err) {
    db.update(jobRuns)
      .set({ status: 'failed', finishedAt: new Date(now.getTime()), error: String(err) })
      .where(eq(jobRuns.jobKey, jobKey))
      .run();
    throw err;
  }
}
