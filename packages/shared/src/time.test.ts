import { describe, expect, it } from 'vitest';
import {
  addDays,
  isoWeekday,
  nextWorkingDay,
  previousWorkingDay,
  siteLocalDate,
  siteLocalToUtc,
  weekStart,
} from './time';
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from './settings';
import { DEFAULT_RULE_CATALOGUE } from './catalogue';

const IST = 'Asia/Kolkata';
const MON_FRI = [1, 2, 3, 4, 5];

describe('time helpers', () => {
  it('uses the site time zone for the calendar date', () => {
    // 2026-11-23T20:00Z is 01:30 on the 24th in IST.
    expect(siteLocalDate(new Date('2026-11-23T20:00:00Z'), IST)).toBe('2026-11-24');
    expect(siteLocalDate(new Date('2026-11-23T18:00:00Z'), IST)).toBe('2026-11-23');
  });

  it('converts site-local times to UTC', () => {
    expect(siteLocalToUtc('2026-11-27', '12:00', IST).toISOString()).toBe(
      '2026-11-27T06:30:00.000Z',
    );
  });

  it('does calendar arithmetic across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('rejects invalid dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow();
    expect(() => addDays('26-1-1', 1)).toThrow();
  });

  it('finds the week start and weekday', () => {
    expect(isoWeekday('2026-11-22')).toBe(7); // Sunday
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
  });

  it('daily round for Monday runs on Friday (previous working day)', () => {
    expect(previousWorkingDay('2026-11-23', MON_FRI)).toBe('2026-11-20');
    expect(previousWorkingDay('2026-11-25', MON_FRI)).toBe('2026-11-24');
    expect(nextWorkingDay('2026-11-20', MON_FRI)).toBe('2026-11-23');
  });
});

describe('site settings', () => {
  it('fills defaults from docs/03', () => {
    expect(DEFAULT_SITE_SETTINGS.rounds.weekly).toEqual({
      weekday: 5,
      time: '12:00',
      approvalDeadline: '14:00',
    });
    expect(DEFAULT_SITE_SETTINGS.sameDayPoolPercent).toBe(10);
    expect(DEFAULT_SITE_SETTINGS.evOverflowSameDay).toBe(false);
    expect(DEFAULT_SITE_SETTINGS.autoPublishAtDayStart).toBe(true);
  });

  it('caps the grace window at 30 minutes', () => {
    expect(() => parseSiteSettings({ graceMinutes: 45 })).toThrow();
  });
});

describe('rule catalogue', () => {
  it('weighted factors total 100% and none exceeds 50%', () => {
    const weighted = DEFAULT_RULE_CATALOGUE.filter((r) => r.ruleType === 'weighted');
    expect(weighted.reduce((sum, r) => sum + (r.weight ?? 0), 0)).toBe(100);
    expect(Math.max(...weighted.map((r) => r.weight ?? 0))).toBeLessThanOrEqual(50);
  });
});
