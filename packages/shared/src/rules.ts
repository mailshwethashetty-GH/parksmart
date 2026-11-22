/**
 * Rule metadata and config schemas for the rule builder (FR-8, FR-11).
 * Config schemas are strict, so a typo or out-of-range value never reaches the engine.
 */
import { z } from 'zod';
import { DEFAULT_RULE_CATALOGUE, RULE_KEYS, type RuleKey } from './catalogue';
import { DISTANCE_BANDS, REASON_CATEGORIES, RULE_TYPES } from './constants';

export const PRIVACY_CLASSES = ['none', 'internal', 'personal', 'sensitive'] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

export const GAMING_RISKS = ['low', 'medium', 'high'] as const;
export type GamingRisk = (typeof GAMING_RISKS)[number];

/** Where a rule's data comes from, for the feasibility checks. */
export const COVERAGE_SOURCES = [
  'system', // computed by ParkSmart (allocation history, check-ins): always available
  'request', // given on each request; missing scores neutral
  'profile_distance',
  'profile_client_facing',
  'profile_join_date',
  'vehicle_ev',
  'approval',
  'not_available', // P2 data not collected yet
  'none', // caps and tie-breakers need no data
] as const;
export type CoverageSource = (typeof COVERAGE_SOURCES)[number];

export type RuleMeta = {
  dataSource: string;
  coverage: CoverageSource;
  privacyClass: PrivacyClass;
  gamingRisk: GamingRisk;
  selfDeclared: boolean;
};

export const RULE_META: Record<RuleKey, RuleMeta> = {
  accessibility_reservation: {
    dataSource: 'Admin-approved flag with an expiry date (no health records)',
    coverage: 'approval',
    privacyClass: 'sensitive',
    gamingRisk: 'low',
    selfDeclared: false,
  },
  ev_match: {
    dataSource: 'Vehicle type from the employee profile',
    coverage: 'vehicle_ev',
    privacyClass: 'personal',
    gamingRisk: 'medium',
    selfDeclared: true,
  },
  rolling_fairness: {
    dataSource: 'Peak days won in the last weeks (allocation history)',
    coverage: 'system',
    privacyClass: 'internal',
    gamingRisk: 'low',
    selfDeclared: false,
  },
  business_need: {
    dataSource: 'Reason category on the request (self-declared)',
    coverage: 'request',
    privacyClass: 'internal',
    gamingRisk: 'high',
    selfDeclared: true,
  },
  no_show_history: {
    dataSource: 'Missed check-ins (attendance)',
    coverage: 'system',
    privacyClass: 'personal',
    gamingRisk: 'low',
    selfDeclared: false,
  },
  commute_distance: {
    dataSource: 'Self-declared distance band (optional)',
    coverage: 'profile_distance',
    privacyClass: 'personal',
    gamingRisk: 'medium',
    selfDeclared: true,
  },
  client_facing: {
    dataSource: 'Role tag set by the admin or CSV import',
    coverage: 'profile_client_facing',
    privacyClass: 'personal',
    gamingRisk: 'low',
    selfDeclared: false,
  },
  seniority: {
    dataSource: 'Join date from CSV import (HRMS stubbed)',
    coverage: 'profile_join_date',
    privacyClass: 'personal',
    gamingRisk: 'low',
    selfDeclared: false,
  },
  carpool: {
    dataSource: 'All riders confirm in-app (P2)',
    coverage: 'not_available',
    privacyClass: 'personal',
    gamingRisk: 'medium',
    selfDeclared: true,
  },
  peak_day_cap: {
    dataSource: 'Allocation history',
    coverage: 'none',
    privacyClass: 'none',
    gamingRisk: 'low',
    selfDeclared: false,
  },
  random_draw: {
    dataSource: 'Seeded, logged random draw',
    coverage: 'none',
    privacyClass: 'none',
    gamingRisk: 'low',
    selfDeclared: false,
  },
};

