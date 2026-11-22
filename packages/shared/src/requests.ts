/**
 * Employee request schemas (M3): FR-1 requests, FR-3 recurring patterns, FR-4 changes.
 */
import { z } from 'zod';
import { ARRIVAL_WINDOWS, BAY_TYPES, REASON_CATEGORIES, REQUEST_STATUSES } from './constants';
import { CLOSED_REASONS } from './deciding-round';
import { isoDateSchema } from './time';

const isoDateTime = z.string();
const weekday = z.number().int().min(1).max(7);

export const decidedBySchema = z.object({
  round: z.enum(['weekly', 'daily', 'same_day']),
  runAt: isoDateTime,
  resultsBy: isoDateTime,
});
export type DecidedBy = z.infer<typeof decidedBySchema>;

export const requestSchema = z.object({
  id: z.string(),
  date: isoDateSchema,
  bayType: z.enum(BAY_TYPES),
  arrivalWindow: z.enum(ARRIVAL_WINDOWS),
  reasonCategory: z.enum(REASON_CATEGORIES).nullable(),
  allowFallback: z.boolean(),
  status: z.enum(REQUEST_STATUSES),
  recurringPatternId: z.string().nullable(),
  /** The round that will decide it. Null once decided or when the date has closed. */
  decidedBy: decidedBySchema.nullable(),
  /** Free to change or withdraw until its deciding round runs (FR-4). */
  editable: z.boolean(),
  /** Its round has run and awaits admin approval; `delayed` once past the deadline (ADR-008). */
  awaitingResults: z.object({ resultsBy: isoDateTime.nullable(), delayed: z.boolean() }).nullable(),
  /** An open same-day offer to accept before it expires (FR-20). */
  offer: z.object({ id: z.string(), bayCode: z.string(), expiresAt: isoDateTime }).nullable(),
  /** 1-based place in the waitlist for its date and bay type. */
  waitlistPosition: z.number().int().nullable(),
  /** Plain-language reason from the latest published decision (FR-15). */
  reason: z.string().nullable(),
  /** The confirmed bay, once allocated. */
  booking: z
    .object({
      id: z.string(),
      bayCode: z.string(),
      zoneName: z.string(),
      status: z.enum(['confirmed', 'checked_in', 'released', 'auto_released', 'cancelled']),
      /** Auto-released if not checked in by then (FR-22). */
      checkInBy: isoDateTime.nullable(),
      checkedInAt: isoDateTime.nullable(),
      lateExtensionUsed: z.boolean(),
    })
    .nullable(),
});
export type EmployeeRequest = z.infer<typeof requestSchema>;
export const requestsResponseSchema = z.object({ items: z.array(requestSchema) });
export const requestsQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

const requestFields = {
  bayType: z.enum(BAY_TYPES),
  arrivalWindow: z.enum(ARRIVAL_WINDOWS),
  reasonCategory: z.enum(REASON_CATEGORIES).nullable().default(null),
  allowFallback: z.boolean().default(true),
};

export const requestCreateSchema = z.object({
  dates: z
    .array(isoDateSchema)
    .min(1)
    .max(31)
    .refine((d) => new Set(d).size === d.length, 'Each date once.'),
  ...requestFields,
});
export type RequestCreate = z.infer<typeof requestCreateSchema>;
export const requestUpdateSchema = z.object(requestFields).partial();

