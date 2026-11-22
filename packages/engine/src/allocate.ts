/**
 * The allocation engine: one pure function (docs/03-allocation-model.md §3).
 *
 * Per day: (1) eligibility, (2) reservations and same-day pool hold-back,
 * (3) weighted score, (4) sort with a seeded tie-break, (5) assign in rank order
 * respecting caps and bay types (first choice, then fallback), (6) waitlist the rest,
 * (7) emit a decision per request. Weekly rounds allocate the most oversubscribed
 * day first and carry wins forward into caps and rolling fairness (ADR-009).
 */
import type { BayType, IsoDate } from '@parksmart/shared';
import { computeFactor, isPeakDate } from './factors';
import { validatePolicy } from './policy';
import { tiebreakDraw } from './prng';
import type {
  AllocateInput,
  AllocateResult,
  Assignment,
  Decision,
  EngineBay,
  EngineHistory,
  EnginePerson,
  EngineRequest,
  FactorScore,
  ReasonCode,
  WaitlistEntry,
} from './types';

export class EngineInputError extends Error {
  override name = 'EngineInputError';
}

/** Request types that may fall back to a car bay (ADR-010). */
const FALLBACK_TO_CAR: ReadonlySet<BayType> = new Set(['ev', 'accessible', 'carpool']);
/** Bay types the same-day pool is taken from. Accessible bays stay reserved. */
const POOL_TYPES: readonly BayType[] = ['car', 'ev'];
const DEFAULT_PEAK_WEEKDAYS = [2, 3, 4];
/** Scores are compared at 1e-9 so float noise never breaks a genuine tie. */
const scoreKey = (score: number) => Math.round(score * 1e9);

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bayOrder = (a: EngineBay, b: EngineBay) => byString(a.code, b.code) || byString(a.id, b.id);

type Ranked = {
  request: EngineRequest;
  score: number;
  breakdown: FactorScore[];
  tiebreak: number;
  rank: number;
  capped: boolean;
};

function validateInput(input: AllocateInput): void {
  const errors = validatePolicy(input.policy.rules, input.policy.maxFactorWeightPercent);
  if (errors.length > 0) {
    throw new EngineInputError(errors.map((e) => `${e.code}: ${e.message}`).join('; '));
  }
  const dates = new Set(input.round.dates);
  if (dates.size !== input.round.dates.length) throw new EngineInputError('Duplicate round dates.');
  const ids = new Set<string>();
  const userDays = new Set<string>();
  for (const r of input.requests) {
    if (!dates.has(r.date)) {
      throw new EngineInputError(`Request ${r.id} is for ${r.date}, which is not in this round.`);
    }
    if (ids.has(r.id)) throw new EngineInputError(`Duplicate request id ${r.id}.`);
    ids.add(r.id);
    const key = `${r.userId}|${r.date}`;
    if (userDays.has(key)) {
      throw new EngineInputError(
        `User ${r.userId} has two requests for ${r.date}; only one request per employee per day.`,
      );
    }
    userDays.add(key);
  }
  const bayIds = new Set(input.bays.map((b) => b.id));
  if (bayIds.size !== input.bays.length) throw new EngineInputError('Duplicate bay ids.');
}

