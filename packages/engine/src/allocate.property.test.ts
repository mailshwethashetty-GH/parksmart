/**
 * Invariants from docs/03-allocation-model.md §3 and ADR-008/009/010,
 * checked over randomly generated rounds.
 */
import { isoWeekday } from '@parksmart/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate } from './allocate';
import { arbInput } from './test-arbitraries';
import type { AllocateInput, AllocateResult } from './types';

const RUNS = { numRuns: 300 };

const bayById = (input: AllocateInput) => new Map(input.bays.map((b) => [b.id, b]));
const reqById = (input: AllocateInput) => new Map(input.requests.map((r) => [r.id, r]));
const personOf = (input: AllocateInput, userId: string) =>
  input.people.find((p) => p.userId === userId)!;

function shuffle<T>(items: readonly T[], keys: readonly number[]): T[] {
  return items
    .map((item, i) => ({ item, k: keys[i % Math.max(keys.length, 1)] ?? 0, i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.item);
}

describe('allocate: invariants', () => {
  it('never over-books: each bay is assigned at most once per date', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const { assignments } = allocate(input);
        const seen = new Set<string>();
        for (const a of assignments) {
          const key = `${a.bayId}|${a.date}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }),
      RUNS,
    );
  });

  it('confirmed(bayType, date) ≤ allocatable bays(bayType, date)', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const { assignments, heldBack } = allocate(input);
        const bays = bayById(input);
        const blocked = new Set(input.unavailable.map((u) => `${u.bayId}|${u.date}`));
        const held = new Set(heldBack.flatMap((h) => h.bayIds.map((id) => `${id}|${h.date}`)));
        for (const a of assignments) {
          expect(bays.has(a.bayId)).toBe(true);
          expect(blocked.has(`${a.bayId}|${a.date}`)).toBe(false);
          expect(held.has(`${a.bayId}|${a.date}`)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it('gives every request exactly one decision, consistent with assignments and waitlist', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const result = allocate(input);
        expect(result.decisions.map((d) => d.requestId).sort()).toEqual(
          input.requests.map((r) => r.id).sort(),
        );
        const assigned = new Set(result.assignments.map((a) => a.requestId));
        const waiting = new Set(result.waitlist.map((w) => w.requestId));
        for (const d of result.decisions) {
          expect(assigned.has(d.requestId)).toBe(d.outcome === 'confirmed');
          expect(waiting.has(d.requestId)).toBe(d.outcome === 'waitlisted');
        }
      }),
      RUNS,
    );
  });

  it('one bay per employee per date', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const keys = allocate(input).assignments.map((a) => `${a.userId}|${a.date}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      RUNS,
    );
  });
});

describe('allocate: determinism (non-negotiables #2 and #3)', () => {
  it('same input + seed gives identical output', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        expect(allocate(input)).toEqual(allocate(structuredClone(input)));
      }),
      RUNS,
    );
  });

  it('input order never matters (requests, bays, people, history, unavailable)', () => {
    fc.assert(
      fc.property(
        arbInput(),
        fc.array(fc.integer(), { minLength: 1, maxLength: 20 }),
        (input, keys) => {
          const shuffled: AllocateInput = {
            ...input,
            requests: shuffle(input.requests, keys),
            bays: shuffle(input.bays, [...keys].reverse()),
            people: shuffle(input.people, keys),
            history: shuffle(input.history, keys),
            unavailable: shuffle(input.unavailable, keys),
          };
          expect(allocate(shuffled)).toEqual(allocate(input));
        },
      ),
      RUNS,
    );
  });

  it('submission timestamps never change the output', () => {
    fc.assert(
      fc.property(
        arbInput(),
        fc.array(fc.date({ noInvalidDate: true }), { minLength: 1 }),
        (input, times) => {
          const withTimes = {
            ...input,
            requests: input.requests.map((r, i) => ({
              ...r,
              submittedAt: times[i % times.length],
            })),
          } as AllocateInput;
          expect(allocate(withTimes)).toEqual(allocate(input));
        },
      ),
      RUNS,
    );
  });
});

