/**
 * Recurring weekly patterns (FR-3). A pattern feeds every weekly round: requests are
 * created for the week the next weekly round will allocate. Skipping a day withdraws
 * that day's request at once. Manual requests always win over the pattern.
 */
import {
  and,
  bays,
  type Db,
  eq,
  gte,
  inArray,
  recurringPatterns,
  recurringSkips,
  requests,
} from '@parksmart/db';
import {
  ACTIVE_REQUEST_STATUSES,
  addDays,
  decidingRound,
  isoWeekday,
  isWorkingDay,
  nextWeeklyRound,
  siteLocalDate,
  type ArrivalWindow,
  type BayType,
  type IsoDate,
  type RecurringPattern,
} from '@parksmart/shared';
import { businessRule, conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { eligibilityOf, typeProblem } from './requests';
import { assertConsent } from './me-profile';
import { loadSite } from './site';

type PatternRow = typeof recurringPatterns.$inferSelect;
type PatternInput = {
  weekdays: number[];
  bayType: BayType;
  arrivalWindow: ArrivalWindow;
  allowFallback: boolean;
};

/** Weeks of upcoming pattern days shown, starting at the week the pattern can still feed. */
const UPCOMING_WEEKS = 3;

function siteTypes(db: Db, siteId: string): Set<BayType> {
  return new Set(
    db
      .selectDistinct({ t: bays.bayType })
      .from(bays)
      .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
      .all()
      .map((r) => r.t),
  );
}

/**
 * Create requests from active patterns for the week starting `week` (a Monday).
 * Idempotent: skips dates that already have an active request, are skipped, closed,
 * or the employee is no longer eligible for. Returns how many requests were created.
 */
export function expandPatterns(
  db: Db,
  opts: { siteId: string; week: IsoDate; now: Date; patternId?: string },
): number {
  const site = loadSite(db, opts.siteId);
  const types = siteTypes(db, opts.siteId);
  const patterns = db
    .select()
    .from(recurringPatterns)
    .where(
      and(
        eq(recurringPatterns.siteId, opts.siteId),
        eq(recurringPatterns.active, true),
        opts.patternId ? eq(recurringPatterns.id, opts.patternId) : undefined,
      ),
    )
    .all();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(opts.week, i));
  let created = 0;
  db.transaction((tx) => {
    for (const p of patterns) {
      const skipped = new Set(
        tx
          .select({ date: recurringSkips.date })
          .from(recurringSkips)
          .where(eq(recurringSkips.patternId, p.id))
          .all()
          .map((s) => s.date),
      );
      const taken = new Set(
        tx
          .select({ date: requests.date })
          .from(requests)
          .where(
            and(
              eq(requests.userId, p.userId),
              inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]),
              inArray(requests.date, dates),
            ),
          )
          .all()
          .map((r) => r.date),
      );
      const eligibility = eligibilityOf(db, p.userId, site, opts.now);
      for (const date of dates) {
        if (!p.weekdaysJson.includes(isoWeekday(date)) || skipped.has(date) || taken.has(date))
          continue;
        if (
          !decidingRound({ date, now: opts.now, timeZone: site.timezone, settings: site.settings })
            .open
        )
          continue;
        if (typeProblem(p.bayType, date, types, eligibility)) continue;
        tx.insert(requests)
          .values({
            orgId: p.orgId,
            siteId: p.siteId,
            userId: p.userId,
            date,
            bayType: p.bayType,
            arrivalWindow: p.arrivalWindow,
            allowFallback: p.allowFallback,
            status: 'requested',
            submittedAt: opts.now,
            recurringPatternId: p.id,
          })
          .run();
        created++;
      }
    }
  });
  return created;
}

/** The week a pattern change can still feed: the next weekly round's target week. */
const feedWeek = (db: Db, siteId: string, now: Date) => {
  const site = loadSite(db, siteId);
  return nextWeeklyRound(now, site.timezone, site.settings.rounds.weekly).targetWeek;
};

