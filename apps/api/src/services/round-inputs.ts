/**
 * Load everything the pure engine needs for a round (ADR-003: services load all inputs
 * before calling the engine). Nothing here decides an allocation.
 */
import type { AllocateInput, EngineHistory, EnginePerson } from '@parksmart/engine';
import {
  and,
  approvals,
  asc,
  bayBlocks,
  bays,
  bookings,
  type Db,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  offers,
  requests,
  rounds,
  userProfiles,
  vehicles,
} from '@parksmart/db';
import {
  addDays,
  BAY_HOLDING_BOOKING_STATUSES,
  isoWeekday,
  siteLocalDate,
  weekStart,
  type IsoDate,
  type RequestStatus,
  type RoundType,
} from '@parksmart/shared';
import { policyVersionForWeek } from './policy';
import { loadSite } from './site';

/** Booking statuses that count as having won a bay (for fairness and no-show history). */
const WON_STATUSES = ['confirmed', 'checked_in', 'released', 'auto_released'] as const;

/** Which requests each round collects (docs/03 §1). */
const COLLECTS: Record<RoundType, RequestStatus[]> = {
  weekly: ['requested'],
  daily: ['requested', 'waitlisted'],
  same_day: ['requested', 'waitlisted'],
};

export type RoundInputs = {
  input: AllocateInput;
  policyVersionId: string;
};

