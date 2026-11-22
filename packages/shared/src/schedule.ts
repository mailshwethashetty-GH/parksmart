/**
 * Round schedule helpers. Pure: callers pass `now`.
 */
import { formatInTimeZone } from 'date-fns-tz';
import type { SiteSettings } from './settings';
import {
  addDays,
  isoWeekday,
  siteLocalDate,
  siteLocalToUtc,
  weekStart,
  type IsoDate,
} from './time';

/**
 * The next weekly round still to run, and the week it allocates. A policy published
 * now takes effect from `targetWeek` (non-negotiable #8: never mid-round).
 */
export function nextWeeklyRound(
  now: Date,
  timeZone: string,
  weekly: SiteSettings['rounds']['weekly'],
): { runAt: Date; runDate: IsoDate; targetWeek: IsoDate } {
  const today = siteLocalDate(now, timeZone);
  let runDate = addDays(today, (weekly.weekday - isoWeekday(today) + 7) % 7);
  let runAt = siteLocalToUtc(runDate, weekly.time, timeZone);
  if (runAt.getTime() <= now.getTime()) {
    runDate = addDays(runDate, 7);
    runAt = siteLocalToUtc(runDate, weekly.time, timeZone);
  }
  return { runAt, runDate, targetWeek: addDays(weekStart(runDate), 7) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `2026-11-30` → `30 Nov 2026`. */
export function formatIsoDate(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** `[2, 3, 4]` → `Tue–Thu`; `[1, 3]` → `Mon, Wed`. */
export function formatWeekdays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (contiguous && sorted.length > 2) {
    return `${WEEKDAY_NAMES[sorted[0]! - 1]}–${WEEKDAY_NAMES[sorted.at(-1)! - 1]}`;
  }
  return sorted.map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
}

/** An instant shown in the site's time zone, e.g. `Fri 27 Nov, 12:00`. */
export function formatSiteTime(instant: Date | string, timeZone: string): string {
  return formatInTimeZone(new Date(instant), timeZone, 'EEE d MMM, HH:mm');
}

/** A date with its weekday, e.g. `Wed 2 Dec`. */
export function formatDayShort(date: IsoDate): string {
  return formatInTimeZone(new Date(`${date}T12:00:00Z`), 'UTC', 'EEE d MMM');
}
