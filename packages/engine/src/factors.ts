/**
 * Weighted factors (docs/03-allocation-model.md §2). Each returns a value in 0–1.
 * Missing data scores the factor's neutral value (config `missing`) and is flagged.
 */
import { isoWeekday, type IsoDate } from '@parksmart/shared';
import type { EngineHistory, EnginePerson, EnginePolicy, EngineRequest } from './types';

export type FactorContext = {
  request: EngineRequest;
  person: EnginePerson | undefined;
  history: EngineHistory | undefined;
  /** Peak days this employee has won earlier in the current round (ADR-009). */
  peakWonInRound: number;
  config: Record<string, unknown>;
  policy: EnginePolicy;
  /** Peak weekdays (ISO) used for rolling fairness. */
  peakWeekdays: readonly number[];
};

export type FactorValue = { value: number; neutral: boolean };
type Factor = (ctx: FactorContext) => FactorValue;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const neutral = (config: Record<string, unknown>, fallback = 0.5): FactorValue => ({
  value: clamp01(num(config.missing, fallback)),
  neutral: true,
});
const fromMap = (config: Record<string, unknown>, key: string | null): FactorValue => {
  const values = (config.values ?? {}) as Record<string, unknown>;
  if (key === null || typeof values[key] !== 'number') return neutral(config);
  return { value: clamp01(values[key] as number), neutral: false };
};

function yearsBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

const FACTORS: Record<string, Factor> = {
  /** Fewer peak days won in the lookback window (plus this round) scores higher. */
  rolling_fairness: ({ history, peakWonInRound, config, peakWeekdays }) => {
    const window = num(config.lookbackWeeks, 4) * Math.max(peakWeekdays.length, 1);
    const won = (history?.peakDaysWon ?? 0) + peakWonInRound;
    return { value: clamp01(1 - won / window), neutral: false };
  },

  /** Self-declared reason category for the day. */
  business_need: ({ request, config }) => fromMap(config, request.reasonCategory),

  /** Share of bookings with a missed check-in lowers the score. Neutral until active. */
  no_show_history: ({ history, config, policy }) => {
    if (policy.weeksOfData < num(config.activeFromWeek, 0)) return neutral(config, 1);
    if (!history || history.bookings <= 0) return neutral(config, 1);
    return { value: clamp01(1 - history.noShows / history.bookings), neutral: false };
  },

  commute_distance: ({ person, config }) => fromMap(config, person?.distanceBand ?? null),

  client_facing: ({ person, config }) => {
    if (person?.clientFacing == null) return neutral(config);
    return { value: person.clientFacing ? 1 : 0, neutral: false };
  },

  seniority: ({ person, request, config }) => {
    if (!person?.joinDate) return neutral(config);
    const years = yearsBetween(person.joinDate, request.date);
    return { value: clamp01(years / num(config.fullScoreYears, 10)), neutral: false };
  },

  /** P2: verified carpools are not live yet. */
  carpool: () => ({ value: 0, neutral: true }),
};

export const FACTOR_KEYS: ReadonlySet<string> = new Set(Object.keys(FACTORS));

export function computeFactor(key: string, ctx: FactorContext): FactorValue {
  const factor = FACTORS[key];
  if (!factor) throw new Error(`No scoring function for factor "${key}"`);
  return factor(ctx);
}

export function isPeakDate(date: IsoDate, peakWeekdays: readonly number[]): boolean {
  return peakWeekdays.includes(isoWeekday(date));
}
