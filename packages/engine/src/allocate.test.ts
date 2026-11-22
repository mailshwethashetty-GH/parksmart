/** Worked examples: behaviours that are easier to read as concrete cases. */
import { describe, expect, it } from 'vitest';
import { allocate } from './allocate';
import { catalogueRules, defaultPolicy, MONDAY } from './test-arbitraries';
import type { AllocateInput, EngineBay, EnginePerson, EngineRequest } from './types';

const TUE = '2026-11-24';
const WED = '2026-11-25';
const THU = '2026-11-26';

function person(userId: string, extra: Partial<EnginePerson> = {}): EnginePerson {
  return {
    userId,
    isEv: false,
    accessibleApprovedThrough: null,
    distanceBand: null,
    clientFacing: null,
    joinDate: null,
    ...extra,
  };
}

function bays(n: number, bayType: EngineBay['bayType'] = 'car', prefix = 'C'): EngineBay[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    code: `${prefix}-${String(i).padStart(3, '0')}`,
    bayType,
    zoneId: 'z1',
  }));
}

function req(userId: string, date: string, extra: Partial<EngineRequest> = {}): EngineRequest {
  return {
    id: `r-${userId}-${date}`,
    userId,
    date,
    bayType: 'car',
    allowFallback: true,
    reasonCategory: null,
    ...extra,
  };
}

function input(partial: Partial<AllocateInput>): AllocateInput {
  const requests = partial.requests ?? [];
  const users = [...new Set(requests.map((r) => r.userId))];
  return {
    round: { type: 'daily', dates: [TUE] },
    bays: [],
    unavailable: [],
    people: users.map((u) => person(u)),
    history: [],
    policy: defaultPolicy({ sameDayPoolPercent: 0 }),
    seed: 'seed-1',
    requests,
    ...partial,
  };
}

const outcome = (r: ReturnType<typeof allocate>, id: string) =>
  r.decisions.find((d) => d.requestId === id)!;

describe('scoring', () => {
  it('rolling fairness: fewer recent peak wins ranks higher', () => {
    const result = allocate(
      input({
        bays: bays(1),
        requests: [req('a', TUE), req('b', TUE)],
        history: [
          { userId: 'a', peakDaysWon: 8, peakDaysWonThisWeek: 0, bookings: 8, noShows: 0 },
          { userId: 'b', peakDaysWon: 0, peakDaysWonThisWeek: 0, bookings: 0, noShows: 0 },
        ],
      }),
    );
    expect(outcome(result, 'r-b-' + TUE).outcome).toBe('confirmed');
    expect(outcome(result, 'r-a-' + TUE).outcome).toBe('waitlisted');
    expect(outcome(result, 'r-a-' + TUE).reasonCode).toBe('no_bay_left');
  });

  it('missing optional data scores the neutral value and is flagged', () => {
    const result = allocate(input({ bays: bays(1), requests: [req('a', TUE)] }));
    const distance = outcome(result, 'r-a-' + TUE).breakdown.find(
      (f) => f.key === 'commute_distance',
    )!;
    expect(distance).toMatchObject({ value: 0.5, neutral: true });
  });

  it('no-show factor stays neutral before its activeFromWeek', () => {
    const history = [
      { userId: 'a', peakDaysWon: 0, peakDaysWonThisWeek: 0, bookings: 10, noShows: 10 },
    ];
    const early = allocate(
      input({
        bays: bays(1),
        requests: [req('a', TUE)],
        history,
        policy: defaultPolicy({ weeksOfData: 1 }),
      }),
    );
    const later = allocate(
      input({
        bays: bays(1),
        requests: [req('a', TUE)],
        history,
        policy: defaultPolicy({ weeksOfData: 4 }),
      }),
    );
    const f = (r: ReturnType<typeof allocate>) =>
      outcome(r, 'r-a-' + TUE).breakdown.find((x) => x.key === 'no_show_history')!;
    expect(f(early)).toMatchObject({ value: 1, neutral: true });
    expect(f(later)).toMatchObject({ value: 0, neutral: false });
  });

  it('equal scores are settled by the seeded draw, and the seed changes only tie order', () => {
    const requests = ['a', 'b', 'c', 'd', 'e', 'f'].map((u) => req(u, TUE));
    const winnersFor = (seed: string) =>
      allocate(input({ bays: bays(2), requests, seed }))
        .assignments.map((a) => a.userId)
        .sort();
    expect(winnersFor('s1')).toEqual(winnersFor('s1'));
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    expect(new Set(seeds.map((s) => winnersFor(s).join())).size).toBeGreaterThan(1);
  });
});

