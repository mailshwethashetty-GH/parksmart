# 08 — Data Model

> Source of truth is the Drizzle schema in `packages/db/src/schema/`. This doc describes intent and constraints. Update it when tables, columns or constraints change.

## Conventions

- Primary keys: text IDs (`cuid2` or `uuid v7`).
- Every tenant table has `org_id` and (where relevant) `site_id`.
- Timestamps: `created_at`, `updated_at` and every other instant are **integer epoch milliseconds (UTC)** (Drizzle `timestamp_ms`).
- Calendar dates (a parking day): `date` as `YYYY-MM-DD` text in the **site's** time zone.
- Enums are stored as text and defined once in `packages/shared/constants`.
- Soft delete only where history matters (`deleted_at`). Audit and allocation tables are never deleted.

## Enums

| Enum | Values |
| --- | --- |
| `role` | `employee`, `admin`, `security` |
| `bay_type` | `car`, `two_wheeler`, `ev`, `accessible`, `carpool` |
| `request_status` | `requested`, `withdrawn`, `allocated`, `waitlisted`, `expired` |
| `booking_status` | `confirmed`, `checked_in`, `released`, `auto_released`, `cancelled` |
| `round_type` | `weekly`, `daily`, `same_day` |
| `round_status` | `collecting`, `pending_review`, `published`, `failed` |
| `reason_category` | `client_visit`, `event`, `medical_appointment`, `other` |
| `rule_type` | `eligibility`, `reservation`, `weighted`, `cap`, `tie_breaker` |
| `checkin_method` | `qr_employee`, `qr_bay`, `manual_security` |
| `ai_stage` | `1`, `2`, `3` |
| `publish_mode` | `admin`, `auto_same_day`, `auto_timeout`, `auto_stage3` |

## Tables

### Organisation and site

| Table | Key columns | Notes |
| --- | --- | --- |
| `orgs` | id, name, email_domain | `email_domain` unique: new SSO users with that domain join this org; unknown domains are refused |
| `sites` | id, org_id, name, timezone, ai_stage, settings_json | settings: working days, round times (incl. same-day start/end/interval), approval deadlines, backup admin IDs, grace window, pool %, notification cap, `evOverflowSameDay` (default false), `autoPublishAtDayStart` (default true), `lateExtensionsPerWeek` (1), `lateExtensionMinutes` (30) |
| `zones` | id, site_id, name, kind, capacity? | kind e.g. basement, two-wheeler. `capacity` for capacity-managed zones (FR-32) |
| `bays` | id, site_id, zone_id, code, bay_type, has_charger, active | `UNIQUE(site_id, code)` |
| `bay_blocks` | id, site_id, bay_id?, zone_id?, date_from, date_to, reason, created_by, deleted_at? | event and reserved blocks |

### People

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | id, org_id, site_id, email, name, email_verified, image?, role, active | Better Auth user model plus our columns. `site_id` = home site; the API scopes every request to it |
| `user_profiles` | user_id, distance_band?, role_tags_json, join_date?, client_facing? | optional fields score neutral when null |
| `vehicles` | id, user_id, type, is_ev, plate? | plate optional unless site requires it |
| `approvals` | id, user_id, kind (`accessible`), approved_by, expires_at, revoked_at? | **flag only, no medical detail** |
| `consents` | id, user_id, purpose, granted_at, revoked_at? | DPDP. Purposes: `parking_allocation` (required before any request), `vehicle_details` (revoking deletes vehicles), `ai_processing`. Account deletion revokes all, deletes vehicles/profile/notifications/push subscriptions/sessions, cancels future bookings, and anonymises the `users` row (name `Deleted user`, placeholder email, inactive) so allocation and audit history stay intact |
| `sessions`, `accounts`, `verifications`, `sso_providers` | (Better Auth + SSO plugin) | managed by the auth library. `accounts.password` exists for the library's model but is always null (SSO only). A test checks these tables against Better Auth's schema |

### Policy

