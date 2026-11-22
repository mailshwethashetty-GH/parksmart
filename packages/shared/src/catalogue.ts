/**
 * Starting rule catalogue (FR-9). Mirrors docs/03-allocation-model.md.
 * Weighted factors total 100%.
 */
import type { RuleType } from './constants';

export const RULE_KEYS = [
  'accessibility_reservation',
  'ev_match',
  'rolling_fairness',
  'business_need',
  'no_show_history',
  'commute_distance',
  'client_facing',
  'seniority',
  'carpool',
  'peak_day_cap',
  'random_draw',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export type CatalogueRule = {
  key: RuleKey;
  ruleType: RuleType;
  label: string;
  /** Percent, weighted rules only. */
  weight: number | null;
  enabled: boolean;
  config: Record<string, unknown>;
};

export const DEFAULT_RULE_CATALOGUE: readonly CatalogueRule[] = [
  {
    key: 'accessibility_reservation',
    ruleType: 'reservation',
    label: 'Accessible bays reserved for approved users',
    weight: null,
    enabled: true,
    config: {
      approvalKind: 'accessible',
      purpose: 'Reserve accessible bays for employees with an approved need.',
    },
  },
  {
    key: 'ev_match',
    ruleType: 'eligibility',
    label: 'Only EVs may use charger bays',
    weight: null,
    enabled: true,
    config: { bayType: 'ev', requiresEv: true },
  },
  {
    key: 'rolling_fairness',
    ruleType: 'weighted',
    label: 'Rolling fairness (fewer peak days won in the last 4 weeks scores higher)',
    weight: 35,
    enabled: true,
    config: { lookbackWeeks: 4 },
  },
  {
    key: 'business_need',
    ruleType: 'weighted',
    label: 'Business need for the day',
    weight: 25,
    enabled: true,
    config: {
      values: { client_visit: 1, event: 0.8, medical_appointment: 1, other: 0.3 },
      missing: 0,
      spotCheckPercent: 10,
    },
  },
  {
    key: 'no_show_history',
    ruleType: 'weighted',
    label: 'No-show history (missed check-ins lower the score)',
    weight: 15,
    enabled: true,
    config: { lookbackWeeks: 4, activeFromWeek: 3 },
  },
  {
    key: 'commute_distance',
    ruleType: 'weighted',
    label: 'Commute distance band',
    weight: 10,
    enabled: true,
    config: { values: { lt_10: 0, '10_25': 0.5, gt_25: 1 }, missing: 0.5 },
  },
  {
    key: 'client_facing',
    ruleType: 'weighted',
    label: 'Client-facing role',
    weight: 10,
    enabled: true,
    config: { missing: 0.5 },
  },
  {
    key: 'seniority',
    ruleType: 'weighted',
    label: 'Seniority or tenure',
    weight: 5,
    enabled: true,
    config: { fullScoreYears: 10, missing: 0.5 },
  },
  {
    key: 'carpool',
    ruleType: 'weighted',
    label: 'Verified carpool (P2)',
    weight: 0,
    enabled: false,
    config: {},
  },
  {
    key: 'peak_day_cap',
    ruleType: 'cap',
    label: 'At most 3 peak days per employee per week',
    weight: null,
    enabled: true,
    config: { maxDays: 3, period: 'week', peakWeekdays: [2, 3, 4] },
  },
  {
    key: 'random_draw',
    ruleType: 'tie_breaker',
    label: 'Seeded, logged random draw',
    weight: null,
    enabled: true,
    config: {},
  },
];