// --- calendar ----------------------------------------------------------------
export const calendarDaySchema = z.object({
  date: isoDateSchema,
  open: z.boolean(),
  closedReason: z.enum(CLOSED_REASONS).nullable(),
  decidedBy: decidedBySchema.nullable(),
  request: z
    .object({ id: z.string(), status: z.enum(REQUEST_STATUSES), bayType: z.enum(BAY_TYPES) })
    .nullable(),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;
export const calendarResponseSchema = z.object({
  days: z.array(calendarDaySchema),
  /** Request types this employee can make at this site. */
  bayTypes: z.array(z.enum(BAY_TYPES)),
  eligibility: z.object({ ev: z.boolean(), accessibleThrough: isoDateSchema.nullable() }),
  /** Bay blocks in the range, with the reason shown to employees (FR-26). */
  notices: z.array(
    z.object({ dateFrom: isoDateSchema, dateTo: isoDateSchema, reason: z.string() }),
  ),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
export const calendarQuerySchema = z.object({
  from: isoDateSchema.optional(),
  days: z.coerce.number().int().min(1).max(42).default(28),
});

// --- recurring patterns (FR-3) ------------------------------------------------------
export const recurringPatternSchema = z.object({
  id: z.string(),
  weekdays: z.array(weekday),
  bayType: z.enum(BAY_TYPES),
  arrivalWindow: z.enum(ARRIVAL_WINDOWS),
  allowFallback: z.boolean(),
  active: z.boolean(),
  /** Upcoming dates this pattern covers (next weeks), with skips. */
  upcoming: z.array(
    z.object({
      date: isoDateSchema,
      skipped: z.boolean(),
      requestStatus: z.enum(REQUEST_STATUSES).nullable(),
    }),
  ),
});
export type RecurringPattern = z.infer<typeof recurringPatternSchema>;
export const recurringPatternsResponseSchema = z.object({ items: z.array(recurringPatternSchema) });
export const recurringPatternCreateSchema = z.object({
  weekdays: z
    .array(weekday)
    .min(1)
    .refine((d) => new Set(d).size === d.length, 'Each weekday once.'),
  bayType: z.enum(BAY_TYPES),
  arrivalWindow: z.enum(ARRIVAL_WINDOWS),
  allowFallback: z.boolean().default(true),
});
export const recurringPatternUpdateSchema = recurringPatternCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });
export const skipBodySchema = z.object({ date: isoDateSchema });
export const skipParamsSchema = z.object({ id: z.string().min(1), date: isoDateSchema });

export const offerAcceptResponseSchema = z.object({ bookingId: z.string() });
export const bookingCancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

// --- check-in (M6, FR-21/22) ---------------------------------------------------------
export const qrResponseSchema = z.object({
  /** Signed, valid only on the booking's date. */
  token: z.string(),
  date: isoDateSchema,
  expiresAt: isoDateTime,
});
export const runningLateResponseSchema = z.object({ checkInBy: isoDateTime });
export const checkinTokenSchema = z.object({ token: z.string().min(10).max(2000) });
export const manualCheckinSchema = z.object({ bookingId: z.string().min(1) });
export const checkinResultSchema = z.object({
  alreadyCheckedIn: z.boolean(),
  booking: z.object({
    id: z.string(),
    date: isoDateSchema,
    bayCode: z.string(),
    zoneName: z.string(),
    employeeName: z.string(),
    checkedInAt: isoDateTime,
  }),
});
export type CheckinResult = z.infer<typeof checkinResultSchema>;
export const gateBookingSchema = z.object({
  id: z.string(),
  employeeName: z.string(),
  bayCode: z.string(),
  bayType: z.enum(BAY_TYPES),
  zoneName: z.string(),
  status: z.enum(['confirmed', 'checked_in', 'released', 'auto_released', 'cancelled']),
  checkInBy: isoDateTime.nullable(),
  checkedInAt: isoDateTime.nullable(),
  method: z.enum(['qr_employee', 'qr_bay', 'manual_security']).nullable(),
});
export type GateBooking = z.infer<typeof gateBookingSchema>;
export const gateTodayResponseSchema = z.object({
  date: isoDateSchema,
  bookings: z.array(gateBookingSchema),
  bays: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      bayType: z.enum(BAY_TYPES),
      zoneName: z.string(),
      state: z.enum(['free', 'booked', 'checked_in', 'blocked']),
    }),
  ),
});
export type GateTodayResponse = z.infer<typeof gateTodayResponseSchema>;
export const bayQrResponseSchema = z.object({ token: z.string(), bayCode: z.string() });
