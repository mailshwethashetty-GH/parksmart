/**
 * Engine contract (docs/03-allocation-model.md §3). Everything the engine needs is
 * passed in; it reads no DB, network, clock or global randomness.
 *
 * Note: requests carry NO submission time. Submission time is never scored
 * (non-negotiable #2), so it is not part of the input at all.
 */
import type {
  BayType,
  DistanceBand,
  IsoDate,
  ReasonCategory,
  RoundType,
  RuleType,
} from '@parksmart/shared';

export type EngineRequest = {
  id: string;
  userId: string;
  date: IsoDate;
  bayType: BayType;
  /** False = "EV bay only": no car-bay fallback (ADR-010). */
  allowFallback: boolean;
  reasonCategory: ReasonCategory | null;
};

export type EngineBay = {
  id: string;
  /** Used for a stable, documented bay order (and same-day pool selection). */
  code: string;
  bayType: BayType;
  zoneId: string;
};

/** A bay that cannot be allocated on a date: blocked, or already held by a booking. */
export type UnavailableBay = { bayId: string; date: IsoDate };

/** Per-employee data. Optional fields are null when unknown and score neutral. */
export type EnginePerson = {
  userId: string;
  isEv: boolean;
  /** Last site-local date the accessible approval is valid for; null = no approval. */
  accessibleApprovedThrough: IsoDate | null;
  distanceBand: DistanceBand | null;
  clientFacing: boolean | null;
  joinDate: IsoDate | null;
};

/** Per-employee history, computed by the service over the policy's lookback window. */
export type EngineHistory = {
  userId: string;
  /** Peak days won in the lookback window (rolling fairness). */
  peakDaysWon: number;
  /** Peak days already won in the target week by earlier rounds (caps). */
  peakDaysWonThisWeek: number;
  /** Bookings and missed check-ins in the lookback window (no-show factor). */
  bookings: number;
  noShows: number;
};

export type EngineRule = {
  key: string;
  ruleType: RuleType;
  /** Percent; weighted rules only. */
  weight: number | null;
  enabled: boolean;
  config: Record<string, unknown>;
};

export type EnginePolicy = {
  versionId: string;
  rules: readonly EngineRule[];
  maxFactorWeightPercent: number;
  sameDayPoolPercent: number;
  evOverflowSameDay: boolean;
  /** Weeks of pilot data so far; factors with `activeFromWeek` stay neutral before it. */
  weeksOfData: number;
};

export type AllocateInput = {
  round: { type: RoundType; dates: readonly IsoDate[] };
  requests: readonly EngineRequest[];
  bays: readonly EngineBay[];
  unavailable: readonly UnavailableBay[];
  people: readonly EnginePerson[];
  history: readonly EngineHistory[];
  policy: EnginePolicy;
  /** Seed for the tie-break draw; logged with the round so it can be replayed. */
  seed: string;
};

export type FactorScore = {
  key: string;
  weight: number;
  /** Normalised 0–1. */
  value: number;
  /** weight/100 × value. */
  contribution: number;
  /** True when data was missing and the neutral value was used. */
  neutral: boolean;
};

export type DecisionOutcome = 'confirmed' | 'waitlisted' | 'ineligible';

export type ReasonCode =
  | 'allocated'
  | 'allocated_fallback'
  | 'allocated_overflow'
  | 'no_bay_left'
  | 'cap_reached'
  | 'not_ev'
  | 'accessible_not_approved'
  | 'no_bays_of_type';

export type Decision = {
  requestId: string;
  userId: string;
  date: IsoDate;
  outcome: DecisionOutcome;
  reasonCode: ReasonCode;
  /** 0–1. Null for ineligible requests (not scored). */
  score: number | null;
  /** 1-based rank among eligible requests for the date. Null when ineligible. */
  rank: number | null;
  /** The seeded draw used to order equal scores. */
  tiebreak: number | null;
  breakdown: FactorScore[];
  bayId: string | null;
  fallbackUsed: boolean;
  capReached: boolean;
};

export type Assignment = {
  requestId: string;
  userId: string;
  bayId: string;
  date: IsoDate;
  fallbackUsed: boolean;
};

export type WaitlistEntry = {
  requestId: string;
  userId: string;
  date: IsoDate;
  bayType: BayType;
  /** 1-based within (date, bayType). Capped entries come after every uncapped one. */
  position: number;
  capReached: boolean;
};

export type AllocateResult = {
  assignments: Assignment[];
  waitlist: WaitlistEntry[];
  decisions: Decision[];
  /** Order the days were allocated in (most oversubscribed first, ADR-009). */
  dayOrder: IsoDate[];
  /** Bays held back for the same-day pool, per date (weekly/daily rounds only). */
  heldBack: { date: IsoDate; bayIds: string[] }[];
  seed: string;
};
