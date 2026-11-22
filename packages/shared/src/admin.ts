/**
 * Admin (M2) request/response schemas: site setup (FR-26), approvals (FR-13),
 * policy versions, rules and feasibility (FR-8, FR-9, FR-11, FR-12).
 */
import { z } from 'zod';
import { RULE_KEYS } from './catalogue';
import { BAY_TYPES, ROLES, ZONE_KINDS } from './constants';
import { GAMING_RISKS, PRIVACY_CLASSES, rulesInputSchema, storedRuleSchema } from './rules';
import { siteSettingsSchema } from './settings';
import { isoDateSchema } from './time';

const id = z.string().min(1);
const isoDateTime = z.string();
const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
export const idParamsSchema = z.object({ id });

// --- site ------------------------------------------------------------------
export const siteResponseSchema = z.object({
  id,
  name: z.string(),
  timezone: z.string(),
  aiStage: z.number().int(),
  settings: siteSettingsSchema,
  nextWeeklyRound: z.object({ runAt: isoDateTime, targetWeek: isoDateSchema }),
});
export type SiteResponse = z.infer<typeof siteResponseSchema>;
export const siteSettingsInputSchema = siteSettingsSchema;

// --- zones -----------------------------------------------------------------
export const zoneSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(ZONE_KINDS),
  capacity: z.number().int().nullable(),
  bayCount: z.number().int(),
});
export type Zone = z.infer<typeof zoneSchema>;
export const zonesResponseSchema = listOf(zoneSchema);
export const zoneCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(ZONE_KINDS),
  capacity: z.number().int().min(1).max(5000).nullable().default(null),
});
export const zoneUpdateSchema = zoneCreateSchema.partial();

// --- bays ------------------------------------------------------------------
const bayCode = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only');

export const baySchema = z.object({
  id,
  zoneId: id,
  code: z.string(),
  bayType: z.enum(BAY_TYPES),
  hasCharger: z.boolean(),
  active: z.boolean(),
});
export type Bay = z.infer<typeof baySchema>;
export const baysResponseSchema = listOf(baySchema);
export const baysQuerySchema = z.object({ zoneId: id.optional() });
export const bayCreateSchema = z.object({
  zoneId: id,
  code: bayCode,
  bayType: z.enum(BAY_TYPES),
  hasCharger: z.boolean().optional(),
});
export const bayBulkCreateSchema = z.object({
  zoneId: id,
  prefix: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
  start: z.number().int().min(0).max(9999).default(1),
  count: z.number().int().min(1).max(500),
  bayType: z.enum(BAY_TYPES),
  hasCharger: z.boolean().optional(),
});
export const bayUpdateSchema = z
  .object({
    zoneId: id,
    bayType: z.enum(BAY_TYPES),
    hasCharger: z.boolean(),
    active: z.boolean(),
  })
  .partial();

// --- bay blocks ------------------------------------------------------------
export const bayBlockSchema = z.object({
  id,
  bayId: z.string().nullable(),
  bayCode: z.string().nullable(),
  zoneId: z.string().nullable(),
  zoneName: z.string().nullable(),
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema,
  reason: z.string(),
  createdAt: isoDateTime,
});
export type BayBlock = z.infer<typeof bayBlockSchema>;
export const bayBlocksResponseSchema = listOf(bayBlockSchema);
export const bayBlocksQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export const bayBlockCreateSchema = z
  .object({
    bayIds: z.array(id).min(1).max(500).optional(),
    zoneId: id.optional(),
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
    /** Shown to employees. */
    reason: z.string().trim().min(3).max(200),
  })
  .refine((b) => (b.bayIds ? 1 : 0) + (b.zoneId ? 1 : 0) === 1, {
    message: 'Block either specific bays or a whole zone.',
    path: ['bayIds'],
  })
  .refine((b) => b.dateTo >= b.dateFrom, {
    message: 'End date must be on or after the start date.',
    path: ['dateTo'],
  });

// --- users and approvals ---------------------------------------------------
export const userSummarySchema = z.object({
  id,
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
});
export const usersResponseSchema = listOf(userSummarySchema);
export const usersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
});

