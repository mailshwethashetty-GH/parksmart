/**
 * Notification and housekeeping jobs (FR-25, ADR-008, docs/05 auditability):
 *  - release warnings: 10 min before a booking's check-in deadline (time-critical)
 *  - approval reminders: 60 min after a weekly/daily round runs, and 15 min before its
 *    deadline, to every active admin of the site (backup admins are admins too)
 *  - audit retention: daily, removes audit and AI log entries older than 12 months
 * Each message is sent once (job_runs keys). Emails go out via `dispatchEmails`.
 */
import {
  aiLogs,
  and,
  auditLog,
  bays,
  bookings,
  eq,
  lt,
  lte,
  rounds,
  sites,
  users,
  type Db,
} from '@parksmart/db';
import { formatDayShort, siteLocalDate } from '@parksmart/shared';
import { deadlineFor } from '../services/checkin';
import { queueNotification } from '../services/notifications';
import { runOnce } from './runner';

const WARN_BEFORE_MS = 10 * 60_000;
const REMIND_AFTER_RUN_MS = 60 * 60_000;
const REMIND_BEFORE_DEADLINE_MS = 15 * 60_000;
const RETENTION_MONTHS = 12;

export type NotificationEvent = { job: string; key: string; userIds: string[] };

export function notificationJobs(db: Db, now: Date): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  for (const site of db.select().from(sites).all()) {
    const today = siteLocalDate(now, site.timezone);

    // Release warnings for today's bookings still waiting for check-in.
    for (const b of db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.siteId, site.id),
          eq(bookings.date, today),
          eq(bookings.status, 'confirmed'),
        ),
      )
      .all()) {
      const deadline = deadlineFor(db, b);
      const msLeft = deadline.getTime() - now.getTime();
      if (msLeft <= 0 || msLeft > WARN_BEFORE_MS) continue;
      // Keyed on the deadline, so a "running late" extension earns a fresh warning.
      const key = `release-warning:${b.id}:${deadline.getTime()}`;
      const out = runOnce(db, key, now, () => {
        const bayCode = db
          .select({ code: bays.code })
          .from(bays)
          .where(eq(bays.id, b.bayId))
          .get()?.code;
        queueNotification(db, {
          userId: b.userId,
          kind: 'release_warning',
          payload: { date: b.date, bayCode, checkInBy: deadline.toISOString() },
          now,
        });
      });
      if (out.ran) events.push({ job: 'release-warning', key, userIds: [b.userId] });
    }

    // Approval reminders for rounds waiting for review.
    const admins = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.siteId, site.id), eq(users.role, 'admin'), eq(users.active, true)))
      .all()
      .map((u) => u.id);
    for (const r of db
      .select()
      .from(rounds)
      .where(and(eq(rounds.siteId, site.id), eq(rounds.status, 'pending_review')))
      .all()) {
      if (!r.runAt || !r.approvalDeadline) continue;
      const stages: { stage: 'after_run' | 'deadline'; due: boolean }[] = [
        { stage: 'after_run', due: now.getTime() >= r.runAt.getTime() + REMIND_AFTER_RUN_MS },
        {
          stage: 'deadline',
          due:
            now.getTime() >= r.approvalDeadline.getTime() - REMIND_BEFORE_DEADLINE_MS &&
            now.getTime() < r.approvalDeadline.getTime(),
        },
      ];
      for (const { stage, due } of stages) {
        if (!due) continue;
        const key = `approval-reminder:${r.id}:${stage}`;
        const label = `${r.roundType === 'weekly' ? 'Weekly' : 'Daily'} round for ${formatDayShort(r.targetDateFrom)}${
          r.targetDateTo !== r.targetDateFrom ? ` – ${formatDayShort(r.targetDateTo)}` : ''
        }`;
        const out = runOnce(db, key, now, () => {
          for (const adminId of admins) {
            queueNotification(db, {
              userId: adminId,
              kind: 'approval_reminder',
              payload: {
                roundId: r.id,
                roundLabel: label,
                stage,
                deadline: r.approvalDeadline!.toISOString(),
              },
              now,
            });
          }
        });
        if (out.ran) events.push({ job: 'approval-reminder', key, userIds: admins });
      }
    }

    // Audit retention, once a day per site (the append-only trigger allows only this).
    const key = `audit-retention:${site.id}:${today}`;
    runOnce(db, key, now, () => {
      const cutoff = new Date(now);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
      db.delete(auditLog)
        .where(and(eq(auditLog.siteId, site.id), lt(auditLog.at, cutoff)))
        .run();
      db.delete(aiLogs)
        .where(and(eq(aiLogs.siteId, site.id), lte(aiLogs.createdAt, cutoff)))
        .run();
    });
  }
  return events;
}