const unit = z.number().min(0).max(1);
const percent = z.number().min(0).max(100);
const weekday = z.number().int().min(1).max(7);
const optionalNeutral = { missing: unit.optional() };

export const RULE_CONFIG_SCHEMAS: Record<RuleKey, z.ZodType<Record<string, unknown>>> = {
  accessibility_reservation: z
    // `purpose` is required to publish, but enforced by the feasibility check (clear message).
    .object({
      approvalKind: z.literal('accessible'),
      purpose: z.string().trim().max(300).optional(),
    })
    .strict(),
  ev_match: z.object({ bayType: z.literal('ev'), requiresEv: z.boolean() }).strict(),
  rolling_fairness: z
    .object({
      lookbackWeeks: z.number().int().min(1).max(12),
      peakWeekdays: z.array(weekday).min(1).optional(),
    })
    .strict(),
  business_need: z
    .object({
      values: z.partialRecord(z.enum(REASON_CATEGORIES), unit),
      spotCheckPercent: percent.optional(),
      ...optionalNeutral,
    })
    .strict(),
  no_show_history: z
    .object({
      lookbackWeeks: z.number().int().min(1).max(12),
      activeFromWeek: z.number().int().min(0).max(12),
      ...optionalNeutral,
    })
    .strict(),
  commute_distance: z
    .object({ values: z.partialRecord(z.enum(DISTANCE_BANDS), unit), ...optionalNeutral })
    .strict(),
  client_facing: z.object({ ...optionalNeutral }).strict(),
  seniority: z.object({ fullScoreYears: z.number().min(1).max(40), ...optionalNeutral }).strict(),
  carpool: z.object({}).strict(),
  peak_day_cap: z
    .object({
      maxDays: z.number().int().min(1).max(7),
      period: z.literal('week'),
      peakWeekdays: z.array(weekday).min(1),
    })
    .strict(),
  random_draw: z.object({}).strict(),
};

const catalogueType = Object.fromEntries(DEFAULT_RULE_CATALOGUE.map((r) => [r.key, r.ruleType]));

/**
 * Shape of a stored rule, used for responses. Deliberately loose: rules saved under an
 * older schema must still load (and show feasibility issues) rather than fail with a 500.
 */
export const storedRuleSchema = z.object({
  key: z.enum(RULE_KEYS),
  ruleType: z.enum(RULE_TYPES),
  label: z.string(),
  weight: z.number().nullable(),
  order: z.number().int(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});

/** A rule as edited in the builder. Strictly validated before it is stored. */
export const ruleInputSchema = storedRuleSchema
  .extend({
    label: z.string().trim().min(1).max(200),
    weight: z.number().min(0).max(100).nullable(),
    order: z.number().int().min(0),
  })
  .superRefine((rule, ctx) => {
    if (catalogueType[rule.key] !== rule.ruleType) {
      ctx.addIssue({
        code: 'custom',
        path: ['ruleType'],
        message: `${rule.key} is a ${catalogueType[rule.key]} rule.`,
      });
    }
    if (rule.ruleType === 'weighted' && rule.weight === null) {
      ctx.addIssue({ code: 'custom', path: ['weight'], message: 'Weighted rules need a weight.' });
    }
    if (rule.ruleType !== 'weighted' && rule.weight !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'Only weighted rules have a weight.',
      });
    }
    const parsed = RULE_CONFIG_SCHEMAS[rule.key].safeParse(rule.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['config', ...issue.path.map(String)],
          message: issue.message,
        });
      }
    }
  });
export type RuleInput = z.infer<typeof ruleInputSchema>;

export const rulesInputSchema = z
  .array(ruleInputSchema)
  .max(RULE_KEYS.length)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((r, i) => {
      if (seen.has(r.key))
        ctx.addIssue({ code: 'custom', path: [i, 'key'], message: `Duplicate rule ${r.key}.` });
      seen.add(r.key);
    });
  });
