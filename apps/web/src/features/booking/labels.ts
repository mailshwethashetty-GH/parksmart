import { formatSiteTime, type DecidedBy } from '@parksmart/shared';
import type { TFunction } from 'i18next';

/** "Weekly round · Fri 27 Nov, 12:00 · answer by Fri 27 Nov, 14:00" */
export function decidedByText(t: TFunction, decided: DecidedBy, timeZone: string): string {
  const round = t(`booking.round.${decided.round}`);
  const runAt = formatSiteTime(decided.runAt, timeZone);
  if (decided.round === 'same_day') return t('booking.decidedSameDay', { round, runAt });
  return t('booking.decidedBy', {
    round,
    runAt,
    resultsBy: formatSiteTime(decided.resultsBy, timeZone),
  });
}

export const STATUS_VARIANT = {
  requested: 'outline',
  allocated: 'success',
  waitlisted: 'warning',
  withdrawn: 'secondary',
  expired: 'secondary',
} as const;