/** Withdraw undecided, still-editable requests this pattern created (before re-expanding). */
function withdrawOpenPatternRequests(db: Db, pattern: PatternRow, now: Date): void {
  const site = loadSite(db, pattern.siteId);
  const today = siteLocalDate(now, site.timezone);
  const open = db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.recurringPatternId, pattern.id),
        eq(requests.status, 'requested'),
        gte(requests.date, today),
      ),
    )
    .all()
    .filter(
      (r) =>
        decidingRound({ date: r.date, now, timeZone: site.timezone, settings: site.settings }).open,
    );
  if (open.length) {
    db.update(requests)
      .set({ status: 'withdrawn' })
      .where(
        inArray(
          requests.id,
          open.map((r) => r.id),
        ),
      )
      .run();
  }
}

function ownPattern(db: Db, actor: Actor, id: string): PatternRow {
  const row = db.select().from(recurringPatterns).where(eq(recurringPatterns.id, id)).get();
  if (!row || row.userId !== actor.id) throw notFound('Recurring pattern');
  return row;
}

function validate(db: Db, actor: Actor, input: PatternInput, now: Date, ignoreId?: string): void {
  const site = loadSite(db, actor.siteId);
  const off = input.weekdays.filter((d) => !site.settings.workingDays.includes(d));
  if (off.length) throw businessRule('NOT_WORKING_DAY', 'Patterns can only include working days.');
  const today = siteLocalDate(now, site.timezone);
  const issue = typeProblem(
    input.bayType,
    today,
    siteTypes(db, actor.siteId),
    eligibilityOf(db, actor.id, site, now),
  );
  if (issue) throw businessRule(issue.code, issue.message);
  const overlapping = db
    .select()
    .from(recurringPatterns)
    .where(and(eq(recurringPatterns.userId, actor.id), eq(recurringPatterns.active, true)))
    .all()
    .filter((p) => p.id !== ignoreId && p.weekdaysJson.some((d) => input.weekdays.includes(d)));
  if (overlapping.length)
    throw conflict('Another active pattern already covers one of these days.');
}

export function listPatterns(db: Db, actor: Actor, now: Date): RecurringPattern[] {
  const site = loadSite(db, actor.siteId);
  const today = siteLocalDate(now, site.timezone);
  // Days in weeks whose weekly round already ran can't be fed by the pattern, so start
  // at the next weekly round's target week.
  const first = feedWeek(db, actor.siteId, now);
  const window = Array.from({ length: UPCOMING_WEEKS * 7 }, (_, i) => addDays(first, i)).filter(
    (d) => d >= today && isWorkingDay(d, site.settings.workingDays),
  );
  const patterns = db
    .select()
    .from(recurringPatterns)
    .where(eq(recurringPatterns.userId, actor.id))
    .all();
  const mine = db
    .select({
      date: requests.date,
      status: requests.status,
      patternId: requests.recurringPatternId,
    })
    .from(requests)
    .where(
      and(
        eq(requests.userId, actor.id),
        inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]),
        gte(requests.date, today),
      ),
    )
    .all();
  return patterns.map((p) => {
    const skips = new Set(
      db
        .select({ date: recurringSkips.date })
        .from(recurringSkips)
        .where(eq(recurringSkips.patternId, p.id))
        .all()
        .map((s) => s.date),
    );
    return {
      id: p.id,
      weekdays: [...p.weekdaysJson].sort(),
      bayType: p.bayType,
      arrivalWindow: p.arrivalWindow,
      allowFallback: p.allowFallback,
      active: p.active,
      upcoming: p.active
        ? window
            .filter((d) => p.weekdaysJson.includes(isoWeekday(d)))
            .map((date) => ({
              date,
              skipped: skips.has(date),
              requestStatus:
                mine.find((r) => r.date === date && r.patternId === p.id)?.status ?? null,
            }))
        : [],
    };
  });
}

