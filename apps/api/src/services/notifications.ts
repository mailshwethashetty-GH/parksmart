/**
 * Notifications (FR-25). One service for every message, so the rules live in one place:
 * - every notification lands in the in-app inbox straight away;
 * - email follows, at most `notificationDailyCap` (default 3) per person per site-local
 *   day, and not during quiet hours (default 22:00–07:00) — held emails go out after;
 * - time-critical messages (offers, release warnings, approval reminders) skip both rules.
 * Notifications are queued inside the same transaction as the change they describe
 * (outbox), and sent by the `notifications` job. No medical details ever go in them.
 */
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notifications,
  sites,
  users,
  type Db,
} from '@parksmart/db';
import {
  formatDayShort,
  formatSiteTime,
  parseSiteSettings,
  siteLocalDate,
  siteLocalToUtc,
  addDays,
} from '@parksmart/shared';
import type { Mailer } from '../lib/mailer';

export const NOTIFICATION_KINDS = [
  'round_result',
  'offer',
  'release_warning',
  'auto_released',
  'approval_reminder',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Which kinds may interrupt at any time and don't count towards the daily cap. */
const TIME_CRITICAL: Record<NotificationKind, boolean> = {
  round_result: false,
  offer: true,
  release_warning: true,
  auto_released: false,
  approval_reminder: true,
};

type Tx = Pick<Db, 'insert'>;

export async function queueNotification(
  tx: Tx,
  n: { userId: string; kind: NotificationKind; payload: Record<string, unknown>; now: Date },
): Promise<void> {
  const base = {
    userId: n.userId,
    kind: n.kind,
    timeCritical: TIME_CRITICAL[n.kind],
    payloadJson: n.payload,
    createdAt: n.now,
  };
  await tx
    .insert(notifications)
    .values([
      { ...base, channel: 'in_app', sentAt: n.now },
      { ...base, channel: 'email' }, // pending until the job sends it
    ])
    .run();
}

// --- text ------------------------------------------------------------------------
type Payload = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function renderNotification(
  kind: string,
  p: Payload,
  timeZone: string,
): { title: string; body: string } {
  const day = p.date ? formatDayShort(s(p.date)) : '';
  switch (kind) {
    case 'round_result':
      if (p.outcome === 'confirmed') {
        return {
          title: `Bay ${s(p.bayCode)} confirmed for ${day}`,
          body: s(p.reason) || `You have bay ${s(p.bayCode)} on ${day}.`,
        };
      }
      if (p.outcome === 'waitlisted') {
        return {
          title: `Waitlisted for ${day}`,
          body:
            s(p.reason) ||
            `You are on the waitlist for ${day}. We'll offer you a bay if one frees up.`,
        };
      }
      return { title: `Request for ${day} not possible`, body: s(p.reason) };
    case 'offer':
      return {
        title: `A bay is free for you: ${s(p.bayCode)}`,
        body: `Accept by ${p.expiresAt ? formatSiteTime(s(p.expiresAt), timeZone) : 'soon'} or it goes to the next person.`,
      };
    case 'release_warning':
      return {
        title: `Check in by ${p.checkInBy ? formatSiteTime(s(p.checkInBy), timeZone) : 'soon'}`,
        body: `Your bay ${s(p.bayCode)} is released if you don't check in in time. Running late? Use "Running late" in the app.`,
      };
    case 'auto_released':
      return {
        title: `Bay ${s(p.bayCode)} released`,
        body: `Nobody checked in by the deadline on ${day}, so the bay went to someone else.`,
      };
    case 'approval_reminder':
      return {
        title:
          p.stage === 'deadline'
            ? 'Round approval due in 15 minutes'
            : 'A round is waiting for your approval',
        body: `${s(p.roundLabel)} needs review. Results are due by ${p.deadline ? formatSiteTime(s(p.deadline), timeZone) : 'the deadline'}.`,
      };
    default:
      return { title: 'ParkSmart', body: '' };
  }
}

// --- inbox ---------------------------------------------------------------------------
export async function listInbox(db: Db, userId: string, timeZone: string, limit = 30) {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.channel, 'in_app')))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
  const unread = (
    await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, 'in_app'),
          isNull(notifications.readAt),
        ),
      )
      .all()
  ).length;
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      ...renderNotification(r.kind, r.payloadJson, timeZone),
      createdAt: r.createdAt.toISOString(),
      read: !!r.readAt,
    })),
  };
}