export function allocate(input: AllocateInput): AllocateResult {
  validateInput(input);
  const { policy, round, seed } = input;

  const rule = (key: string) => policy.rules.find((r) => r.key === key && r.enabled);
  const evMatch = rule('ev_match') !== undefined;
  const accessibleReserved = rule('accessibility_reservation') !== undefined;
  const capRule = rule('peak_day_cap');
  const capMaxDays = capRule ? Number(capRule.config.maxDays ?? Infinity) : Infinity;
  const capPeakWeekdays =
    (capRule?.config.peakWeekdays as number[] | undefined) ?? DEFAULT_PEAK_WEEKDAYS;
  const fairness = rule('rolling_fairness');
  const fairnessPeakWeekdays =
    (fairness?.config.peakWeekdays as number[] | undefined) ?? capPeakWeekdays;
  const weighted = policy.rules
    .filter((r) => r.ruleType === 'weighted' && r.enabled)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || byString(a.key, b.key));

  const people = new Map<string, EnginePerson>(input.people.map((p) => [p.userId, p]));
  const history = new Map<string, EngineHistory>(input.history.map((h) => [h.userId, h]));
  const bays = [...input.bays].sort(bayOrder);
  const siteBayTypes = new Set(bays.map((b) => b.bayType));
  const unavailable = new Set(input.unavailable.map((u) => `${u.bayId}|${u.date}`));
  const requestsByDate = new Map<IsoDate, EngineRequest[]>();
  for (const r of [...input.requests].sort((a, b) => byString(a.id, b.id))) {
    requestsByDate.set(r.date, [...(requestsByDate.get(r.date) ?? []), r]);
  }

  const decisions: Decision[] = [];
  const assignments: Assignment[] = [];
  const waitlist: WaitlistEntry[] = [];
  const heldBack: AllocateResult['heldBack'] = [];
  // Wins earlier in this round, counted on each rule's own peak weekdays (ADR-009).
  const capWinsInRound = new Map<string, number>();
  const fairnessWinsInRound = new Map<string, number>();

  // --- eligibility (step 1) --------------------------------------------------
  const ineligibleReason = (r: EngineRequest): ReasonCode | null => {
    const person = people.get(r.userId);
    if (r.bayType === 'ev' && evMatch && !person?.isEv) return 'not_ev';
    if (r.bayType === 'accessible' && accessibleReserved) {
      const through = person?.accessibleApprovedThrough ?? null;
      if (through === null || through < r.date) return 'accessible_not_approved';
    }
    return null;
  };

  // --- per-day supply, pool hold-back (step 2) and day order (ADR-009) --------
  const days = round.dates.map((date) => {
    const free = bays.filter((b) => !unavailable.has(`${b.id}|${date}`));
    const held: EngineBay[] = [];
    if (round.type !== 'same_day') {
      for (const type of POOL_TYPES) {
        const total = bays.filter((b) => b.bayType === type).length;
        const count = Math.floor((total * policy.sameDayPoolPercent) / 100);
        held.push(
          ...free
            .filter((b) => b.bayType === type)
            .reverse()
            .slice(0, count),
        );
      }
    }
    const heldIds = new Set(held.map((b) => b.id));
    const allocatable = free.filter((b) => !heldIds.has(b.id));
    const requests = requestsByDate.get(date) ?? [];
    const eligible = requests.filter((r) => ineligibleReason(r) === null).length;
    const ratio =
      allocatable.length === 0 ? (eligible > 0 ? Infinity : 0) : eligible / allocatable.length;
    return { date, held, allocatable, requests, ratio };
  });
  const dayOrder = [...days].sort((a, b) => b.ratio - a.ratio || byString(a.date, b.date));

  for (const day of dayOrder) {
    const { date } = day;
    if (round.type !== 'same_day') heldBack.push({ date, bayIds: day.held.map((b) => b.id) });
    const peakDay = capRule !== undefined && isPeakDate(date, capPeakWeekdays);

    // --- score and rank (steps 3–4) ------------------------------------------
    const scored: Omit<Ranked, 'rank'>[] = [];
    for (const request of day.requests) {
      const reason = ineligibleReason(request);
      if (reason) {
        decisions.push({
          requestId: request.id,
          userId: request.userId,
          date,
          outcome: 'ineligible',
          reasonCode: reason,
          score: null,
          rank: null,
          tiebreak: null,
          breakdown: [],
          bayId: null,
          fallbackUsed: false,
          capReached: false,
        });
        continue;
      }
      const hist = history.get(request.userId);
      const breakdown: FactorScore[] = weighted.map((r) => {
        const { value, neutral } = computeFactor(r.key, {
          request,
          person: people.get(request.userId),
          history: hist,
          peakWonInRound: fairnessWinsInRound.get(request.userId) ?? 0,
          config: r.config,
          policy,
          peakWeekdays: fairnessPeakWeekdays,
        });
        const weight = r.weight ?? 0;
        return { key: r.key, weight, value, contribution: (weight / 100) * value, neutral };
      });
      const score = breakdown.reduce((sum, f) => sum + f.contribution, 0);
      const wonThisWeek =
        (hist?.peakDaysWonThisWeek ?? 0) + (capWinsInRound.get(request.userId) ?? 0);
      scored.push({
        request,
        score,
        breakdown,
        tiebreak: tiebreakDraw(seed, date, request.id),
        capped: peakDay && wonThisWeek >= capMaxDays,
      });
    }
    const ranked: Ranked[] = scored
      .sort(
        (a, b) =>
          scoreKey(b.score) - scoreKey(a.score) ||
          b.tiebreak - a.tiebreak ||
          byString(a.request.id, b.request.id),
      )
      .map((s, i) => ({ ...s, rank: i + 1 }));

    // --- assign (step 5) -------------------------------------------------------
    const pool = new Map<BayType, EngineBay[]>();
    for (const b of day.allocatable) pool.set(b.bayType, [...(pool.get(b.bayType) ?? []), b]);
    const take = (type: BayType) => pool.get(type)?.shift();
    const won = new Map<string, { bay: EngineBay; reason: ReasonCode; fallback: boolean }>();

    const assignPasses = (group: Ranked[]) => {
      for (const r of group) {
        const bay = take(r.request.bayType);
        if (bay) won.set(r.request.id, { bay, reason: 'allocated', fallback: false });
      }
      for (const r of group) {
        if (won.has(r.request.id)) continue;
        if (!r.request.allowFallback || !FALLBACK_TO_CAR.has(r.request.bayType)) continue;
        const bay = take('car');
        if (bay) won.set(r.request.id, { bay, reason: 'allocated_fallback', fallback: true });
      }
      if (round.type === 'same_day' && policy.evOverflowSameDay) {
        for (const r of group) {
          if (won.has(r.request.id) || r.request.bayType !== 'car') continue;
          const bay = take('ev');
          if (bay) won.set(r.request.id, { bay, reason: 'allocated_overflow', fallback: true });
        }
      }
    };
    const uncapped = ranked.filter((r) => !r.capped);
    const capped = ranked.filter((r) => r.capped);
    assignPasses(uncapped);
    // Capped employees only get leftovers, and only in same-day rounds (ADR-009).
    if (round.type === 'same_day') assignPasses(capped);

    // --- waitlist (step 6) and decisions (step 7) -----------------------------
    const positions = new Map<BayType, number>();
    for (const r of [...uncapped, ...capped]) {
      const { request } = r;
      const win = won.get(request.id);
      if (win) {
        assignments.push({
          requestId: request.id,
          userId: request.userId,
          bayId: win.bay.id,
          date,
          fallbackUsed: win.fallback,
        });
        const bump = (m: Map<string, number>) =>
          m.set(request.userId, (m.get(request.userId) ?? 0) + 1);
        if (peakDay) bump(capWinsInRound);
        if (isPeakDate(date, fairnessPeakWeekdays)) bump(fairnessWinsInRound);
      } else {
        const position = (positions.get(request.bayType) ?? 0) + 1;
        positions.set(request.bayType, position);
        waitlist.push({
          requestId: request.id,
          userId: request.userId,
          date,
          bayType: request.bayType,
          position,
          capReached: r.capped,
        });
      }
      const noBaysOfType =
        !siteBayTypes.has(request.bayType) &&
        !(request.allowFallback && FALLBACK_TO_CAR.has(request.bayType) && siteBayTypes.has('car'));
      decisions.push({
        requestId: request.id,
        userId: request.userId,
        date,
        outcome: win ? 'confirmed' : 'waitlisted',
        reasonCode: win
          ? win.reason
          : r.capped
            ? 'cap_reached'
            : noBaysOfType
              ? 'no_bays_of_type'
              : 'no_bay_left',
        score: r.score,
        rank: r.rank,
        tiebreak: r.tiebreak,
        breakdown: r.breakdown,
        bayId: win?.bay.id ?? null,
        fallbackUsed: win?.fallback ?? false,
        capReached: r.capped,
      });
    }
  }

  // Stable output order, independent of input order.
  const bayCode = new Map(bays.map((b) => [b.id, b.code]));
  assignments.sort(
    (a, b) => byString(a.date, b.date) || byString(bayCode.get(a.bayId)!, bayCode.get(b.bayId)!),
  );
  waitlist.sort(
    (a, b) => byString(a.date, b.date) || byString(a.bayType, b.bayType) || a.position - b.position,
  );
  decisions.sort(
    (a, b) =>
      byString(a.date, b.date) ||
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      byString(a.requestId, b.requestId),
  );
  heldBack.sort((a, b) => byString(a.date, b.date));

  return {
    assignments,
    waitlist,
    decisions,
    dayOrder: dayOrder.map((d) => d.date),
    heldBack,
    seed,
  };
}
