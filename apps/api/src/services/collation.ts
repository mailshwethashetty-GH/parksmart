/**
 * Collation view (FR-7) and the admin rounds list. Read-only.
 */
import {
  allocations,
  and,
  bayBlocks,
  bays,
  bookings,
  count,
  type Db,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  requests,
  rounds,
  waitlist,
} from '@parksmart/db';
import {
  ACTIVE_REQUEST_STATUSES,
  addDays,
  BAY_HOLDING_BOOKING_STATUSES,
  isWorkingDay,
  siteLocalDate,
  type BayType,
  type CollationResponse,
  type IsoDate,
  type RoundSummary,
} from '@parksmart/shared';
import { loadSite } from './site';

const POOL_TYPES: BayType[] = ['car', 'ev'];
const FORECAST_WEEKS = 4;

export async function getCollation(
  db: Db,
  siteId: string,
  now: Date,
  from: IsoDate | undefined,
  days: number,
): Promise<CollationResponse> {
  const site = await loadSite(db, siteId);
  const today = siteLocalDate(now, site.timezone);
  const start = from ?? today;
  const dates: IsoDate[] = [];
  for (let d = start; dates.length < days; d = addDays(d, 1)) {
    if (isWorkingDay(d, site.settings.workingDays)) dates.push(d);
  }
  const end = dates.at(-1)!;

  const bayRows = await db
    .select()
    .from(bays)
    .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
    .all();
  const types = [...new Set(bayRows.map((b) => b.bayType))].sort();
  const blocks = await db
    .select()
    .from(bayBlocks)
    .where(
      and(
        eq(bayBlocks.siteId, siteId),
        isNull(bayBlocks.deletedAt),
        lte(bayBlocks.dateFrom, end),
        gte(bayBlocks.dateTo, start),
      ),
    )
    .all();
  const reqRows = await db
    .select({ date: requests.date, bayType: requests.bayType, status: requests.status })
    .from(requests)
    .where(
      and(
        eq(requests.siteId, siteId),
        inArray(requests.date, dates),
        inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]),
      ),
    )
    .all();
  const held = await db
    .select({ date: bookings.date, bayType: bays.bayType })
    .from(bookings)
    .innerJoin(bays, eq(bays.id, bookings.bayId))
    .where(
      and(
        eq(bookings.siteId, siteId),
        inArray(bookings.date, dates),
        inArray(bookings.status, [...BAY_HOLDING_BOOKING_STATUSES]),
      ),
    )
    .all();
  const waiting = await db
    .select({ date: waitlist.date, bayType: waitlist.bayType })
    .from(waitlist)
    .where(and(eq(waitlist.siteId, siteId), inArray(waitlist.date, dates)))
    .all();

  // Forecast: final request counts for the same weekday in the previous weeks.
  const pastDates = dates.flatMap((d) =>
    Array.from({ length: FORECAST_WEEKS }, (_, i) => addDays(d, -7 * (i + 1))),
  );
  const past = await db
    .select({ date: requests.date, bayType: requests.bayType, n: count() })
    .from(requests)
    .where(
      and(
        eq(requests.siteId, siteId),
        inArray(requests.date, pastDates),
        ne(requests.status, 'withdrawn'),
      ),
    )
    .groupBy(requests.date, requests.bayType)
    .all();
  const firstData = await db
    .select({ date: requests.date })
    .from(requests)
    .where(eq(requests.siteId, siteId))
    .orderBy(requests.date)
    .get();

  const roundRows = await db
    .select({
      id: rounds.id,
      roundType: rounds.roundType,
      status: rounds.status,
      from: rounds.targetDateFrom,
      to: rounds.targetDateTo,
    })
    .from(rounds)
    .where(
      and(
        eq(rounds.siteId, siteId),
        lte(rounds.targetDateFrom, end),
        gte(rounds.targetDateTo, start),
      ),
    )
    .all();

  return {
    days: dates.map((date) => ({
      date,
      rounds: roundRows
        .filter((r) => r.from <= date && r.to >= date)
        .map((r) => ({ id: r.id, roundType: r.roundType, status: r.status })),
      cells: types.map((bayType) => {
        const ofType = bayRows.filter((b) => b.bayType === bayType);
        const blocked = ofType.filter((b) =>
          blocks.some(
            (x) =>
              x.dateFrom <= date && x.dateTo >= date && (x.bayId === b.id || x.zoneId === b.zoneId),
          ),
        ).length;
        const supply = ofType.length - blocked;
        const heldForSameDay = POOL_TYPES.includes(bayType)
          ? Math.min(supply, Math.floor((ofType.length * site.settings.sameDayPoolPercent) / 100))
          : 0;
        const requested = reqRows.filter((r) => r.date === date && r.bayType === bayType).length;
        const allocatable = supply - heldForSameDay;
        const history = Array.from({ length: FORECAST_WEEKS }, (_, i) =>
          addDays(date, -7 * (i + 1)),
        ).filter(
          // Only finished days count: their request totals are final.
          (d) => firstData && d >= firstData.date && d < today,
        );
        const expected = history.length
          ? history.reduce(
              (sum, d) => sum + (past.find((p) => p.date === d && p.bayType === bayType)?.n ?? 0),
              0,
            ) / history.length
          : null;
        return {
          bayType,
          supply,
          heldForSameDay,
          requests: requested,
          confirmed: held.filter((h) => h.date === date && h.bayType === bayType).length,
          waitlisted: waiting.filter((w) => w.date === date && w.bayType === bayType).length,
          oversubscription:
            allocatable > 0 ? Math.round((requested / allocatable) * 100) / 100 : null,
          forecastRemaining:
            expected === null ? null : Math.max(0, Math.round(expected - requested)),
        };
      }),
    })),
  };
}

export async function listRounds(
  db: Db,
  siteId: string,
  now: Date,
  status: 'pending_review' | 'published' | undefined,
  limit: number,
): Promise<RoundSummary[]> {
  const rows = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.siteId, siteId), status ? eq(rounds.status, status) : undefined))
    .orderBy(desc(rounds.runAt))
    .limit(limit)
    .all();
  const tallies = rows.length
    ? await db
        .select({ roundId: allocations.roundId, outcome: allocations.outcome, n: count() })
        .from(allocations)
        .where(
          inArray(
            allocations.roundId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(allocations.roundId, allocations.outcome)
        .all()
    : [];
  const tally = (roundId: string, outcome: string) =>
    tallies.find((t) => t.roundId === roundId && t.outcome === outcome)?.n ?? 0;
  return rows.map((r) => ({
    id: r.id,
    roundType: r.roundType,
    targetDateFrom: r.targetDateFrom,
    targetDateTo: r.targetDateTo,
    status: r.status,
    runAt: r.runAt?.toISOString() ?? null,
    approvalDeadline: r.approvalDeadline?.toISOString() ?? null,
    delayed:
      r.status === 'pending_review' &&
      !!r.approvalDeadline &&
      now.getTime() > r.approvalDeadline.getTime(),
    publishMode: r.publishMode,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    counts: {
      confirmed: tally(r.id, 'confirmed'),
      waitlisted: tally(r.id, 'waitlisted'),
      ineligible: tally(r.id, 'ineligible'),
    },
  }));
}