export function createPattern(
  db: Db,
  actor: Actor,
  input: PatternInput,
  now: Date,
): RecurringPattern {
  assertConsent(db, actor.id);
  validate(db, actor, input, now);
  const id = db
    .insert(recurringPatterns)
    .values({
      orgId: actor.orgId,
      siteId: actor.siteId,
      userId: actor.id,
      weekdaysJson: [...input.weekdays].sort(),
      bayType: input.bayType,
      arrivalWindow: input.arrivalWindow,
      allowFallback: input.allowFallback,
    })
    .returning({ id: recurringPatterns.id })
    .get().id;
  expandPatterns(db, {
    siteId: actor.siteId,
    week: feedWeek(db, actor.siteId, now),
    now,
    patternId: id,
  });
  return listPatterns(db, actor, now).find((p) => p.id === id)!;
}

export function updatePattern(
  db: Db,
  actor: Actor,
  id: string,
  patch: Partial<PatternInput> & { active?: boolean },
  now: Date,
): RecurringPattern {
  const row = ownPattern(db, actor, id);
  const next: PatternInput = {
    weekdays: patch.weekdays ?? row.weekdaysJson,
    bayType: patch.bayType ?? row.bayType,
    arrivalWindow: patch.arrivalWindow ?? row.arrivalWindow,
    allowFallback: patch.allowFallback ?? row.allowFallback,
  };
  const active = patch.active ?? row.active;
  if (active) validate(db, actor, next, now, id);
  withdrawOpenPatternRequests(db, row, now);
  db.update(recurringPatterns)
    .set({ ...next, weekdaysJson: [...next.weekdays].sort(), active })
    .where(eq(recurringPatterns.id, id))
    .run();
  if (active)
    expandPatterns(db, {
      siteId: actor.siteId,
      week: feedWeek(db, actor.siteId, now),
      now,
      patternId: id,
    });
  return listPatterns(db, actor, now).find((p) => p.id === id)!;
}

export function skipDate(
  db: Db,
  actor: Actor,
  id: string,
  date: IsoDate,
  now: Date,
): RecurringPattern {
  const row = ownPattern(db, actor, id);
  const site = loadSite(db, actor.siteId);
  if (date < siteLocalDate(now, site.timezone))
    throw businessRule('PAST_DATE', 'That day has passed.');
  if (!row.weekdaysJson.includes(isoWeekday(date))) {
    throw businessRule('NOT_PATTERN_DAY', 'This pattern does not cover that day.');
  }
  const req = db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.recurringPatternId, id),
        eq(requests.date, date),
        inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]),
      ),
    )
    .get();
  if (req?.status === 'allocated')
    throw conflict('You have a bay that day. Cancel the booking instead.');
  db.transaction((tx) => {
    tx.insert(recurringSkips).values({ patternId: id, date }).onConflictDoNothing().run();
    // FR-3: a skip withdraws that day's request at once.
    if (req) tx.update(requests).set({ status: 'withdrawn' }).where(eq(requests.id, req.id)).run();
  });
  return listPatterns(db, actor, now).find((p) => p.id === id)!;
}

export function unskipDate(
  db: Db,
  actor: Actor,
  id: string,
  date: IsoDate,
  now: Date,
): RecurringPattern {
  const row = ownPattern(db, actor, id);
  db.delete(recurringSkips)
    .where(and(eq(recurringSkips.patternId, id), eq(recurringSkips.date, date)))
    .run();
  // Recreate the request if that week is still open to the pattern.
  const site = loadSite(db, actor.siteId);
  const week = addDays(date, 1 - isoWeekday(date));
  if (
    row.active &&
    decidingRound({ date, now, timeZone: site.timezone, settings: site.settings }).open
  ) {
    expandPatterns(db, { siteId: actor.siteId, week, now, patternId: id });
  }
  return listPatterns(db, actor, now).find((p) => p.id === id)!;
}
