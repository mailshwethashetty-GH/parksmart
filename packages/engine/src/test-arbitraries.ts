/**
 * fast-check generators for engine tests. Test-only.
 */
import {
  addDays,
  DEFAULT_RULE_CATALOGUE,
  DISTANCE_BANDS,
  REASON_CATEGORIES,
  type IsoDate,
  type RoundType,
} from '@parksmart/shared';
import fc from 'fast-check';
import type {
  AllocateInput,
  EngineBay,
  EngineHistory,
  EnginePerson,
  EnginePolicy,
  EngineRequest,
  EngineRule,
  UnavailableBay,
} from './types';

export const MONDAY = '2026-11-23';
const WEEK: IsoDate[] = [0, 1, 2, 3, 4].map((d) => addDays(MONDAY, d));

export function catalogueRules(overrides: Partial<Record<string, Partial<EngineRule>>> = {}) {
  return DEFAULT_RULE_CATALOGUE.map((r) => ({
    key: r.key,
    ruleType: r.ruleType,
    weight: r.weight,
    enabled: r.enabled,
    config: { ...r.config },
    ...overrides[r.key],
  })) as EngineRule[];
}

export function defaultPolicy(overrides: Partial<EnginePolicy> = {}): EnginePolicy {
  return {
    versionId: 'pv1',
    rules: catalogueRules(),
    maxFactorWeightPercent: 50,
    sameDayPoolPercent: 10,
    evOverflowSameDay: false,
    weeksOfData: 4,
    ...overrides,
  };
}

/** Valid weighted-factor weights: start from the defaults and move points between factors. */
const arbWeights = fc
  .array(fc.tuple(fc.nat(5), fc.nat(5), fc.integer({ min: 1, max: 20 })), { maxLength: 8 })
  .map((moves) => {
    const w = [35, 25, 15, 10, 10, 5];
    for (const [from, to, amount] of moves) {
      const a = Math.min(amount, w[from]!, 50 - w[to]!);
      if (from === to || a <= 0) continue;
      w[from]! -= a;
      w[to]! += a;
    }
    return w;
  });

const WEIGHTED_KEYS = [
  'rolling_fairness',
  'business_need',
  'no_show_history',
  'commute_distance',
  'client_facing',
  'seniority',
];

export const arbPolicy: fc.Arbitrary<EnginePolicy> = fc
  .record({
    weights: arbWeights,
    pool: fc.integer({ min: 0, max: 30 }),
    overflow: fc.boolean(),
    weeksOfData: fc.integer({ min: 0, max: 10 }),
    maxDays: fc.integer({ min: 1, max: 5 }),
    capEnabled: fc.boolean(),
    evMatch: fc.boolean(),
  })
  .map(({ weights, pool, overflow, weeksOfData, maxDays, capEnabled, evMatch }) => {
    const overrides: Record<string, Partial<EngineRule>> = {
      peak_day_cap: {
        enabled: capEnabled,
        config: { maxDays, period: 'week', peakWeekdays: [2, 3, 4] },
      },
      ev_match: { enabled: evMatch },
    };
    WEIGHTED_KEYS.forEach((k, i) => (overrides[k] = { weight: weights[i]! }));
    return defaultPolicy({
      rules: catalogueRules(overrides),
      sameDayPoolPercent: pool,
      evOverflowSameDay: overflow,
      weeksOfData,
    });
  });

const arbPerson = (userId: string): fc.Arbitrary<EnginePerson> =>
  fc.record({
    userId: fc.constant(userId),
    isEv: fc.boolean(),
    accessibleApprovedThrough: fc.option(
      fc.constantFrom(addDays(MONDAY, -1), addDays(MONDAY, 2), addDays(MONDAY, 30)),
      { nil: null },
    ),
    distanceBand: fc.option(fc.constantFrom(...DISTANCE_BANDS), { nil: null }),
    clientFacing: fc.option(fc.boolean(), { nil: null }),
    joinDate: fc.option(fc.constantFrom('2010-01-15', '2019-06-01', '2025-11-01'), { nil: null }),
  });

const arbHistory = (userId: string): fc.Arbitrary<EngineHistory> =>
  fc
    .record({
      peakDaysWon: fc.integer({ min: 0, max: 12 }),
      peakDaysWonThisWeek: fc.integer({ min: 0, max: 3 }),
      bookings: fc.integer({ min: 0, max: 20 }),
      noShowShare: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ noShowShare, bookings, ...rest }) => ({
      userId,
      bookings,
      noShows: Math.floor(bookings * noShowShare),
      ...rest,
    }));

export const arbInput = (roundType?: RoundType): fc.Arbitrary<AllocateInput> =>
  fc
    .record({
      type: roundType
        ? fc.constant(roundType)
        : fc.constantFrom<RoundType>('weekly', 'daily', 'same_day'),
      dayCount: fc.integer({ min: 1, max: 5 }),
      userCount: fc.integer({ min: 1, max: 30 }),
      bayTypes: fc.array(fc.constantFrom('car', 'car', 'car', 'ev', 'accessible' as const), {
        maxLength: 25,
      }),
      seed: fc.string({ minLength: 1, maxLength: 12 }),
      policy: arbPolicy,
    })
    .chain(({ type, dayCount, userCount, bayTypes, seed, policy }) => {
      const dates = type === 'weekly' ? WEEK.slice(0, dayCount) : [WEEK[dayCount - 1]!];
      const userIds = Array.from({ length: userCount }, (_, i) => `u${i}`);
      const bays: EngineBay[] = bayTypes.map((bayType, i) => ({
        id: `bay${i}`,
        code: `B-${String(i).padStart(3, '0')}`,
        bayType,
        zoneId: 'z1',
      }));
      const arbRequestsForUser = (userId: string) =>
        fc.subarray(dates).chain((ds) =>
          fc.tuple(
            ...ds.map((date) =>
              fc.record({
                id: fc.constant(`r-${userId}-${date}`),
                userId: fc.constant(userId),
                date: fc.constant(date),
                bayType: fc.constantFrom('car', 'car', 'ev', 'accessible' as const),
                allowFallback: fc.boolean(),
                reasonCategory: fc.option(fc.constantFrom(...REASON_CATEGORIES), { nil: null }),
              }),
            ),
          ),
        );
      const pairs = bays.flatMap((b) => dates.map((date) => ({ bayId: b.id, date })));
      return fc.record({
        round: fc.constant({ type, dates }),
        requests: fc
          .tuple(...userIds.map(arbRequestsForUser))
          .map((rs) => rs.flat() as EngineRequest[]),
        bays: fc.constant(bays),
        unavailable: fc.subarray(pairs, { maxLength: Math.ceil(pairs.length / 4) }) as fc.Arbitrary<
          UnavailableBay[]
        >,
        people: fc.tuple(...userIds.map(arbPerson)),
        history: fc.tuple(...userIds.map(arbHistory)),
        policy: fc.constant(policy),
        seed: fc.constant(seed),
      });
    });