| Table | Key columns | Notes |
| --- | --- | --- |
| `policies` | id, site_id, name | |
| `policy_versions` | id, policy_id, version, effective_from_week, published_at, published_by, plain_language | immutable once published. `effective_from_week` = site-local Monday (`YYYY-MM-DD`) of the target week of the next weekly round to run |
| `rules` | id, policy_version_id, rule_type, key, config_json, weight?, order, enabled | weights per version total 100% |

### Requests and allocation

| Table | Key columns | Notes |
| --- | --- | --- |
| `requests` | id, site_id, user_id, date, bay_type, arrival_window, reason_category?, allow_fallback (default true), status, submitted_at, recurring_pattern_id? | `UNIQUE(user_id, date)` for active requests. `submitted_at` is **never** scored |
| `recurring_patterns` | id, user_id, weekdays_json, bay_type, arrival_window, active | |
| `recurring_skips` | id, pattern_id, date | |
| `rounds` | id, site_id, round_type, target_date_from, target_date_to, status, seed, policy_version_id, run_at, approval_deadline?, publish_mode?, approved_by?, approved_at?, published_at? | `approval_deadline` null for same-day rounds |
| `allocations` | id, round_id, request_id, bay_id?, outcome (`confirmed`/`waitlisted`/`ineligible`), rank, score, score_breakdown_json, fallback_used, cap_reached, reason_text | one per request per round |
| `bookings` | id, site_id, user_id, bay_id, date, status, allocation_id, late_extension_used | **`UNIQUE(bay_id, date)` WHERE status IN (`confirmed`,`checked_in`)**; also `UNIQUE(user_id, date)` on the same statuses (one bay per employee per day). Status meanings: `cancelled` = employee cancelled before check-in; `auto_released` = no check-in within grace; `released` = checked in, then left or the day ended |
| `waitlist` | id, site_id, date, bay_type, request_id, position, cap_reached | `request_id` unique; capped entries sit behind uncapped ones (ADR-009) |
| `offers` | id, request_id, bay_id, expires_at, status (`open`,`accepted`,`declined`,`expired`) | References the request, not a waitlist row (migrations 0002–0003): the queue changes, offers are history. An offered request has no waitlist row |
| `overrides` | id, allocation_id, admin_id, before_json, after_json, reason | reason required |
| `appeals` | id, site_id, allocation_id?, booking_id?, user_id, text, status (`open`,`upheld`,`rejected`), resolved_by?, resolved_at? | P1 |

### Check-in

| Table | Key columns | Notes |
| --- | --- | --- |
| `checkins` | id, booking_id, method, at, by_user_id? | One per booking. `method`: `qr_employee` (gate scan), `qr_bay` (bay sticker), `manual_security`; `by_user_id` = the security user or the employee |
| `ev_sessions` | id, booking_id, started_at, ends_at, overstay_minutes | P1 |

### System

| Table | Key columns | Notes |
| --- | --- | --- |
| `notifications` | id, user_id, kind, channel, time_critical, payload_json, created_at, sent_at, read_at, skipped_reason? | One `in_app` row (sent at once) plus one `email` row per notice. Cap 3 emails/day enforced in the service; `time_critical` rows are exempt from the cap and quiet hours. `skipped_reason` = `daily_cap` · `no_email` · `stale` (email not sent, inbox copy kept) |
| `push_subscriptions` | id, user_id, endpoint, keys_json | P1 |
| `ai_logs` | id, site_id, purpose, model, input_json, output_json, latency_ms, error?, created_at | pseudonymous input only |
| `audit_log` | id, site_id?, actor_id?, action, entity, entity_id, before_json, after_json, reason, at | **append-only**: triggers (migration `0001`) block every UPDATE, and any DELETE of a row newer than 12 months, so only the retention job can remove rows. `actor_id` null = system (scheduler) |
| `job_runs` | id, job_key (unique), started_at, finished_at, status, error | idempotency for scheduled jobs |

## Key indexes

- `requests(site_id, date, status)`
- `bookings(site_id, date, status)`
- `allocations(round_id)`
- `audit_log(site_id, at)`
- `checkins(booking_id)`