describe('eligibility and reservations', () => {
  it('EV request from a non-EV owner is ineligible', () => {
    const result = allocate(
      input({ bays: bays(1, 'ev', 'E'), requests: [req('a', TUE, { bayType: 'ev' })] }),
    );
    expect(outcome(result, 'r-a-' + TUE)).toMatchObject({
      outcome: 'ineligible',
      reasonCode: 'not_ev',
    });
  });

  it('accessible request needs an approval valid on the date', () => {
    const result = allocate(
      input({
        bays: bays(1, 'accessible', 'A'),
        requests: [
          req('a', TUE, { bayType: 'accessible' }),
          req('b', TUE, { bayType: 'accessible' }),
        ],
        people: [
          person('a', { accessibleApprovedThrough: MONDAY }),
          person('b', { accessibleApprovedThrough: THU }),
        ],
      }),
    );
    expect(outcome(result, 'r-a-' + TUE)).toMatchObject({
      outcome: 'ineligible',
      reasonCode: 'accessible_not_approved',
    });
    expect(outcome(result, 'r-b-' + TUE).outcome).toBe('confirmed');
  });

  it('unused accessible bays are not given to car requests', () => {
    const result = allocate(input({ bays: bays(1, 'accessible', 'A'), requests: [req('a', TUE)] }));
    expect(outcome(result, 'r-a-' + TUE).outcome).toBe('waitlisted');
  });

  it('blocked and already-booked bays are skipped', () => {
    const result = allocate(
      input({
        bays: bays(2),
        unavailable: [{ bayId: 'C0', date: TUE }],
        requests: [req('a', TUE), req('b', TUE)],
      }),
    );
    expect(result.assignments.map((a) => a.bayId)).toEqual(['C1']);
  });
});

describe('fallback (ADR-010)', () => {
  const evOwner = (u: string) => person(u, { isEv: true });

  it('EV request falls back to a car bay when EV bays run out', () => {
    const result = allocate(
      input({
        bays: [...bays(1, 'ev', 'E'), ...bays(1)],
        requests: [req('a', TUE, { bayType: 'ev' }), req('b', TUE, { bayType: 'ev' })],
        people: [evOwner('a'), evOwner('b')],
        history: [
          { userId: 'a', peakDaysWon: 0, peakDaysWonThisWeek: 0, bookings: 0, noShows: 0 },
          { userId: 'b', peakDaysWon: 6, peakDaysWonThisWeek: 0, bookings: 0, noShows: 0 },
        ],
      }),
    );
    expect(outcome(result, 'r-a-' + TUE)).toMatchObject({ bayId: 'E0', fallbackUsed: false });
    expect(outcome(result, 'r-b-' + TUE)).toMatchObject({
      bayId: 'C0',
      fallbackUsed: true,
      reasonCode: 'allocated_fallback',
    });
  });

  it('"EV bay only" opts out of fallback', () => {
    const result = allocate(
      input({
        bays: bays(1),
        requests: [req('a', TUE, { bayType: 'ev', allowFallback: false })],
        people: [evOwner('a')],
      }),
    );
    expect(outcome(result, 'r-a-' + TUE).outcome).toBe('waitlisted');
  });

  it('a lower-scoring car request still beats a higher-scoring fallback for the car bay', () => {
    const result = allocate(
      input({
        bays: bays(1),
        requests: [
          req('ev', TUE, { bayType: 'ev', reasonCategory: 'client_visit' }),
          req('car', TUE),
        ],
        people: [evOwner('ev'), person('car')],
      }),
    );
    expect(outcome(result, 'r-car-' + TUE).outcome).toBe('confirmed');
    expect(outcome(result, 'r-ev-' + TUE).outcome).toBe('waitlisted');
  });

  it('same-day EV overflow gives free EV bays to car requests only when switched on', () => {
    const base = {
      round: { type: 'same_day' as const, dates: [TUE] },
      bays: bays(1, 'ev', 'E'),
      requests: [req('a', TUE)],
    };
    expect(
      allocate(input({ ...base, policy: defaultPolicy({ evOverflowSameDay: false }) })).assignments,
    ).toEqual([]);
    const on = allocate(input({ ...base, policy: defaultPolicy({ evOverflowSameDay: true }) }));
    expect(outcome(on, 'r-a-' + TUE)).toMatchObject({
      bayId: 'E0',
      reasonCode: 'allocated_overflow',
    });
  });
});