export const approvalSchema = z.object({
  id,
  userId: id,
  userName: z.string(),
  kind: z.literal('accessible'),
  /** Last site-local day the approval is valid. */
  expiresOn: isoDateSchema,
  approvedBy: id,
  createdAt: isoDateTime,
  revokedAt: isoDateTime.nullable(),
  active: z.boolean(),
});
export type Approval = z.infer<typeof approvalSchema>;
export const approvalsResponseSchema = listOf(approvalSchema);
export const approvalCreateSchema = z.object({ userId: id, expiresOn: isoDateSchema });

// --- policy ----------------------------------------------------------------
export const POLICY_VERSION_STATUSES = ['draft', 'scheduled', 'active', 'superseded'] as const;
export type PolicyVersionStatus = (typeof POLICY_VERSION_STATUSES)[number];

export const policyRuleSchema = storedRuleSchema;
export const policyIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  ruleKey: z.string().optional(),
});
export type PolicyIssue = z.infer<typeof policyIssueSchema>;

export const policyVersionSummarySchema = z.object({
  id,
  version: z.number().int(),
  status: z.enum(POLICY_VERSION_STATUSES),
  effectiveFromWeek: isoDateSchema.nullable(),
  publishedAt: isoDateTime.nullable(),
  publishedBy: z.string().nullable(),
});
export type PolicyVersionSummary = z.infer<typeof policyVersionSummarySchema>;
export const policyResponseSchema = z.object({
  id,
  name: z.string(),
  versions: z.array(policyVersionSummarySchema),
  maxFactorWeightPercent: z.number(),
  nextWeeklyRound: z.object({ runAt: isoDateTime, targetWeek: isoDateSchema }),
});

export const policyVersionDetailSchema = policyVersionSummarySchema.extend({
  rules: z.array(policyRuleSchema),
  plainLanguage: z.string(),
  /** Guardrail problems (weights, caps). Publishing is blocked while any exist. */
  issues: z.array(policyIssueSchema),
});
export type PolicyVersionDetail = z.infer<typeof policyVersionDetailSchema>;
export const versionParamsSchema = z.object({ version: z.coerce.number().int().min(1) });
export const rulesUpdateSchema = z.object({ rules: rulesInputSchema });
export const publishSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const feasibilityIssueSchema = z.object({
  severity: z.enum(['block', 'warn']),
  code: z.string(),
  message: z.string(),
});
export const ruleFeasibilitySchema = z.object({
  key: z.enum(RULE_KEYS),
  /** Share of active employees with the data (0–1). Null when not applicable. */
  coverage: z.number().min(0).max(1).nullable(),
  employeesWithData: z.number().int().nullable(),
  activeEmployees: z.number().int(),
  dataSource: z.string(),
  privacyClass: z.enum(PRIVACY_CLASSES),
  gamingRisk: z.enum(GAMING_RISKS),
  issues: z.array(feasibilityIssueSchema),
});
export type RuleFeasibility = z.infer<typeof ruleFeasibilitySchema>;
export const feasibilityRequestSchema = z.object({ rules: rulesInputSchema });
export const feasibilityResponseSchema = z.object({
  items: z.array(ruleFeasibilitySchema),
  blocking: z.boolean(),
});
export type FeasibilityResponse = z.infer<typeof feasibilityResponseSchema>;

// --- employee: current policy ---------------------------------------------
export const currentPolicyResponseSchema = z.object({
  version: z.number().int(),
  effectiveFromWeek: isoDateSchema,
  plainLanguage: z.string(),
  rules: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      ruleType: z.string(),
      weight: z.number().nullable(),
    }),
  ),
});
export type CurrentPolicyResponse = z.infer<typeof currentPolicyResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });

