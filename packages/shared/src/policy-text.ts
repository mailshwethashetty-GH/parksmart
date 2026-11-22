/**
 * Plain-language policy shown to every employee (FR-12). Template-based and
 * deterministic; the AI never writes or changes the policy.
 */
import type { RuleKey } from './catalogue';
import { formatIsoDate, formatWeekdays } from './schedule';
import type { IsoDate } from './time';

type PolicyRule = {
  key: string;
  ruleType: string;
  label: string;
  weight: number | null;
  enabled: boolean;
  config: Record<string, unknown>;
};

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

const FACTOR_TEXT: Partial<Record<RuleKey, (c: Record<string, unknown>) => string>> = {
  rolling_fairness: (c) =>
    `Fairness: the fewer peak days you have won in the last ${num(c.lookbackWeeks, 4)} weeks, the higher you score.`,
  business_need: () =>
    'Business need: the reason you give for the day (client visit, event, medical appointment, other). Reasons are spot-checked.',
  no_show_history: () =>
    'Reliability: missed check-ins lower your score. Counted only once enough pilot data exists.',
  commute_distance: () =>
    'Commute distance: longer commutes score higher. Optional; skipping it scores neutral.',
  client_facing: () => 'Client-facing role: set by your admin. Unknown scores neutral.',
  seniority: (c) =>
    `Tenure: longer service scores higher, up to ${num(c.fullScoreYears, 10)} years. Unknown scores neutral.`,
  carpool: () => 'Verified carpool.',
};

export function describePolicy(
  rules: readonly PolicyRule[],
  meta: { version: number; effectiveFromWeek: IsoDate | null },
): string {
  const on = rules.filter((r) => r.enabled);
  const has = (key: string) => on.find((r) => r.key === key);
  const lines: string[] = [];

  lines.push(
    meta.effectiveFromWeek
      ? `Policy version ${meta.version}, in force from the week of ${formatIsoDate(meta.effectiveFromWeek)}.`
      : `Policy version ${meta.version} (draft).`,
  );
  lines.push(
    'Requests for each day are collected and allocated together in scheduled rounds. Booking early gives no advantage.',
  );

  const reserved: string[] = [];
  if (has('accessibility_reservation')) {
    reserved.push('Accessible bays go only to employees with an approved accessibility need.');
  }
  if (has('ev_match')) reserved.push('EV charger bays go only to registered electric vehicles.');
  if (reserved.length) lines.push('', 'Reserved first:', ...reserved.map((r) => `- ${r}`));

  const weighted = on
    .filter((r) => r.ruleType === 'weighted' && (r.weight ?? 0) > 0)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  if (weighted.length) {
    lines.push('', 'How requests are scored (weights total 100%):');
    for (const r of weighted) {
      const text = FACTOR_TEXT[r.key as RuleKey]?.(r.config) ?? r.label;
      lines.push(`- ${r.weight}% — ${text}`);
    }
  }

  const cap = has('peak_day_cap');
  if (cap) {
    const days = (cap.config.peakWeekdays as number[] | undefined) ?? [2, 3, 4];
    lines.push(
      '',
      `Limit: at most ${num(cap.config.maxDays, 3)} peak days (${formatWeekdays(days)}) per person per week.`,
    );
  }
  if (has('random_draw'))
    lines.push('', 'Ties: equal scores are settled by a recorded random draw.');
  lines.push(
    '',
    'If no bay of your type is left, EV and accessible requests may get a car bay unless you opt out.',
  );
  return lines.join('\n');
}
