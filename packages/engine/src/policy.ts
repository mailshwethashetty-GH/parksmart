/**
 * Policy guardrails (docs/03-allocation-model.md §2): enabled weighted factors total
 * 100% and none exceeds the per-factor cap. Shared by the engine and the policy service.
 */
import { FACTOR_KEYS } from './factors';
import type { EngineRule } from './types';

export type PolicyErrorCode =
  | 'POLICY_WEIGHTS_INVALID'
  | 'POLICY_FACTOR_OVER_CAP'
  | 'POLICY_WEIGHT_MISSING'
  | 'POLICY_UNKNOWN_FACTOR';

export type PolicyError = { code: PolicyErrorCode; message: string; ruleKey?: string };

const EPSILON = 1e-9;

export function validatePolicy(
  rules: readonly EngineRule[],
  maxFactorWeightPercent: number,
): PolicyError[] {
  const errors: PolicyError[] = [];
  const weighted = rules.filter((r) => r.ruleType === 'weighted' && r.enabled);

  for (const r of weighted) {
    if (!FACTOR_KEYS.has(r.key)) {
      errors.push({
        code: 'POLICY_UNKNOWN_FACTOR',
        message: `No scoring function for factor "${r.key}".`,
        ruleKey: r.key,
      });
    }
    if (r.weight === null || !Number.isFinite(r.weight) || r.weight < 0) {
      errors.push({
        code: 'POLICY_WEIGHT_MISSING',
        message: `Factor "${r.key}" needs a weight of 0% or more.`,
        ruleKey: r.key,
      });
    } else if (r.weight > maxFactorWeightPercent + EPSILON) {
      errors.push({
        code: 'POLICY_FACTOR_OVER_CAP',
        message: `Factor "${r.key}" is ${r.weight}%; no factor may exceed ${maxFactorWeightPercent}%.`,
        ruleKey: r.key,
      });
    }
  }

  const total = weighted.reduce((sum, r) => sum + (r.weight ?? 0), 0);
  if (Math.abs(total - 100) > EPSILON) {
    errors.push({
      code: 'POLICY_WEIGHTS_INVALID',
      message: `Weights must total 100% (currently ${total}%).`,
    });
  }
  return errors;
}
