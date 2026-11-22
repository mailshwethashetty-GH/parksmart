/**
 * Monthly report (FR-28, P0) with the pilot metrics from docs/01:
 * - peak-day utilisation (north star): bays used by a checked-in car, peak weekdays
 * - no-show rate: auto-released ÷ bookings that reached their day
 * - fairness spread: per employee, share of peak-day requests met; target ≥ 60%
 * - override rate: admin overrides ÷ decisions in weekly/daily rounds
 * - adoption: employees with at least one request ÷ active employees
 * Disputes need appeals (FR-31, P1) and are not reported yet.
 */
import {
  allocations,
  and,
  bays,
  bookings,
  eq,
  gte,
  inArray,
  lte,
  overrides,
  requests,
  rounds,
  users,
  type Db,
} from '@parksmart/db';
import {
  addDays,
  isoWeekday,
  isWorkingDay,
  siteLocalDate,
  weekStart,
  type IsoDate,
  type MonthlyReport,
} from '@parksmart/shared';
import { loadSite } from './site';
import { policyVersionForWeek } from './policy';

const WON = ['confirmed', 'checked_in', 'released', 'auto_released'] as const;
const USED = new Set(['checked_in', 'released']);
const FAIRNESS_TARGET = 0.6;

const ratio = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 1000) / 1000 : null;

function monthDays(month: string): IsoDate[] {
  const first = `${month}-01`;
  const days: IsoDate[] = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  return days;
}

function peakWeekdays(db: Db, siteId: string, date: IsoDate): number[] {
  try {
    const cap = policyVersionForWeek(db, siteId, weekStart(date)).rules.find(
      (r) => r.key === 'peak_day_cap',
    );
    return (cap?.config.peakWeekdays as number[] | undefined) ?? [2, 3, 4];
  } catch {
    return [2, 3, 4];
  }
}

