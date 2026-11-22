import { describe, expect, it } from 'vitest';
import { checkInDeadline } from './checkin';
import { DEFAULT_SITE_SETTINGS } from './settings';

const ist = (local: string) => new Date(`${local}:00+05:30`);
const deadline = (
  arrivalWindow: Parameters<typeof checkInDeadline>[0]['arrivalWindow'],
  bookedAt: string,
  lateExtensionUsed = false,
) =>
  checkInDeadline({
    date: '2026-12-01',
    arrivalWindow,
    bookedAt: ist(bookedAt),
    lateExtensionUsed,
    timeZone: 'Asia/Kolkata',
    settings: DEFAULT_SITE_SETTINGS,
  }).toISOString();

describe('check-in deadline (FR-22)', () => {
  it('is the end of the arrival window plus the 15-minute grace', () => {
    expect(deadline('before_9', '2026-11-27T12:00')).toBe(ist('2026-12-01T09:15').toISOString());
    expect(deadline('9_to_11', '2026-11-27T12:00')).toBe(ist('2026-12-01T11:15').toISOString());
    expect(deadline('after_13', '2026-11-27T12:00')).toBe(ist('2026-12-01T15:15').toISOString());
  });

  it('starts from the booking time if the bay was booked late (e.g. a same-day offer)', () => {
    expect(deadline('before_9', '2026-12-01T09:20')).toBe(ist('2026-12-01T09:35').toISOString());
  });

  it('adds the running-late extension (30 min)', () => {
    expect(deadline('before_9', '2026-11-27T12:00', true)).toBe(
      ist('2026-12-01T09:45').toISOString(),
    );
  });
});