export async function buildRoundInputs(
  db: Db,
  opts: { siteId: string; type: RoundType; dates: IsoDate[]; seed: string; now: Date },
): Promise<RoundInputs> {
  const { siteId, type, dates } = opts;
  const site = await loadSite(db, siteId);
  const week = weekStart(dates[0]!);
  const { version, rules } = await policyVersionForWeek(db, siteId, week);

  // Requests. Same-day: skip anyone holding an open offer (they are already being served).
  const withOpenOffer = new Set(
    (
      await db
        .select({ requestId: offers.requestId })
        .from(offers)
        .innerJoin(requests, eq(requests.id, offers.requestId))
        .where(and(eq(offers.status, 'open'), inArray(requests.date, dates)))
        .all()
    ).map((r) => r.requestId),
  );
  const reqRows = (
    await db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.siteId, siteId),
          inArray(requests.date, dates),
          inArray(requests.status, COLLECTS[type]),
        ),
      )
      .orderBy(asc(requests.id))
      .all()
  ).filter((r) => !withOpenOffer.has(r.id));

  // Bays and what is unavailable on each date: blocks, held bookings, open offers.
  const bayRows = await db
    .select()
    .from(bays)
    .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
    .all();
  const unavailable: { bayId: string; date: IsoDate }[] = [];
  const blocks = await db
    .select()
    .from(bayBlocks)
    .where(
      and(
        eq(bayBlocks.siteId, siteId),
        isNull(bayBlocks.deletedAt),
        lte(bayBlocks.dateFrom, dates.at(-1)!),
        gte(bayBlocks.dateTo, dates[0]!),
      ),
    )
    .all();
  for (const date of dates) {
    for (const b of blocks.filter((x) => x.dateFrom <= date && x.dateTo >= date)) {
      for (const bay of bayRows.filter((x) => x.id === b.bayId || x.zoneId === b.zoneId)) {
        unavailable.push({ bayId: bay.id, date });
      }
    }
  }
  for (const b of await db
    .select({ bayId: bookings.bayId, date: bookings.date })
    .from(bookings)
    .where(
      and(
        eq(bookings.siteId, siteId),
        inArray(bookings.date, dates),
        inArray(bookings.status, [...BAY_HOLDING_BOOKING_STATUSES]),
      ),
    )
    .all()) {
    unavailable.push(b);
  }
  for (const o of await db
    .select({ bayId: offers.bayId, date: requests.date })
    .from(offers)
    .innerJoin(requests, eq(requests.id, offers.requestId))
    .where(and(eq(offers.status, 'open'), inArray(requests.date, dates)))
    .all()) {
    unavailable.push(o);
  }

  // People and history, only for employees in this round.
  const userIds = [...new Set(reqRows.map((r) => r.userId))];
  const people: EnginePerson[] = [];
  const history: EngineHistory[] = [];
  if (userIds.length > 0) {
    const profiles = new Map(
      (await db.select().from(userProfiles).where(inArray(userProfiles.userId, userIds)).all()).map(
        (p) => [p.userId, p],
      ),
    );
    const evOwners = new Set(
      (
        await db
          .select({ userId: vehicles.userId })
          .from(vehicles)
          .where(and(inArray(vehicles.userId, userIds), eq(vehicles.isEv, true)))
          .all()
      ).map((v) => v.userId),
    );
    const approvalThrough = new Map<string, IsoDate>();
    for (const a of await db
      .select()
      .from(approvals)
      .where(
        and(
          inArray(approvals.userId, userIds),
          eq(approvals.kind, 'accessible'),
          isNull(approvals.revokedAt),
        ),
      )
      .all()) {
      const through = siteLocalDate(new Date(a.expiresAt.getTime() - 1), site.timezone);
      if (through > (approvalThrough.get(a.userId) ?? '')) approvalThrough.set(a.userId, through);
    }
    for (const userId of userIds) {
      const p = profiles.get(userId);
      people.push({
        userId,
        isEv: evOwners.has(userId),
        accessibleApprovedThrough: approvalThrough.get(userId) ?? null,
        distanceBand: p?.distanceBand ?? null,
        clientFacing: p?.clientFacing ?? null,
        joinDate: p?.joinDate ?? null,
      });
    }

    const fairness = rules.find((r) => r.key === 'rolling_fairness');
    const cap = rules.find((r) => r.key === 'peak_day_cap');
    const noShow = rules.find((r) => r.key === 'no_show_history');
    const capDays = (cap?.config.peakWeekdays as number[] | undefined) ?? [2, 3, 4];
    const fairnessDays = (fairness?.config.peakWeekdays as number[] | undefined) ?? capDays;
    const fairnessFrom = addDays(week, -7 * Number(fairness?.config.lookbackWeeks ?? 4));
    const noShowFrom = addDays(week, -7 * Number(noShow?.config.lookbackWeeks ?? 4));
    const earliest = fairnessFrom < noShowFrom ? fairnessFrom : noShowFrom;
    const won = await db
      .select({ userId: bookings.userId, date: bookings.date, status: bookings.status })
      .from(bookings)
      .where(
        and(
          inArray(bookings.userId, userIds),
          gte(bookings.date, earliest),
          lt(bookings.date, addDays(week, 7)),
          inArray(bookings.status, [...WON_STATUSES]),
        ),
      )
      .all();
    for (const userId of userIds) {
      const mine = won.filter((b) => b.userId === userId);
      const past = (from: IsoDate) => mine.filter((b) => b.date >= from && b.date < week);
      history.push({
        userId,
        peakDaysWon: past(fairnessFrom).filter((b) => fairnessDays.includes(isoWeekday(b.date)))
          .length,
        peakDaysWonThisWeek: mine.filter(
          (b) => b.date >= week && capDays.includes(isoWeekday(b.date)),
        ).length,
        bookings: past(noShowFrom).length,
        noShows: past(noShowFrom).filter((b) => b.status === 'auto_released').length,
      });
    }
  }

  // Weeks of pilot data: whole weeks since the first published round's first day.
  const first = await db
    .select({ from: rounds.targetDateFrom })
    .from(rounds)
    .where(and(eq(rounds.siteId, siteId), eq(rounds.status, 'published')))
    .orderBy(asc(rounds.targetDateFrom))
    .get();
  const weeksOfData = first
    ? Math.max(
        0,
        Math.floor((Date.parse(week) - Date.parse(weekStart(first.from))) / (7 * 86_400_000)),
      )
    : 0;

  return {
    policyVersionId: version.id,
    input: {
      round: { type, dates },
      requests: reqRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        date: r.date,
        bayType: r.bayType,
        allowFallback: r.allowFallback,
        reasonCategory: r.reasonCategory,
        // submittedAt is deliberately NOT passed: it is never scored (non-negotiable #2).
      })),
      bays: bayRows.map((b) => ({ id: b.id, code: b.code, bayType: b.bayType, zoneId: b.zoneId })),
      unavailable,
      people,
      history,
      policy: {
        versionId: version.id,
        rules,
        maxFactorWeightPercent: site.settings.maxFactorWeightPercent,
        sameDayPoolPercent: site.settings.sameDayPoolPercent,
        evOverflowSameDay: site.settings.evOverflowSameDay,
        weeksOfData,
      },
      seed: opts.seed,
    },
  };
}