// --- rounds and collation (M4) ---------------------------------------------------
export const roundSummarySchema = z.object({
  id,
  roundType: z.enum(['weekly', 'daily', 'same_day']),
  targetDateFrom: isoDateSchema,
  targetDateTo: isoDateSchema,
  status: z.enum(['collecting', 'pending_review', 'published', 'failed']),
  runAt: isoDateTime.nullable(),
  approvalDeadline: isoDateTime.nullable(),
  /** Past the approval deadline and still pending (ADR-008). */
  delayed: z.boolean(),
  publishMode: z.enum(['admin', 'auto_same_day', 'auto_timeout', 'auto_stage3']).nullable(),
  publishedAt: isoDateTime.nullable(),
  counts: z.object({
    confirmed: z.number().int(),
    waitlisted: z.number().int(),
    ineligible: z.number().int(),
  }),
});
export type RoundSummary = z.infer<typeof roundSummarySchema>;
export const roundsResponseSchema = z.object({ items: z.array(roundSummarySchema) });
export const roundsQuerySchema = z.object({
  status: z.enum(['pending_review', 'published']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const collationCellSchema = z.object({
  bayType: z.enum(BAY_TYPES),
  /** Active bays of this type not blocked that day. */
  supply: z.number().int(),
  /** Held back for the same-day pool in weekly/daily rounds. */
  heldForSameDay: z.number().int(),
  requests: z.number().int(),
  confirmed: z.number().int(),
  waitlisted: z.number().int(),
  /** requests ÷ (supply − held). Null when nothing is allocatable. */
  oversubscription: z.number().nullable(),
  /** Expected requests still to come (same weekday, last 4 weeks). Null without history. */
  forecastRemaining: z.number().int().nullable(),
});
export const collationDaySchema = z.object({
  date: isoDateSchema,
  cells: z.array(collationCellSchema),
  rounds: z.array(
    z.object({ id, roundType: z.enum(['weekly', 'daily', 'same_day']), status: z.string() }),
  ),
});
export const collationResponseSchema = z.object({ days: z.array(collationDaySchema) });
export type CollationResponse = z.infer<typeof collationResponseSchema>;
export const collationQuerySchema = z.object({
  from: isoDateSchema.optional(),
  days: z.coerce.number().int().min(1).max(31).default(10),
});

// --- round review (M5, FR-15/FR-16) -------------------------------------------------
export const factorScoreSchema = z.object({
  key: z.string(),
  weight: z.number(),
  value: z.number(),
  contribution: z.number(),
  neutral: z.boolean(),
});
export type FactorScoreLike = z.infer<typeof factorScoreSchema>;
export const reviewDecisionSchema = z.object({
  allocationId: id,
  requestId: id,
  date: isoDateSchema,
  employee: z.object({ id, name: z.string() }),
  requestedBayType: z.enum(BAY_TYPES),
  arrivalWindow: z.string(),
  reasonCategory: z.string().nullable(),
  outcome: z.enum(['confirmed', 'waitlisted', 'ineligible']),
  bayId: z.string().nullable(),
  bayCode: z.string().nullable(),
  rank: z.number().int(),
  score: z.number(),
  factors: z.array(factorScoreSchema),
  reasonCode: z.string(),
  reasonText: z.string().nullable(),
  fallbackUsed: z.boolean(),
  capReached: z.boolean(),
  overridden: z.boolean(),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export const roundDetailSchema = roundSummarySchema.extend({
  seed: z.string(),
  policyVersion: z.number().int(),
  decisions: z.array(reviewDecisionSchema),
  /** Bays an admin could assign on each date (pending rounds only). */
  freeBays: z.array(
    z.object({
      date: isoDateSchema,
      bays: z.array(z.object({ id, code: z.string(), bayType: z.enum(BAY_TYPES) })),
    }),
  ),
});
export type RoundDetail = z.infer<typeof roundDetailSchema>;
export const approveRoundSchema = z.object({ note: z.string().trim().max(500).optional() });
export const overrideSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), bayId: id, reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('waitlist'), reason: z.string().trim().min(3).max(500) }),
]);
export type OverrideInput = z.infer<typeof overrideSchema>;

// --- audit (FR-16) ------------------------------------------------------------------
export const auditEntrySchema = z.object({
  id,
  at: isoDateTime,
  actor: z.object({ id, name: z.string() }).nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const auditQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  action: z.string().trim().max(60).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const auditResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
