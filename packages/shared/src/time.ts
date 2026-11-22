/**
 * Time helpers. Rule: all site times are in the site's time zone; the DB stores UTC.
 * A "date" (a parking day) is a site-local `YYYY-MM-DD` string.
 * Weekdays use ISO numbering: 1 = Monday … 7 = Sunday.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

export type IsoDate = string;

/** Site-local calendar date for an instant. */
export function siteLocalDate(instant: Date, timeZone: string): IsoDate {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/** UTC instant for a site-local date and time of day. */
export function siteLocalToUtc(date: IsoDate, time: string, timeZone: string): Date {
  return fromZonedTime(`${date}T${time}:00`, timeZone);
}

function parse(date: IsoDate): Date {
  const parsed = isoDateSchema.safeParse(date);
  if (!parsed.success) throw new Error(`Invalid date: ${date}`);
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return d;
}

/** Calendar arithmetic on a date string (no time zone involved). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a date string: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const day = parse(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week containing `date`. Used for `policy_versions.effective_from_week`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function isWorkingDay(date: IsoDate, workingDays: readonly number[]): boolean {
  return workingDays.includes(isoWeekday(date));
}

/** The last working day strictly before `date` (e.g. Friday for Monday). */
export function previousWorkingDay(date: IsoDate, workingDays: readonly number[]): IsoDate {
  if (workingDays.length === 0) throw new Error('Site has no working days');
  let d = addDays(date, -1);
  while (!isWorkingDay(d, workingDays)) d = addDays(d, -1);
  return d;
}

/** The first working day strictly after `date`. */
export function nextWorkingDay(date: IsoDate, workingDays: readonly number[]): IsoDate {
  if (workingDays.length === 0) throw new Error('Site has no working days');
  let d = addDays(date, 1);
  while (!isWorkingDay(d, workingDays)) d = addDays(d, 1);
  return d;
}
