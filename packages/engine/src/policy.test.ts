import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validatePolicy } from './policy';
import { catalogueRules } from './test-arbitraries';

describe('validatePolicy (guardrails)', () => {
  it('accepts the default catalogue', () => {
    expect(validatePolicy(catalogueRules(), 50)).toEqual([]);
  });

  it('weights must total 100%', () => {
    const rules = catalogueRules({ seniority: { weight: 10 } });
    expect(validatePolicy(rules, 50).map((e) => e.code)).toContain('POLICY_WEIGHTS_INVALID');
  });

  it('no factor may exceed the cap', () => {
    const rules = catalogueRules({
      rolling_fairness: { weight: 55 },
      business_need: { weight: 5 },
    });
    expect(validatePolicy(rules, 50).map((e) => e.code)).toContain('POLICY_FACTOR_OVER_CAP');
  });

  it('disabled factors do not count towards the total', () => {
    const rules = catalogueRules({ seniority: { enabled: false }, client_facing: { weight: 15 } });
    expect(validatePolicy(rules, 50)).toEqual([]);
  });

  it('property: any weights accepted total 100 and respect the cap', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 6, maxLength: 6 }),
        (w) => {
          const keys = [
            'rolling_fairness',
            'business_need',
            'no_show_history',
            'commute_distance',
            'client_facing',
            'seniority',
          ];
          const rules = catalogueRules(
            Object.fromEntries(keys.map((k, i) => [k, { weight: w[i] }])),
          );
          const ok = validatePolicy(rules, 50).length === 0;
          const total = w.reduce((s, x) => s + x, 0);
          expect(ok).toBe(total === 100 && w.every((x) => x <= 50));
        },
      ),
    );
  });
});
