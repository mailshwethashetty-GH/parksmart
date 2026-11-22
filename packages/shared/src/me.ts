/**
 * Employee self-service (M7): inbox (FR-25), profile and vehicles, consent and data
 * rights (DPDP Act: purpose, consent, export, deletion).
 */
import { z } from 'zod';
import { CONSENT_PURPOSES, DISTANCE_BANDS, VEHICLE_TYPES } from './constants';

const isoDateTime = z.string();

export const inboxResponseSchema = z.object({
  unread: z.number().int(),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      body: z.string(),
      createdAt: isoDateTime,
      read: z.boolean(),
    }),
  ),
});
export type InboxResponse = z.infer<typeof inboxResponseSchema>;
export const markReadSchema = z.object({
  ids: z.union([z.array(z.string()).max(200), z.literal('all')]),
});

export const vehicleSchema = z.object({
  id: z.string(),
  type: z.enum(VEHICLE_TYPES),
  isEv: z.boolean(),
  plate: z.string().nullable(),
});
export const vehicleCreateSchema = z.object({
  type: z.enum(VEHICLE_TYPES),
  isEv: z.boolean().default(false),
  plate: z
    .string()
    .trim()
    .max(15)
    .regex(/^[A-Za-z0-9 -]*$/, 'Letters, numbers, spaces and dashes only')
    .optional(),
});

/** Why each consent is asked for (shown to the employee). */
export const CONSENT_TEXT: Record<
  (typeof CONSENT_PURPOSES)[number],
  { required: boolean; text: string }
> = {
  parking_allocation: {
    required: true,
    text: 'Use my requests, bookings and check-ins to allocate parking fairly under the published rules.',
  },
  vehicle_details: {
    required: false,
    text: 'Store my vehicle details (EV or not, and a plate only if the gate needs it).',
  },
  ai_processing: {
    required: false,
    text: 'Let AI rewrite decision reasons in plain English. It only ever sees anonymous facts, never my name.',
  },
};

export const profileResponseSchema = z.object({
  distanceBand: z.enum(DISTANCE_BANDS).nullable(),
  vehicles: z.array(vehicleSchema),
  requirePlate: z.boolean(),
  consents: z.array(
    z.object({
      purpose: z.enum(CONSENT_PURPOSES),
      granted: z.boolean(),
      grantedAt: isoDateTime.nullable(),
      required: z.boolean(),
      text: z.string(),
    }),
  ),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export const profileUpdateSchema = z.object({ distanceBand: z.enum(DISTANCE_BANDS).nullable() });
export const consentUpdateSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
});

// --- reports (FR-28) ---------------------------------------------------------------
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export const reportQuerySchema = z.object({ month: monthSchema });
export const monthlyReportSchema = z.object({
  month: monthSchema,
  activeBays: z.number().int(),
  metrics: z.object({
    /** Bays used by a checked-in car on peak days (north star). Null without data. */
    peakUtilisation: z.number().nullable(),
    utilisation: z.number().nullable(),
    noShowRate: z.number().nullable(),
    overrideRate: z.number().nullable(),
    overrides: z.number().int(),
    decisions: z.number().int(),
    fairness: z.object({
      employees: z.number().int(),
      /** People below 60% of their peak-day requests met. */
      belowTarget: z.number().int(),
      minShare: z.number().nullable(),
      medianShare: z.number().nullable(),
    }),
    adoption: z.object({
      employees: z.number().int(),
      activeEmployees: z.number().int(),
      share: z.number().nullable(),
    }),
    requests: z.number().int(),
    confirmed: z.number().int(),
    autoReleased: z.number().int(),
  }),
  days: z.array(
    z.object({
      date: z.string(),
      peak: z.boolean(),
      requests: z.number().int(),
      confirmed: z.number().int(),
      checkedIn: z.number().int(),
      autoReleased: z.number().int(),
      utilisation: z.number().nullable(),
    }),
  ),
});
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
