/**
 * Which round will decide a request for `date`, and when the answer comes
 * (docs/03-allocation-model.md §1, FR-1 "employee sees which round will decide it").
 * Pure: callers pass `now`. Also defines the edit cutoff: a request is free to change
 * until its deciding round runs (FR-4).
 */
import type { SiteSettings } from './settings';
import {
  addDays,
  isWorkingDay,
  previousWorkingDay,
  siteLocalDate,
  siteLocalToUtc,
  weekStart,
  type IsoDate,
} from './time';

export const CLOSED_REASONS = [
  'PAST_DATE',
  'NOT_WORKING_DAY',
  'BEYOND_HORIZON',
  'SAME_DAY_CLOSED',
] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

export type DecidingRound =
  | { open: true; round: 'weekly' | 'daily' | 'same_day'; runAt: Date; resultsBy: Date }
  | { open: false; reason: ClosedReason };

const MINUTE = 60_000;

export function decidingRound(input: {
  date: IsoDate;
  now: Date;
  timeZone: string;
  settings: SiteSettings;
}): DecidingRound {
  const { date, now, timeZone: tz, settings } = input;
  const { weekly, daily, sameDay } = settings.rounds;
  const today = siteLocalDate(now, tz);

  if (date < today) return { open: false, reason: 'PAST_DATE' };
  if (!isWorkingDay(date, settings.workingDays)) return { open: false, reason: 'NOT_WORKING_DAY' };
  if (date > addDays(today, settings.bookingHorizonDays)) {
    return { open: false, reason: 'BEYOND_HORIZON' };
  }

  // Weekly round for the week containing `date` runs in the week before it.
  const weeklyDate = addDays(weekStart(date), -7 + (weekly.weekday - 1));
  const weeklyRun = siteLocalToUtc(weeklyDate, weekly.time, tz);
  if (now < weeklyRun) {
    return {
      open: true,
      round: 'weekly',
      runAt: weeklyRun,
      resultsBy: siteLocalToUtc(weeklyDate, weekly.approvalDeadline, tz),
    };
  }

  const dailyDate = previousWorkingDay(date, settings.workingDays);
  const dailyRun = siteLocalToUtc(dailyDate, daily.time, tz);
  if (now < dailyRun) {
    return {
      open: true,
      round: 'daily',
      runAt: dailyRun,
      resultsBy: siteLocalToUtc(dailyDate, daily.approvalDeadline, tz),
    };
  }

  // Same-day rounds run on `date` from startTime to endTime, every interval.
  const first = siteLocalToUtc(date, sameDay.startTime, tz);
  const last = siteLocalToUtc(date, sameDay.endTime, tz);
  const step = sameDay.intervalMinutes * MINUTE;
  let slot = first;
  if (now >= first) {
    const elapsed = Math.floor((now.getTime() - first.getTime()) / step) + 1;
    slot = new Date(first.getTime() + elapsed * step);
  }
  if (slot > last) return { open: false, reason: 'SAME_DAY_CLOSED' };
  return { open: true, round: 'same_day', runAt: slot, resultsBy: slot };
}
