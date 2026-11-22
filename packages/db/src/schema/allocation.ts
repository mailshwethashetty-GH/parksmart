import {
  ALLOCATION_OUTCOMES,
  APPEAL_STATUSES,
  ARRIVAL_WINDOWS,
  BAY_TYPES,
  BOOKING_STATUSES,
  OFFER_STATUSES,
  PUBLISH_MODES,
  REASON_CATEGORIES,
  REQUEST_STATUSES,
  ROUND_STATUSES,
  ROUND_TYPES,
} from '@parksmart/shared';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, isoDate, timestamp, updatedAt } from './_helpers';
import { bays, orgs, sites } from './sites';
import { users } from './people';
import { policyVersions } from './policy';

export const recurringPatterns = sqliteTable(
  'recurring_patterns',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ISO weekdays, 1 = Monday. */
    weekdaysJson: text('weekdays_json', { mode: 'json' }).$type<number[]>().notNull(),
    bayType: text('bay_type', { enum: BAY_TYPES }).notNull(),
    arrivalWindow: text('arrival_window', { enum: ARRIVAL_WINDOWS }).notNull(),
    allowFallback: integer('allow_fallback', { mode: 'boolean' }).notNull().default(true),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('recurring_patterns_user_idx').on(t.userId)],
);

export const recurringSkips = sqliteTable(
  'recurring_skips',
  {
    id: id(),
    patternId: text('pattern_id')
      .notNull()
      .references(() => recurringPatterns.id, { onDelete: 'cascade' }),
    date: isoDate('date').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('recurring_skips_pattern_date_uq').on(t.patternId, t.date)],
);

export const requests = sqliteTable(
  'requests',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    date: isoDate('date').notNull(),
    bayType: text('bay_type', { enum: BAY_TYPES }).notNull(),
    arrivalWindow: text('arrival_window', { enum: ARRIVAL_WINDOWS }).notNull(),
    reasonCategory: text('reason_category', { enum: REASON_CATEGORIES }),
    /** False = "EV bay only": no car-bay fallback (ADR-010). */
    allowFallback: integer('allow_fallback', { mode: 'boolean' }).notNull().default(true),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('requested'),
    /** Audit only. NEVER scored (non-negotiable #2). */
    submittedAt: timestamp('submitted_at').notNull(),
    recurringPatternId: text('recurring_pattern_id').references(() => recurringPatterns.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One active request per employee per day.
    uniqueIndex('requests_user_date_active_uq')
      .on(t.userId, t.date)
      .where(sql`status in ('requested', 'allocated', 'waitlisted')`),
    index('requests_site_date_status_idx').on(t.siteId, t.date, t.status),
  ],
);

export const rounds = sqliteTable(
  'rounds',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    roundType: text('round_type', { enum: ROUND_TYPES }).notNull(),
    targetDateFrom: isoDate('target_date_from').notNull(),
    targetDateTo: isoDate('target_date_to').notNull(),
    status: text('status', { enum: ROUND_STATUSES }).notNull().default('collecting'),
    /** Seed for the tie-break PRNG; logged so the round can be replayed. */
    seed: text('seed').notNull(),
    policyVersionId: text('policy_version_id')
      .notNull()
      .references(() => policyVersions.id),
    runAt: timestamp('run_at'),
    /** Null for same-day rounds (they auto-publish). */
    approvalDeadline: timestamp('approval_deadline'),
    publishMode: text('publish_mode', { enum: PUBLISH_MODES }),
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    publishedAt: timestamp('published_at'),
    createdAt: createdAt(),
  },
  (t) => [index('rounds_site_status_idx').on(t.siteId, t.status)],
);

export const allocations = sqliteTable(
  'allocations',
  {
    id: id(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    bayId: text('bay_id').references(() => bays.id),
    outcome: text('outcome', { enum: ALLOCATION_OUTCOMES }).notNull(),
    rank: integer('rank').notNull(),
    score: real('score').notNull(),
    scoreBreakdownJson: text('score_breakdown_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    fallbackUsed: integer('fallback_used', { mode: 'boolean' }).notNull().default(false),
    capReached: integer('cap_reached', { mode: 'boolean' }).notNull().default(false),
    reasonText: text('reason_text'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('allocations_round_request_uq').on(t.roundId, t.requestId),
    index('allocations_round_idx').on(t.roundId),
  ],
);

export const bookings = sqliteTable(
  'bookings',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    bayId: text('bay_id')
      .notNull()
      .references(() => bays.id),
    date: isoDate('date').notNull(),
    status: text('status', { enum: BOOKING_STATUSES }).notNull().default('confirmed'),
    allocationId: text('allocation_id').references(() => allocations.id),
    lateExtensionUsed: integer('late_extension_used', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Non-negotiable #1: never over-book. One bay-holding booking per bay per day.
    uniqueIndex('bookings_bay_date_active_uq')
      .on(t.bayId, t.date)
      .where(sql`status in ('confirmed', 'checked_in')`),
    // An employee holds at most one bay per day.
    uniqueIndex('bookings_user_date_active_uq')
      .on(t.userId, t.date)
      .where(sql`status in ('confirmed', 'checked_in')`),
    index('bookings_site_date_status_idx').on(t.siteId, t.date, t.status),
  ],
);

export const waitlist = sqliteTable(
  'waitlist',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    date: isoDate('date').notNull(),
    bayType: text('bay_type', { enum: BAY_TYPES }).notNull(),
    requestId: text('request_id')
      .notNull()
      .unique()
      .references(() => requests.id),
    position: integer('position').notNull(),
    capReached: integer('cap_reached', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('waitlist_site_date_type_idx').on(t.siteId, t.date, t.bayType, t.position)],
);

export const offers = sqliteTable(
  'offers',
  {
    id: id(),
    waitlistId: text('waitlist_id')
      .notNull()
      .references(() => waitlist.id),
    bayId: text('bay_id')
      .notNull()
      .references(() => bays.id),
    expiresAt: timestamp('expires_at').notNull(),
    status: text('status', { enum: OFFER_STATUSES }).notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('offers_status_expires_idx').on(t.status, t.expiresAt)],
);

export const overrides = sqliteTable('overrides', {
  id: id(),
  allocationId: text('allocation_id')
    .notNull()
    .references(() => allocations.id),
  adminId: text('admin_id')
    .notNull()
    .references(() => users.id),
  beforeJson: text('before_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  afterJson: text('after_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
});

/** P1 (FR-31). */
export const appeals = sqliteTable('appeals', {
  id: id(),
  siteId: text('site_id')
    .notNull()
    .references(() => sites.id),
  allocationId: text('allocation_id').references(() => allocations.id),
  bookingId: text('booking_id').references(() => bookings.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  text: text('text').notNull(),
  status: text('status', { enum: APPEAL_STATUSES }).notNull().default('open'),
  resolvedBy: text('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: createdAt(),
});
