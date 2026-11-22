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

async function siteTypes(db: Db, siteId: string): Promise<Set<BayType>> {
  return new Set(
    (
      await db
        .selectDistinct({ t: bays.bayType })
        .from(bays)
        .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
        .all()
    ).map((r) => r.t),
  );
}

/**
 * Create requests from active patterns for the week starting `week` (a Monday).
 * Idempotent: skips dates that already have an active request, are skipped, closed,
 * or the employee is no longer eligible for. Returns how many requests were created.
 */
export async function expandPatterns(
  db: Db,
  opts: { siteId: string; week: IsoDate; now: Date; patternId?: string },
): Promise<number> {
  const site = await loadSite(db, opts.siteId);
  const types = await siteTypes(db, opts.siteId);
  const patterns = await db
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
  await db.transaction(async (tx) => {
    for (const p of patterns) {
      const skipped = new Set(
        (
          await tx
            .select({ date: recurringSkips.date })
            .from(recurringSkips)
            .where(eq(recurringSkips.patternId, p.id))
            .all()
        ).map((s) => s.date),
      );
      const taken = new Set(
        (
          await tx
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
        ).map((r) => r.date),
      );
      const eligibility = await eligibilityOf(db, p.userId, site, opts.now);
      for (const date of dates) {
        if (!p.weekdaysJson.includes(isoWeekday(date)) || skipped.has(date) || taken.has(date))
          continue;
        if (
          !decidingRound({ date, now: opts.now, timeZone: site.timezone, settings: site.settings })
            .open
        )
          continue;
        if (typeProblem(p.bayType, date, types, eligibility)) continue;
        await tx
          .insert(requests)
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
const feedWeek = async (db: Db, siteId: string, now: Date) => {
  const site = await loadSite(db, siteId);
  return nextWeeklyRound(now, site.timezone, site.settings.rounds.weekly).targetWeek;
};

/** Withdraw undecided, still-editable requests this pattern created (before re-expanding). */
async function withdrawOpenPatternRequests(db: Db, pattern: PatternRow, now: Date): Promise<void> {
  const site = await loadSite(db, pattern.siteId);
  const today = siteLocalDate(now, site.timezone);
  const open = (
    await db
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
  ).filter(
    (r) =>
      decidingRound({ date: r.date, now, timeZone: site.timezone, settings: site.settings }).open,
  );
  if (open.length) {
    await db
      .update(requests)
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

async function ownPattern(db: Db, actor: Actor, id: string): Promise<PatternRow> {
  const row = await db.select().from(recurringPatterns).where(eq(recurringPatterns.id, id)).get();
  if (!row || row.userId !== actor.id) throw notFound('Recurring pattern');
  return row;
}

async function validate(
  db: Db,
  actor: Actor,
  input: PatternInput,
  now: Date,
  ignoreId?: string,
): Promise<void> {
  const site = await loadSite(db, actor.siteId);
  const off = input.weekdays.filter((d) => !site.settings.workingDays.includes(d));
  if (off.length) throw businessRule('NOT_WORKING_DAY', 'Patterns can only include working days.');
  const today = siteLocalDate(now, site.timezone);
  const issue = typeProblem(
    input.bayType,
    today,
    await siteTypes(db, actor.siteId),
    await eligibilityOf(db, actor.id, site, now),
  );
  if (issue) throw businessRule(issue.code, issue.message);
  const overlapping = (
    await db
      .select()
      .from(recurringPatterns)
      .where(and(eq(recurringPatterns.userId, actor.id), eq(recurringPatterns.active, true)))
      .all()
  ).filter((p) => p.id !== ignoreId && p.weekdaysJson.some((d) => input.weekdays.includes(d)));
  if (overlapping.length)
    throw conflict('Another active pattern already covers one of these days.');
}

export async function listPatterns(db: Db, actor: Actor, now: Date): Promise<RecurringPattern[]> {
  const site = await loadSite(db, actor.siteId);
  const today = siteLocalDate(now, site.timezone);
  // Days in weeks whose weekly round already ran can't be fed by the pattern, so start
  // at the next weekly round's target week.
  const first = await feedWeek(db, actor.siteId, now);
  const window = Array.from({ length: UPCOMING_WEEKS * 7 }, (_, i) => addDays(first, i)).filter(
    (d) => d >= today && isWorkingDay(d, site.settings.workingDays),
  );
  const patterns = await db
    .select()
    .from(recurringPatterns)
    .where(eq(recurringPatterns.userId, actor.id))
    .all();
  const mine = await db
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
  const out = [];
  for (const p of patterns) {
    const skipRows = await db
      .select({ date: recurringSkips.date })
      .from(recurringSkips)
      .where(eq(recurringSkips.patternId, p.id))
      .all();
    const skips = new Set(skipRows.map((s) => s.date));
    out.push({
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
    });
  }
  return out;
}

export async function createPattern(
  db: Db,
  actor: Actor,
  input: PatternInput,
  now: Date,
): Promise<RecurringPattern> {
  await assertConsent(db, actor.id);
  await validate(db, actor, input, now);
  const id = (
    await db
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
      .get()
  ).id;
  await expandPatterns(db, {
    siteId: actor.siteId,
    week: await feedWeek(db, actor.siteId, now),
    now,
    patternId: id,
  });
  return (await listPatterns(db, actor, now)).find((p) => p.id === id)!;
}

export async function updatePattern(
  db: Db,
  actor: Actor,
  id: string,
  patch: Partial<PatternInput> & { active?: boolean },
  now: Date,
): Promise<RecurringPattern> {
  const row = await ownPattern(db, actor, id);
  const next: PatternInput = {
    weekdays: patch.weekdays ?? row.weekdaysJson,
    bayType: patch.bayType ?? row.bayType,
    arrivalWindow: patch.arrivalWindow ?? row.arrivalWindow,
    allowFallback: patch.allowFallback ?? row.allowFallback,
  };
  const active = patch.active ?? row.active;
  if (active) await validate(db, actor, next, now, id);
  await withdrawOpenPatternRequests(db, row, now);
  await db
    .update(recurringPatterns)
    .set({ ...next, weekdaysJson: [...next.weekdays].sort(), active })
    .where(eq(recurringPatterns.id, id))
    .run();
  if (active)
    await expandPatterns(db, {
      siteId: actor.siteId,
      week: await feedWeek(db, actor.siteId, now),
      now,
      patternId: id,
    });
  return (await listPatterns(db, actor, now)).find((p) => p.id === id)!;
}

export async function skipDate(
  db: Db,
  actor: Actor,
  id: string,
  date: IsoDate,
  now: Date,
): Promise<RecurringPattern> {
  const row = await ownPattern(db, actor, id);
  const site = await loadSite(db, actor.siteId);
  if (date < siteLocalDate(now, site.timezone))
    throw businessRule('PAST_DATE', 'That day has passed.');
  if (!row.weekdaysJson.includes(isoWeekday(date))) {
    throw businessRule('NOT_PATTERN_DAY', 'This pattern does not cover that day.');
  }
  const req = await db
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
  await db.transaction(async (tx) => {
    await tx.insert(recurringSkips).values({ patternId: id, date }).onConflictDoNothing().run();
    // FR-3: a skip withdraws that day's request at once.
    if (req)
      await tx.update(requests).set({ status: 'withdrawn' }).where(eq(requests.id, req.id)).run();
  });
  return (await listPatterns(db, actor, now)).find((p) => p.id === id)!;
}

export async function unskipDate(
  db: Db,
  actor: Actor,
  id: string,
  date: IsoDate,
  now: Date,
): Promise<RecurringPattern> {
  const row = await ownPattern(db, actor, id);
  await db
    .delete(recurringSkips)
    .where(and(eq(recurringSkips.patternId, id), eq(recurringSkips.date, date)))
    .run();
  // Recreate the request if that week is still open to the pattern.
  const site = await loadSite(db, actor.siteId);
  const week = addDays(date, 1 - isoWeekday(date));
  if (
    row.active &&
    decidingRound({ date, now, timeZone: site.timezone, settings: site.settings }).open
  ) {
    await expandPatterns(db, { siteId: actor.siteId, week, now, patternId: id });
  }
  return (await listPatterns(db, actor, now)).find((p) => p.id === id)!;
}