export function monthlyReport(db: Db, siteId: string, month: string, now: Date): MonthlyReport {
  const site = loadSite(db, siteId);
  const today = siteLocalDate(now, site.timezone);
  const all = monthDays(month);
  const working = all.filter((d) => isWorkingDay(d, site.settings.workingDays));
  const past = working.filter((d) => d <= today);
  const peak = new Set(peakWeekdays(db, siteId, all[0]!));
  const activeBays = db
    .select({ id: bays.id })
    .from(bays)
    .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
    .all().length;

  const monthBookings = db
    .select({ userId: bookings.userId, date: bookings.date, status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.siteId, siteId),
        gte(bookings.date, all[0]!),
        lte(bookings.date, all.at(-1)!),
        inArray(bookings.status, [...WON]),
      ),
    )
    .all();
  const monthRequests = db
    .select({
      id: requests.id,
      userId: requests.userId,
      date: requests.date,
      status: requests.status,
    })
    .from(requests)
    .where(
      and(
        eq(requests.siteId, siteId),
        gte(requests.date, all[0]!),
        lte(requests.date, all.at(-1)!),
      ),
    )
    .all()
    .filter((r) => r.status !== 'withdrawn');

  const days = working.map((date) => {
    const b = monthBookings.filter((x) => x.date === date);
    const checkedIn = b.filter((x) => USED.has(x.status)).length;
    return {
      date,
      peak: peak.has(isoWeekday(date)),
      requests: monthRequests.filter((r) => r.date === date).length,
      confirmed: b.length,
      checkedIn,
      autoReleased: b.filter((x) => x.status === 'auto_released').length,
      utilisation: date <= today ? ratio(checkedIn, activeBays) : null,
    };
  });
  const pastDays = days.filter((d) => d.date <= today);
  const avg = (xs: (number | null)[]) => {
    const vals = xs.filter((x): x is number => x !== null);
    return vals.length
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000
      : null;
  };

  // Fairness: share of each employee's peak-day requests that won a bay.
  const shares: number[] = [];
  const byUser = new Map<string, { asked: number; met: number }>();
  for (const r of monthRequests.filter(
    (x) => past.includes(x.date) && peak.has(isoWeekday(x.date)),
  )) {
    const u = byUser.get(r.userId) ?? { asked: 0, met: 0 };
    u.asked++;
    if (monthBookings.some((b) => b.userId === r.userId && b.date === r.date)) u.met++;
    byUser.set(r.userId, u);
  }
  for (const u of byUser.values()) shares.push(u.met / u.asked);
  shares.sort((a, b) => a - b);

  // Overrides among decisions for this month's days in weekly/daily rounds. A round can
  // start in the previous month (the week of 30 Nov covers 1 Dec), so match by day.
  const roundIds = db
    .select({ id: rounds.id })
    .from(rounds)
    .where(
      and(
        eq(rounds.siteId, siteId),
        inArray(rounds.roundType, ['weekly', 'daily']),
        lte(rounds.targetDateFrom, all.at(-1)!),
        gte(rounds.targetDateTo, all[0]!),
      ),
    )
    .all()
    .map((r) => r.id);
  const decisionIds = roundIds.length
    ? db
        .select({ id: allocations.id, breakdown: allocations.scoreBreakdownJson })
        .from(allocations)
        .where(inArray(allocations.roundId, roundIds))
        .all()
        .filter((a) => (a.breakdown as { date: string }).date.startsWith(month))
        .map((a) => a.id)
    : [];
  const overrideCount = decisionIds.length
    ? new Set(
        db
          .select({ id: overrides.allocationId })
          .from(overrides)
          .where(inArray(overrides.allocationId, decisionIds))
          .all()
          .map((o) => o.id),
      ).size
    : 0;

  const activeEmployees = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteId, siteId), eq(users.role, 'employee'), eq(users.active, true)))
    .all().length;
  const requesters = new Set(monthRequests.map((r) => r.userId)).size;
  const reached = monthBookings.filter((b) => past.includes(b.date));

  return {
    month,
    activeBays,
    metrics: {
      peakUtilisation: avg(pastDays.filter((d) => d.peak).map((d) => d.utilisation)),
      utilisation: avg(pastDays.map((d) => d.utilisation)),
      noShowRate: ratio(
        reached.filter((b) => b.status === 'auto_released').length,
        reached.filter((b) => b.status !== 'confirmed').length,
      ),
      overrideRate: ratio(overrideCount, decisionIds.length),
      overrides: overrideCount,
      decisions: decisionIds.length,
      fairness: {
        employees: shares.length,
        belowTarget: shares.filter((x) => x < FAIRNESS_TARGET).length,
        minShare: shares.length ? Math.round(shares[0]! * 1000) / 1000 : null,
        medianShare: shares.length
          ? Math.round(shares[Math.floor((shares.length - 1) / 2)]! * 1000) / 1000
          : null,
      },
      adoption: {
        employees: requesters,
        activeEmployees,
        share: ratio(requesters, activeEmployees),
      },
      requests: monthRequests.length,
      confirmed: monthBookings.length,
      autoReleased: monthBookings.filter((b) => b.status === 'auto_released').length,
    },
    days,
  };
}

const pct = (x: number | null) => (x === null ? '' : `${Math.round(x * 1000) / 10}%`);

/** One-click monthly export (FR-28): summary rows, then one row per working day. */
export function monthlyReportCsv(report: MonthlyReport): string {
  const m = report.metrics;
  const summary: [string, string | number][] = [
    ['Month', report.month],
    ['Active bays', report.activeBays],
    ['Peak-day utilisation', pct(m.peakUtilisation)],
    ['Utilisation (all working days)', pct(m.utilisation)],
    ['No-show rate', pct(m.noShowRate)],
    ['Override rate', pct(m.overrideRate)],
    ['Overrides / decisions', `${m.overrides} / ${m.decisions}`],
    [
      'Employees below 60% of peak-day requests met',
      `${m.fairness.belowTarget} of ${m.fairness.employees}`,
    ],
    ['Lowest share met', pct(m.fairness.minShare)],
    [
      'Adoption',
      `${m.adoption.employees} of ${m.adoption.activeEmployees} (${pct(m.adoption.share)})`,
    ],
    ['Requests', m.requests],
    ['Bookings', m.confirmed],
    ['Auto-released (no-shows)', m.autoReleased],
  ];
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return (
    [
      'metric,value',
      ...summary.map(([k, v]) => `${q(k)},${q(v)}`),
      '',
      'date,peak_day,requests,bookings,checked_in,auto_released,utilisation',
      ...report.days.map((d) =>
        [
          d.date,
          d.peak ? 'yes' : 'no',
          d.requests,
          d.confirmed,
          d.checkedIn,
          d.autoReleased,
          pct(d.utilisation),
        ]
          .map(q)
          .join(','),
      ),
    ].join('\n') + '\n'
  );
}
