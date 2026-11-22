/**
 * Feasibility checks before a rule can be published (FR-11, P0 part):
 * data coverage, privacy class and gaming risk. The 4-week impact simulation is P1.
 */
import { userProfiles, users, vehicles, type Db } from '@parksmart/db';
import {
  RULE_META,
  type CoverageSource,
  type FeasibilityResponse,
  type RuleFeasibility,
  type RuleInput,
} from '@parksmart/shared';
import { and, countDistinct, eq, isNotNull } from 'drizzle-orm';

export const COVERAGE_THRESHOLD = 0.9;

type Issue = RuleFeasibility['issues'][number];
const pct = (n: number) => `${Math.round(n * 100)}%`;

function coverageCounts(db: Db, siteId: string) {
  const activeEmployee = and(
    eq(users.siteId, siteId),
    eq(users.role, 'employee'),
    eq(users.active, true),
  );
  const countProfiles = (column: Parameters<typeof isNotNull>[0]) =>
    db
      .select({ n: countDistinct(users.id) })
      .from(users)
      .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(activeEmployee, isNotNull(column)))
      .get()!.n;
  const active = db
    .select({ n: countDistinct(users.id) })
    .from(users)
    .where(activeEmployee)
    .get()!.n;
  const withVehicle = db
    .select({ n: countDistinct(users.id) })
    .from(users)
    .innerJoin(vehicles, eq(vehicles.userId, users.id))
    .where(activeEmployee)
    .get()!.n;
  const counts: Partial<Record<CoverageSource, number>> = {
    profile_distance: countProfiles(userProfiles.distanceBand),
    profile_client_facing: countProfiles(userProfiles.clientFacing),
    profile_join_date: countProfiles(userProfiles.joinDate),
    vehicle_ev: withVehicle,
    not_available: 0,
  };
  return { active, counts };
}

export function checkFeasibility(
  db: Db,
  siteId: string,
  rules: readonly RuleInput[],
): FeasibilityResponse {
  const { active, counts } = coverageCounts(db, siteId);
  const items = rules.map((rule): RuleFeasibility => {
    const meta = RULE_META[rule.key];
    const issues: Issue[] = [];
    const withData = counts[meta.coverage];
    const coverage = withData === undefined || active === 0 ? null : withData / active;
    const scoring = rule.enabled && rule.ruleType === 'weighted' && (rule.weight ?? 0) > 0;
    const neutral = rule.config.missing;

    if (rule.enabled && meta.coverage === 'not_available') {
      if (scoring) {
        issues.push({
          severity: 'block',
          code: 'DATA_NOT_AVAILABLE',
          message: 'This data is not collected yet (P2). Set its weight to 0% or disable it.',
        });
      }
    } else if (rule.enabled && coverage !== null && coverage < COVERAGE_THRESHOLD) {
      const share = `Only ${pct(coverage)} of active employees (${withData}/${active}) have this data.`;
      if (scoring && typeof neutral !== 'number') {
        issues.push({
          severity: 'block',
          code: 'COVERAGE_LOW_NO_NEUTRAL',
          message: `${share} Choose a neutral value for missing data before publishing.`,
        });
      } else if (scoring) {
        issues.push({
          severity: 'warn',
          code: 'COVERAGE_LOW',
          message: `${share} The rest score the neutral value (${neutral}).`,
        });
      } else {
        issues.push({ severity: 'warn', code: 'COVERAGE_LOW', message: share });
      }
    }
    if (rule.enabled && active === 0 && withData !== undefined) {
      issues.push({
        severity: 'warn',
        code: 'NO_EMPLOYEES',
        message: 'No active employees yet, so coverage cannot be measured.',
      });
    }

    if (scoring && meta.gamingRisk === 'high') {
      const rate = rule.config.spotCheckPercent;
      if (typeof rate !== 'number') {
        issues.push({
          severity: 'block',
          code: 'SPOT_CHECK_REQUIRED',
          message: 'Self-declared and easy to game. Set a spot-check rate before publishing.',
        });
      } else {
        issues.push({
          severity: 'warn',
          code: 'SELF_DECLARED',
          message: `Self-declared; ${rate}% of claims are spot-checked.`,
        });
      }
    } else if (rule.enabled && meta.selfDeclared) {
      issues.push({
        severity: 'warn',
        code: 'SELF_DECLARED',
        message: 'Self-declared by employees.',
      });
    }

    if (rule.enabled && meta.privacyClass === 'sensitive') {
      const purpose = rule.config.purpose;
      if (typeof purpose !== 'string' || purpose.trim().length === 0) {
        issues.push({
          severity: 'block',
          code: 'PURPOSE_REQUIRED',
          message: 'Sensitive data needs a stated purpose (DPDP Act).',
        });
      }
    }

    return {
      key: rule.key,
      coverage,
      employeesWithData: withData ?? null,
      activeEmployees: active,
      dataSource: meta.dataSource,
      privacyClass: meta.privacyClass,
      gamingRisk: meta.gamingRisk,
      issues,
    };
  });
  return { items, blocking: items.some((i) => i.issues.some((x) => x.severity === 'block')) };
}
