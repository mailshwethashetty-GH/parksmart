/**
 * Plain-language reasons (FR-15). Deterministic templates, always available; the AI may
 * rewrite them later but never replaces the facts. Employee text stays under 40 words.
 */
import type { Decision, FactorScore } from '@parksmart/engine';
import { formatDayShort, type BayType, type RoundType } from '@parksmart/shared';

export const MAX_REASON_WORDS = 40;

const FACTOR_PHRASES: Record<string, string> = {
  rolling_fairness: 'fewer recent peak days',
  business_need: 'business need',
  no_show_history: 'reliable check-ins',
  commute_distance: 'commute distance',
  client_facing: 'client-facing role',
  seniority: 'tenure',
  carpool: 'carpool',
};

const TYPE_WORD: Record<BayType, string> = {
  car: 'car',
  ev: 'EV',
  accessible: 'accessible',
  two_wheeler: 'two-wheeler',
  carpool: 'carpool',
};

export type ReasonContext = {
  roundType: RoundType;
  requestedType: BayType;
  bayCode: string | null;
  /** Eligible requests ranked for that date. */
  rankedCount: number;
  capMaxDays: number | null;
};

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** The two factors that added most to the score, ignoring neutral (missing-data) values. */
export function topFactors(factors: FactorScore[], n = 2): string[] {
  return [...factors]
    .filter((f) => !f.neutral && f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key))
    .slice(0, n)
    .map((f) => FACTOR_PHRASES[f.key] ?? f.key.replace(/_/g, ' '));
}

export function templateReason(d: Decision, ctx: ReasonContext): string {
  const day = formatDayShort(d.date);
  const type = TYPE_WORD[ctx.requestedType];
  const rank =
    d.rank && ctx.rankedCount ? `Your score ranked ${d.rank} of ${ctx.rankedCount}` : null;
  const top = topFactors(d.breakdown);
  const why = top.length ? `; ${top.join(' and ')} counted most` : '';

  switch (d.reasonCode) {
    case 'allocated':
      return ctx.roundType === 'same_day'
        ? `A bay (${ctx.bayCode}) became free for ${day} and was offered to you first. ${rank}${why}.`
        : `You have bay ${ctx.bayCode} on ${day}. ${rank}${why}.`;
    case 'allocated_fallback':
      return `No ${type} bay was left on ${day}, so you have car bay ${ctx.bayCode}. ${rank}${why}.`;
    case 'allocated_overflow':
      return `An unused EV bay (${ctx.bayCode}) was opened to car requests on ${day}, and it is offered to you. ${rank}.`;
    case 'no_bay_left':
      // No waitlist number here: it changes with overrides and later rounds, and the
      // live position is shown separately.
      return `All ${type} bays for ${day} went to higher scores, so you are on the waitlist. ${rank}${why}.`;
    case 'cap_reached':
      return `You have reached this week's limit of ${ctx.capMaxDays ?? 'your'} peak days, so others went first on ${day}. You stay on the waitlist in case bays remain.`;
    case 'no_bays_of_type':
      return `This site has no ${type} bays, so your request for ${day} could not be met.`;
    case 'not_ev':
      return `EV bays are for registered electric vehicles, and your profile has none. Request a car bay for ${day} instead.`;
    case 'accessible_not_approved':
      return `Accessible bays need an approval valid on ${day}. Please contact your parking admin.`;
  }
}

/** Employee-facing text after an admin override (the admin's own reason stays internal). */
export function overrideReason(
  action: 'assign' | 'waitlist',
  date: string,
  bayCode: string | null,
): string {
  const day = formatDayShort(date);
  return action === 'assign'
    ? `Your parking admin assigned you bay ${bayCode} on ${day}.`
    : `Your parking admin moved your request for ${day} to the waitlist.`;
}
