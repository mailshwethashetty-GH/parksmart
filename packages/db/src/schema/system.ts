import { CHECKIN_METHODS, JOB_RUN_STATUSES, NOTIFICATION_CHANNELS } from '@parksmart/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, id, timestamp } from './_helpers';
import { sites } from './sites';
import { users } from './people';
import { bookings } from './allocation';

export const checkins = sqliteTable(
  'checkins',
  {
    id: id(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => bookings.id),
    method: text('method', { enum: CHECKIN_METHODS }).notNull(),
    at: timestamp('at').notNull(),
    byUserId: text('by_user_id').references(() => users.id),
  },
  (t) => [index('checkins_booking_idx').on(t.bookingId)],
);

/** P1 (FR-24). */
export const evSessions = sqliteTable('ev_sessions', {
  id: id(),
  bookingId: text('booking_id')
    .notNull()
    .references(() => bookings.id),
  startedAt: timestamp('started_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  overstayMinutes: integer('overstay_minutes').notNull().default(0),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS }).notNull(),
    /** Exempt from the daily cap and quiet hours (offers, release warnings, check-in reminders). */
    timeCritical: integer('time_critical', { mode: 'boolean' }).notNull().default(false),
    payloadJson: text('payload_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at'),
    readAt: timestamp('read_at'),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)],
);

/** P1. */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  keysJson: text('keys_json', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  createdAt: createdAt(),
});

/** Every Claude API call. Pseudonymous input only (non-negotiable #7). */
export const aiLogs = sqliteTable(
  'ai_logs',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputJson: text('input_json', { mode: 'json' }).$type<unknown>().notNull(),
    outputJson: text('output_json', { mode: 'json' }).$type<unknown>(),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_logs_site_created_idx').on(t.siteId, t.createdAt)],
);

/**
 * Append-only (non-negotiable #5). Triggers in migration `0001_audit_log_append_only`
 * block UPDATE always, and DELETE of rows newer than 12 months (retention job only).
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    siteId: text('site_id').references(() => sites.id),
    /** Null for system actors (scheduler). */
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    beforeJson: text('before_json', { mode: 'json' }).$type<unknown>(),
    afterJson: text('after_json', { mode: 'json' }).$type<unknown>(),
    reason: text('reason'),
    at: timestamp('at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('audit_log_site_at_idx').on(t.siteId, t.at)],
);

/** Idempotency for scheduled jobs: e.g. `weekly:<site>:<week>`. */
export const jobRuns = sqliteTable('job_runs', {
  id: id(),
  jobKey: text('job_key').notNull().unique(),
  startedAt: timestamp('started_at').notNull(),
  finishedAt: timestamp('finished_at'),
  status: text('status', { enum: JOB_RUN_STATUSES }).notNull().default('running'),
  error: text('error'),
});