describe('multi-day weekly rounds (ADR-009)', () => {
  const capPolicy = (maxDays: number) =>
    defaultPolicy({
      sameDayPoolPercent: 0,
      rules: catalogueRules({
        peak_day_cap: { config: { maxDays, period: 'week', peakWeekdays: [2, 3, 4] } },
      }),
    });

  it('allocates the most oversubscribed day first', () => {
    const result = allocate(
      input({
        round: { type: 'weekly', dates: [MONDAY, TUE, WED] },
        bays: bays(2),
        requests: [
          req('a', MONDAY),
          ...['a', 'b', 'c', 'd'].map((u) => req(u, WED)),
          ...['a', 'b', 'c'].map((u) => req(u, TUE)),
        ],
      }),
    );
    expect(result.dayOrder).toEqual([WED, TUE, MONDAY]);
  });

  it('a capped employee waits behind uncapped ones and is marked cap_reached', () => {
    const result = allocate(
      input({
        round: { type: 'weekly', dates: [TUE, WED] },
        bays: bays(1),
        policy: capPolicy(1),
        // a has no recent wins so ranks first on both days; b ranks second.
        requests: [req('a', TUE), req('a', WED), req('b', TUE), req('b', WED)],
        history: [
          { userId: 'a', peakDaysWon: 0, peakDaysWonThisWeek: 0, bookings: 0, noShows: 0 },
          { userId: 'b', peakDaysWon: 10, peakDaysWonThisWeek: 0, bookings: 0, noShows: 0 },
        ],
      }),
    );
    const aWins = result.assignments.filter((x) => x.userId === 'a');
    expect(aWins).toHaveLength(1);
    const capped = result.decisions.find((d) => d.userId === 'a' && d.outcome === 'waitlisted')!;
    expect(capped).toMatchObject({ capReached: true, reasonCode: 'cap_reached' });
    expect(result.assignments.filter((x) => x.userId === 'b')).toHaveLength(1);
  });

  it('wins on earlier-processed days lower rolling fairness for later days', () => {
    // Equal history; a wins the first-processed day, so b should win the next.
    const result = allocate(
      input({
        round: { type: 'weekly', dates: [TUE, WED] },
        bays: bays(1),
        policy: capPolicy(5),
        requests: [req('a', TUE), req('b', TUE), req('a', WED), req('b', WED)],
      }),
    );
    const winners = result.assignments.map((x) => x.userId).sort();
    expect(winners).toEqual(['a', 'b']);
  });
});

describe('same-day pool', () => {
  it('holds back 10% of car bays in weekly/daily rounds, highest codes first', () => {
    const requests = Array.from({ length: 30 }, (_, i) => req(`u${i}`, TUE));
    const result = allocate(input({ bays: bays(20), requests, policy: defaultPolicy() }));
    expect(result.heldBack).toEqual([{ date: TUE, bayIds: ['C19', 'C18'] }]);
    expect(result.assignments).toHaveLength(18);
  });

  it('same-day rounds can use every free bay', () => {
    const requests = Array.from({ length: 30 }, (_, i) => req(`u${i}`, TUE));
    const result = allocate(
      input({
        round: { type: 'same_day', dates: [TUE] },
        bays: bays(20),
        requests,
        policy: defaultPolicy(),
      }),
    );
    expect(result.assignments).toHaveLength(20);
  });
});

describe('input validation', () => {
  it('rejects two requests from one employee for the same date', () => {
    expect(() =>
      allocate(input({ requests: [req('a', TUE), { ...req('a', TUE), id: 'dup' }] })),
    ).toThrow(/one request per employee per day/);
  });

  it('rejects requests outside the round dates', () => {
    expect(() => allocate(input({ requests: [req('a', THU)] }))).toThrow(/not in this round/);
  });

  it('rejects an invalid policy', () => {
    const rules = catalogueRules({
      rolling_fairness: { weight: 60 },
      business_need: { weight: 0 },
    });
    expect(() => allocate(input({ policy: defaultPolicy({ rules }) }))).toThrow(/POLICY_/);
  });
});

describe('performance', () => {
  it('allocates a 5-day week for 2,000 bays and 5,000 employees well under budget', () => {
    const week = [MONDAY, TUE, WED, THU, '2026-11-27'];
    const allBays = [...bays(1800), ...bays(150, 'ev', 'E'), ...bays(50, 'accessible', 'A')];
    const users = Array.from({ length: 5000 }, (_, i) => `u${i}`);
    const requests = users.flatMap((u, i) =>
      week.filter((_, d) => (i + d) % 5 < 3).map((date) => req(u, date)),
    );
    const start = performance.now();
    const result = allocate(
      input({
        round: { type: 'weekly', dates: week },
        bays: allBays,
        requests,
        people: users.map((u) => person(u)),
        policy: defaultPolicy(),
      }),
    );
    const ms = performance.now() - start;
    expect(result.decisions).toHaveLength(requests.length);
    expect(ms).toBeLessThan(10_000); // NFR budget is 5 minutes
  });
});
