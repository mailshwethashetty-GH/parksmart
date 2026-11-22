/**
 * Check-in deadline (FR-22). A confirmed bay is auto-released if nobody checks in by:
 *   max(end of the arrival window, when the booking was made) + grace
 *   (+ the "running late" extension, if used).
 * "after 13:00" ends at 15:00 for this purpose. Pure: callers pass the booking facts.
 */
import type { ArrivalWindow } from './constants';
import type { SiteSettings } from './settings';
import { siteLocalToUtc, type IsoDate } from './time';

export const ARRIVAL_WINDOW_END: Record<ArrivalWindow, string> = {
  before_9: '09:00',
  '9_to_11': '11:00',
  '11_to_13': '13:00',
  after_13: '15:00',
};

export function checkInDeadline(input: {
  date: IsoDate;
  arrivalWindow: ArrivalWindow;
  bookedAt: Date;
  lateExtensionUsed: boolean;
  timeZone: string;
  settings: SiteSettings;
}): Date {
  const windowEnd = siteLocalToUtc(
    input.date,
    ARRIVAL_WINDOW_END[input.arrivalWindow],
    input.timeZone,
  );
  const base = Math.max(windowEnd.getTime(), input.bookedAt.getTime());
  const extra = input.lateExtensionUsed ? input.settings.lateExtensionMinutes : 0;
  return new Date(base + (input.settings.graceMinutes + extra) * 60_000);
}
