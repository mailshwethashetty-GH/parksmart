/**
 * Per-site settings stored in `sites.settings_json`. Defaults follow
 * docs/03-allocation-model.md; every value is configurable by the admin.
 */
import { z } from 'zod';
import { timeOfDaySchema } from './time';

const isoWeekdaySchema = z.number().int().min(1).max(7);

export const siteSettingsSchema = z.object({
  workingDays: z.array(isoWeekdaySchema).min(1).default([1, 2, 3, 4, 5]),
  bookingHorizonDays: z.number().int().min(1).max(60).default(28),
  rounds: z
    .object({
      weekly: z
        .object({
          weekday: isoWeekdaySchema.default(5),
          time: timeOfDaySchema.default('12:00'),
          approvalDeadline: timeOfDaySchema.default('14:00'),
        })
        .prefault({}),
      daily: z
        .object({
          time: timeOfDaySchema.default('18:00'),
          approvalDeadline: timeOfDaySchema.default('19:00'),
        })
        .prefault({}),
      sameDay: z
        .object({
          startTime: timeOfDaySchema.default('07:00'),
          intervalMinutes: z.number().int().min(10).max(120).default(30),
        })
        .prefault({}),
    })
    .prefault({}),
  sameDayPoolPercent: z.number().min(0).max(50).default(10),
  offerWindowMinutes: z.number().int().min(5).max(60).default(10),
  graceMinutes: z.number().int().min(5).max(30).default(15),
  lateExtensionsPerWeek: z.number().int().min(0).max(5).default(1),
  notificationDailyCap: z.number().int().min(1).max(10).default(3),
  quietHours: z
    .object({
      start: timeOfDaySchema.default('22:00'),
      end: timeOfDaySchema.default('07:00'),
    })
    .prefault({}),
  maxFactorWeightPercent: z.number().min(10).max(100).default(50),
  backupAdminIds: z.array(z.string()).default([]),
  evOverflowSameDay: z.boolean().default(false),
  autoPublishAtDayStart: z.boolean().default(true),
  requireVehiclePlate: z.boolean().default(false),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export function parseSiteSettings(raw: unknown): SiteSettings {
  return siteSettingsSchema.parse(raw ?? {});
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = parseSiteSettings({});
