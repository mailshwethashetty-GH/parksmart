/**
 * Enums shared by the DB, API, engine and web app.
 * Stored as text in the DB. See docs/08-data-model.md.
 */

export const ROLES = ['employee', 'admin', 'security'] as const;
export type Role = (typeof ROLES)[number];

export const BAY_TYPES = ['car', 'two_wheeler', 'ev', 'accessible', 'carpool'] as const;
export type BayType = (typeof BAY_TYPES)[number];

export const REQUEST_STATUSES = [
  'requested',
  'withdrawn',
  'allocated',
  'waitlisted',
  'expired',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
/** Statuses that count as "active" for the one-request-per-user-per-day rule. */
export const ACTIVE_REQUEST_STATUSES = ['requested', 'allocated', 'waitlisted'] as const;

/**
 * cancelled     = employee cancelled before check-in
 * auto_released = no check-in within the grace window
 * released      = checked in, then left or the day ended
 */
export const BOOKING_STATUSES = [
  'confirmed',
  'checked_in',
  'released',
  'auto_released',
  'cancelled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Statuses that hold a physical bay. Covered by the partial UNIQUE(bay_id, date) index. */
export const BAY_HOLDING_BOOKING_STATUSES = ['confirmed', 'checked_in'] as const;

export const ROUND_TYPES = ['weekly', 'daily', 'same_day'] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

export const ROUND_STATUSES = ['collecting', 'pending_review', 'published', 'failed'] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const PUBLISH_MODES = ['admin', 'auto_same_day', 'auto_timeout', 'auto_stage3'] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const REASON_CATEGORIES = ['client_visit', 'event', 'medical_appointment', 'other'] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const RULE_TYPES = ['eligibility', 'reservation', 'weighted', 'cap', 'tie_breaker'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const CHECKIN_METHODS = ['qr_employee', 'qr_bay', 'manual_security'] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export const AI_STAGES = [1, 2, 3] as const;
export type AiStage = (typeof AI_STAGES)[number];

export const ALLOCATION_OUTCOMES = ['confirmed', 'waitlisted'] as const;
export type AllocationOutcome = (typeof ALLOCATION_OUTCOMES)[number];

export const OFFER_STATUSES = ['open', 'accepted', 'declined', 'expired'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const APPEAL_STATUSES = ['open', 'upheld', 'rejected'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const JOB_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export const DISTANCE_BANDS = ['lt_10', '10_25', 'gt_25'] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export const VEHICLE_TYPES = ['car', 'two_wheeler'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const APPROVAL_KINDS = ['accessible'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const ZONE_KINDS = ['basement', 'surface', 'two_wheeler', 'other'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CONSENT_PURPOSES = ['parking_allocation', 'vehicle_details', 'ai_processing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Arrival windows offered on a request (site-local). */
export const ARRIVAL_WINDOWS = ['before_9', '9_to_11', '11_to_13', 'after_13'] as const;
export type ArrivalWindow = (typeof ARRIVAL_WINDOWS)[number];

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
