import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_CATALOGUE } from './catalogue';
import { describePolicy } from './policy-text';
import { ruleInputSchema, rulesInputSchema } from './rules';
import { formatWeekdays, nextWeeklyRound } from './schedule';
import { DEFAULT_SITE_SETTINGS } from './settings';

const catalogueAsInput = () =>
  DEFAULT_RULE_CATALOGUE.map((r, order) => ({ ...r, order, config: { ...r.config } }));

describe('rule schemas', () => {
  it('every catalogue default passes its own config schema', () => {
    expect(rulesInputSchema.safeParse(catalogueAsInput()).success).toBe(true);
  });

  it('rejects out-of-range and unknown config values', () => {
    const [, , fairness] = catalogueAsInput();
    expect(ruleInputSchema.safeParse({ ...fairness, config: { lookbackWeeks: 99 } }).success).toBe(
      false,
    );
    expect(
      ruleInputSchema.safeParse({ ...fairness, config: { lookbackWeeks: 4, typo: 1 } }).success,
    ).toBe(false);
  });

  it('weights only on weighted rules, and rule types must match the catalogue', () => {
    const [reservation, , fairness] = catalogueAsInput();
    expect(ruleInputSchema.safeParse({ ...reservation, weight: 10 }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...fairness, weight: null }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...fairness, ruleType: 'cap' }).success).toBe(false);
  });

  it('rejects duplicate rules', () => {
    const rules = catalogueAsInput();
    expect(rulesInputSchema.safeParse([...rules, rules[2]]).success).toBe(false);
  });
});

describe('nextWeeklyRound (Fri 12:00 IST)', () => {
  const weekly = DEFAULT_SITE_SETTINGS.rounds.weekly;
  const at = (iso: string) => nextWeeklyRound(new Date(iso), 'Asia/Kolkata', weekly);

  it('before Friday noon: this Friday, allocating next week', () => {
    // Wed 25 Nov 2026, 10:00 IST
    expect(at('2026-11-25T04:30:00Z')).toMatchObject({
      runDate: '2026-11-27',
      targetWeek: '2026-11-30',
    });
  });

  it('after Friday noon: next Friday, so a policy waits for the week after next', () => {
    // Fri 27 Nov 2026, 12:01 IST
    expect(at('2026-11-27T06:31:00Z')).toMatchObject({
      runDate: '2026-12-04',
      targetWeek: '2026-12-07',
    });
  });

  it('uses the site time zone, not UTC', () => {
    // Thu 26 Nov 20:00 UTC = Fri 27 Nov 01:30 IST → still before Friday's run.
    const r = at('2026-11-26T20:00:00Z');
    expect(r.runDate).toBe('2026-11-27');
    expect(r.runAt.toISOString()).toBe('2026-11-27T06:30:00.000Z');
  });
});

describe('policy text', () => {
  it('describes the default policy in plain language', () => {
    const text = describePolicy(catalogueAsInput(), {
      version: 2,
      effectiveFromWeek: '2026-11-30',
    });
    expect(text).toContain('in force from the week of 30 Nov 2026');
    expect(text).toContain('Booking early gives no advantage');
    expect(text).toContain('- 35% — Fairness');
    expect(text).toContain('at most 3 peak days (Tue–Thu)');
    expect(text).not.toContain('carpool'); // disabled rules are left out
  });

  it('formats weekdays', () => {
    expect(formatWeekdays([4, 2, 3])).toBe('Tue–Thu');
    expect(formatWeekdays([1, 3])).toBe('Mon, Wed');
  });
});