export async function markRead(
  db: Db,
  userId: string,
  ids: string[] | 'all',
  now: Date,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.channel, 'in_app'),
        isNull(notifications.readAt),
        ids === 'all' ? undefined : inArray(notifications.id, ids.length ? ids : ['']),
      ),
    )
    .run();
}

// --- email dispatch (job) ---------------------------------------------------------------
function inQuietHours(now: Date, timeZone: string, start: string, end: string): boolean {
  const today = siteLocalDate(now, timeZone);
  const t = now.getTime();
  const startToday = siteLocalToUtc(today, start, timeZone).getTime();
  const endToday = siteLocalToUtc(today, end, timeZone).getTime();
  // Window crosses midnight (22:00–07:00): quiet if after start or before end.
  return start > end ? t >= startToday || t < endToday : t >= startToday && t < endToday;
}

export type DispatchResult = { sent: number; held: number; skipped: number; failed: number };

export async function dispatchEmails(db: Db, mailer: Mailer, now: Date): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, held: 0, skipped: 0, failed: 0 };
  const pending = await db
    .select({ n: notifications, email: users.email, active: users.active, siteId: users.siteId })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(
      and(
        eq(notifications.channel, 'email'),
        isNull(notifications.sentAt),
        isNull(notifications.skippedReason),
      ),
    )
    .orderBy(notifications.createdAt)
    .limit(500)
    .all();
  const siteRows = new Map((await db.select().from(sites).all()).map((x) => [x.id, x]));

  for (const { n, email, active, siteId } of pending) {
    const site = siteRows.get(siteId)!;
    const settings = parseSiteSettings(site.settingsJson);
    const skip = async (reason: string) => {
      await db
        .update(notifications)
        .set({ skippedReason: reason })
        .where(eq(notifications.id, n.id))
        .run();
      result.skipped++;
    };
    if (!active || email.endsWith('.invalid')) {
      await skip('no_email');
      continue;
    }
    // Stale reminders aren't worth sending (e.g. an offer that has already expired).
    if (n.timeCritical && now.getTime() - n.createdAt.getTime() > 30 * 60_000) {
      await skip('stale');
      continue;
    }
    if (!n.timeCritical) {
      if (inQuietHours(now, site.timezone, settings.quietHours.start, settings.quietHours.end)) {
        result.held++;
        continue; // sent once quiet hours end
      }
      const dayStart = siteLocalToUtc(siteLocalDate(now, site.timezone), '00:00', site.timezone);
      const sentToday = (
        await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, n.userId),
              eq(notifications.channel, 'email'),
              eq(notifications.timeCritical, false),
              gte(notifications.sentAt, dayStart),
              lt(
                notifications.sentAt,
                siteLocalToUtc(
                  addDays(siteLocalDate(now, site.timezone), 1),
                  '00:00',
                  site.timezone,
                ),
              ),
            ),
          )
          .all()
      ).length;
      if (sentToday >= settings.notificationDailyCap) {
        await skip('daily_cap'); // still in the in-app inbox
        continue;
      }
    }
    const { title, body } = renderNotification(n.kind, n.payloadJson, site.timezone);
    try {
      await mailer.send({
        to: email,
        subject: `ParkSmart: ${title}`,
        text: `${body}\n\nOpen ParkSmart to see the details.`,
      });
      await db.update(notifications).set({ sentAt: now }).where(eq(notifications.id, n.id)).run();
      result.sent++;
    } catch {
      result.failed++; // left pending; retried next run
    }
  }
  return result;
}
