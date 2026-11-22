import { describe, expect, it } from 'vitest';
import { decidingRound } from './deciding-round';
import { DEFAULT_SITE_SETTINGS } from './settings';

const IST = 'Asia/Kolkata';
// IST is UTC+05:30. Helper: site-local "YYYY-MM-DD HH:mm" → Date.
const at = (local: string) => {
  const [d, t] = local.split(' ');
  const [h, m] = t!.split(':').map(Number);
  const utc = new Date(`${d}T00:00:00Z`).getTime() + (h! * 60 + m! - 330) * 60_000;
  return new Date(utc);
};
const decide = (date: string, now: string) =>
  decidingRound({ date, now: at(now), timeZone: IST, settings: DEFAULT_SITE_SETTINGS });
const local = (d: Date | null | undefined) => d && d.toISOString();

// Week of Mon 30 Nov 2026. Its weekly round runs Fri 27 Nov 12:00.
describe('decidingRound', () => {
  it('before the weekly round: the weekly round decides, answer by its approval deadline', () => {
    const r = decide('2026-12-02', '2026-11-25 10:00');
    expect(r).toMatchObject({ open: true, round: 'weekly' });
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-11-27 12:00')));
    expect(local(r.open ? r.resultsBy : null)).toBe(local(at('2026-11-27 14:00')));
  });

  it('weeks ahead: still that week’s weekly round', () => {
    const r = decide('2026-12-16', '2026-11-25 10:00');
    expect(r).toMatchObject({ open: true, round: 'weekly' });
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-12-11 12:00')));
  });

  it('after the weekly round ran: the daily round on the working day before', () => {
    const r = decide('2026-12-02', '2026-11-27 12:30');
    expect(r).toMatchObject({ open: true, round: 'daily' });
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-12-01 18:00')));
    expect(local(r.open ? r.resultsBy : null)).toBe(local(at('2026-12-01 19:00')));
  });

  it('Monday’s daily round runs on Friday evening', () => {
    const r = decide('2026-11-30', '2026-11-27 13:00');
    expect(r).toMatchObject({ open: true, round: 'daily' });
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-11-27 18:00')));
  });

  it('after the daily round ran: same-day rounds on the day, from 07:00', () => {
    const r = decide('2026-12-02', '2026-12-01 18:30');
    expect(r).toMatchObject({ open: true, round: 'same_day' });
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-12-02 07:00')));
  });

  it('on the day: the next same-day slot on the 30-minute grid', () => {
    const r = decide('2026-12-02', '2026-12-02 09:10');
    expect(r).toMatchObject({ open: true, round: 'same_day' });
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-12-02 09:30')));
  });

  it('exactly on a slot boundary waits for the next slot', () => {
    const r = decide('2026-12-02', '2026-12-02 09:30');
    expect(local(r.open ? r.runAt : null)).toBe(local(at('2026-12-02 10:00')));
  });

  it('closes after the last same-day round', () => {
    expect(decide('2026-12-02', '2026-12-02 17:01')).toEqual({
      open: false,
      reason: 'SAME_DAY_CLOSED',
    });
  });

  it('rejects past dates, non-working days and dates beyond the horizon', () => {
    expect(decide('2026-12-01', '2026-12-02 08:00')).toEqual({ open: false, reason: 'PAST_DATE' });
    expect(decide('2026-12-05', '2026-11-25 10:00')).toEqual({
      open: false,
      reason: 'NOT_WORKING_DAY',
    });
    expect(decide('2026-12-24', '2026-11-25 10:00')).toEqual({
      open: false,
      reason: 'BEYOND_HORIZON',
    });
  });
});