describe('allocate: rules', () => {
  it('reservations: accessible bays only go to approved accessible requests', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const bays = bayById(input);
        const reqs = reqById(input);
        for (const a of allocate(input).assignments) {
          if (bays.get(a.bayId)!.bayType !== 'accessible') continue;
          const req = reqs.get(a.requestId)!;
          expect(req.bayType).toBe('accessible');
          const through = personOf(input, a.userId).accessibleApprovedThrough;
          expect(through !== null && through >= a.date).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('eligibility: EV bays only go to EV owners requesting EV, unless same-day overflow is on', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const bays = bayById(input);
        const reqs = reqById(input);
        const evMatch = input.policy.rules.find((r) => r.key === 'ev_match')?.enabled ?? false;
        const overflow = input.round.type === 'same_day' && input.policy.evOverflowSameDay;
        for (const a of allocate(input).assignments) {
          if (bays.get(a.bayId)!.bayType !== 'ev') continue;
          const req = reqs.get(a.requestId)!;
          if (overflow && req.bayType === 'car') continue;
          expect(req.bayType).toBe('ev');
          if (evMatch) expect(personOf(input, a.userId).isEv).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('caps: weekly and daily rounds never exceed the peak-day cap', () => {
    fc.assert(
      fc.property(fc.oneof(arbInput('weekly'), arbInput('daily')), (input) => {
        const cap = input.policy.rules.find((r) => r.key === 'peak_day_cap')!;
        if (!cap.enabled) return;
        const maxDays = cap.config.maxDays as number;
        const peak = cap.config.peakWeekdays as number[];
        const wins = new Map<string, number>();
        for (const a of allocate(input).assignments) {
          if (peak.includes(isoWeekday(a.date))) wins.set(a.userId, (wins.get(a.userId) ?? 0) + 1);
        }
        for (const [userId, won] of wins) {
          const prior = input.history.find((h) => h.userId === userId)?.peakDaysWonThisWeek ?? 0;
          // A user already at/over the cap wins nothing more on peak days.
          expect(won).toBeLessThanOrEqual(Math.max(0, maxDays - prior));
        }
      }),
      RUNS,
    );
  });

  it('capped requests wait behind every uncapped request in the same queue', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const byQueue = new Map<string, { position: number; capReached: boolean }[]>();
        for (const w of allocate(input).waitlist) {
          const q = `${w.date}|${w.bayType}`;
          byQueue.set(q, [...(byQueue.get(q) ?? []), w]);
        }
        for (const entries of byQueue.values()) {
          const sorted = [...entries].sort((a, b) => a.position - b.position);
          expect(sorted.map((e) => e.position)).toEqual(sorted.map((_, i) => i + 1));
          const firstCapped = sorted.findIndex((e) => e.capReached);
          if (firstCapped >= 0)
            expect(sorted.slice(firstCapped).every((e) => e.capReached)).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('fallback never displaces a first-choice car request (ADR-010)', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const result = allocate(input);
        const byId = new Map(result.decisions.map((d) => [d.requestId, d]));
        const reqs = reqById(input);
        for (const date of input.round.dates) {
          // A non-car request that took a car bay. (Same-day EV overflow, car→EV, is not this.)
          const fallbackToCar = result.assignments.some(
            (a) => a.date === date && a.fallbackUsed && reqs.get(a.requestId)!.bayType !== 'car',
          );
          if (!fallbackToCar) continue;
          const waitingCar = input.requests.filter(
            (r) =>
              r.date === date &&
              r.bayType === 'car' &&
              byId.get(r.id)!.outcome === 'waitlisted' &&
              !byId.get(r.id)!.capReached,
          );
          expect(waitingCar.map((r) => reqs.get(r.id)!.id)).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  it('rank order: a waitlisted uncapped request never outscores a first-choice winner of its type', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const result = allocate(input);
        const reqs = reqById(input);
        for (const date of input.round.dates) {
          const day = result.decisions.filter((d) => d.date === date && !d.capReached);
          for (const type of ['car', 'ev', 'accessible'] as const) {
            const ofType = day.filter((d) => reqs.get(d.requestId)!.bayType === type);
            const winners = ofType.filter((d) => d.outcome === 'confirmed' && !d.fallbackUsed);
            const losers = ofType.filter((d) => d.outcome === 'waitlisted');
            const worstWinnerRank = Math.max(0, ...winners.map((d) => d.rank!));
            const bestLoserRank = Math.min(Infinity, ...losers.map((d) => d.rank!));
            expect(worstWinnerRank).toBeLessThan(bestLoserRank);
          }
        }
      }),
      RUNS,
    );
  });

  it('weekly/daily rounds hold back the same-day pool; same-day rounds use it', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const { heldBack } = allocate(input);
        if (input.round.type === 'same_day') {
          expect(heldBack).toEqual([]);
          return;
        }
        for (const date of input.round.dates) {
          const held = heldBack.find((h) => h.date === date)?.bayIds ?? [];
          for (const type of ['car', 'ev'] as const) {
            const count = input.bays.filter((b) => b.bayType === type).length;
            const expected = Math.floor((count * input.policy.sameDayPoolPercent) / 100);
            const heldOfType = held.filter(
              (id) => input.bays.find((b) => b.id === id)!.bayType === type,
            );
            expect(heldOfType.length).toBeLessThanOrEqual(expected);
          }
        }
      }),
      RUNS,
    );
  });

  it('scores are in 0–1 and equal the sum of factor contributions', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        for (const d of allocate(input).decisions) {
          if (d.score === null) continue;
          expect(d.score).toBeGreaterThanOrEqual(0);
          expect(d.score).toBeLessThanOrEqual(1 + 1e-9);
          for (const f of d.breakdown) {
            expect(f.value).toBeGreaterThanOrEqual(0);
            expect(f.value).toBeLessThanOrEqual(1);
          }
          const sum = d.breakdown.reduce((s, f) => s + f.contribution, 0);
          expect(d.score).toBeCloseTo(sum, 9);
        }
      }),
      RUNS,
    );
  });
});

// Keep the result type referenced so the import is checked even if tests change.
export type _R = AllocateResult;
