# 09 — API Conventions

> The live API reference is the generated OpenAPI spec at `/docs` (Swagger UI). This file holds the conventions and the endpoint map. Update the map when endpoints are added, renamed or removed.

## Conventions

- Base path: `/api/v1`. JSON only. `camelCase` fields.
- Every request and response body is defined by a Zod schema in `packages/shared` and registered with `fastify-type-provider-zod`.
- Auth: httpOnly session cookie from SSO. Every route declares the roles it allows (`employee`, `admin`, `security`).
- Site scoping: the user's site comes from the session. Admin routes check that the resource belongs to that site.
- Mutating requests need the CSRF token in the `x-csrf-token` header (get it from `GET /csrf-token`). Better Auth routes under `/auth/*` use the library's own origin check instead.
- Dates: `YYYY-MM-DD` (site-local day). Timestamps: ISO 8601 UTC.
- Pagination: `?cursor=…&limit=…` → `{ items, nextCursor }`.
- Idempotency: `POST` that creates bookings or check-ins accepts an `Idempotency-Key` header.

### Error format

```json
{ "error": { "code": "POLICY_WEIGHTS_INVALID", "message": "Weights must total 100%.", "details": {} } }
```

| HTTP | When |
| --- | --- |
| 400 | Validation failed (Zod) |
| 401 | Not signed in |
| 403 | Wrong role or wrong site |
| 404 | Not found |
| 409 | Conflict (e.g. bay already booked, round already published, cutoff passed) |
| 422 | Business rule broken (e.g. rule coverage below 90%) |
| 429 | Rate limited |

## Endpoint map (initial)

### Auth and profile

| Method | Path | Role | FR |
| --- | --- | --- | --- |
| GET/POST | `/auth/*` | public | FR-29 (Better Auth routes, incl. `POST /auth/sign-in/sso` and `/auth/sign-out`) |
| GET · POST | `/auth/dev/users` · `/auth/dev/sign-in` | public, **dev only** | Seeded-user login. Not registered in production (non-negotiable #6) |
| GET | `/csrf-token` | public | Returns `{ token }` and sets the signed CSRF secret cookie |
| GET | `/me` | any | |
| PATCH | `/me/profile` | employee | |
| GET/POST/DELETE | `/me/vehicles` | employee | |
| GET | `/me/data-export` · DELETE `/me` | employee | DPDP |

### Requests and bookings

| Method | Path | Role | FR |
| --- | --- | --- | --- |
| GET | `/requests?from&to` (own active requests, each with `decidedBy`, `editable`, `awaitingResults`, `offer`, `waitlistPosition`, `reason`, `booking`) | employee, admin | FR-1 |
| GET | `/requests/calendar?from&days` (open days, deciding round, my requests, my bay types, block notices) | employee, admin | FR-1, FR-26 |
| POST | `/requests` `{ dates[], bayType, arrivalWindow, reasonCategory?, allowFallback }` (all-or-nothing; replaces an undecided request for the same day) | employee, admin | FR-1 |
| PATCH · DELETE | `/requests/:id` (change · withdraw) until its round runs | employee, admin | FR-4 |
| POST | `/requests/parse` | employee | FR-2 (Claude, returns a draft, does not submit) |
| GET/POST · PATCH | `/recurring-patterns` · `/recurring-patterns/:id` (incl. `active: false` to stop) | employee, admin | FR-3 |
| POST · DELETE | `/recurring-patterns/:id/skips` `{ date }` · `/recurring-patterns/:id/skips/:date` | employee, admin | FR-3 |
| GET | `/bookings?from&to` | employee | |
| POST | `/bookings/:id/cancel` `{ reason? }` (own, confirmed only; audited; freed today → same-day round at once) | employee, admin | FR-4 |
| POST | `/bookings/:id/running-late` | employee | FR-22 |
| GET | `/bookings/:id/qr` | employee | FR-21 |
| SSE | `/stream/me` (`event: requests` when your requests change; heartbeat every 25 s). Waitlist position is on `GET /requests` | employee, admin | FR-20 |
| POST | `/offers/:id/accept` · `/offers/:id/decline` (decline re-offers the bay at once) | employee, admin | FR-20 |
| POST | `/appeals` | employee | FR-31 |
| GET | `/policy/current` | any role | FR-12 |

### Check-in (security)

| Method | Path | Role | FR |
| --- | --- | --- | --- |
| POST | `/checkins/scan` | security | FR-21 |
| POST | `/checkins/manual` | security | FR-21 |
| GET | `/gate/today` | security | Gate view |

### Admin

| Method | Path | Role | FR |
| --- | --- | --- | --- |
| GET · PUT | `/admin/site` · `/admin/site/settings` (whole settings object) | admin | FR-26 |
| GET/POST · PATCH | `/admin/zones` · `/admin/zones/:id` | admin | FR-26 |
| GET/POST · POST · PATCH | `/admin/bays?zoneId` · `/admin/bays/bulk` · `/admin/bays/:id` (deactivate, never delete) | admin | FR-26 |
| GET/POST · DELETE | `/admin/bay-blocks?from&to` · `/admin/bay-blocks/:id` (soft delete) | admin | FR-26 |
| GET | `/admin/users?q&role` | admin | pickers (approvals, backup admins) |
| GET | `/admin/collation?from&days` (working days; per bay type: supply, same-day hold-back, requests, confirmed, waitlisted, oversubscription, forecast) | admin | FR-7 |
| GET | `/admin/policy` (the site's one policy + version statuses) | admin | FR-12 |
| GET · POST | `/admin/policy/versions/:v` · `/admin/policy/versions` (new draft, copies latest) | admin | FR-8, FR-12 |
| PUT · DELETE | `/admin/policy/versions/:v/rules` (replace a draft's rules) · `/admin/policy/versions/:v` (discard draft) | admin | FR-8 |
| POST | `/admin/policy/versions/:v/publish` `{ reason }` | admin | FR-12 |
| POST | `/admin/rules/feasibility` `{ rules }` (unsaved rules) | admin | FR-11 |
| POST | `/admin/policy/versions/:v/simulate` | admin | FR-11 (P1) |
| GET/POST · POST | `/admin/approvals` · `/admin/approvals/:id/revoke` | admin | FR-13 |
| GET | `/admin/rounds?status&limit` · `/admin/rounds/:id` (decisions with names, factor breakdown, reasons; free bays while pending) | admin | FR-16 |
| POST | `/admin/rounds/:id/approve` `{ note? }` | admin | FR-16 |
| POST | `/admin/allocations/:id/override` `{ action: 'assign', bayId, reason }` or `{ action: 'waitlist', reason }` (pending rounds only) | admin | FR-16 |
| GET | `/admin/appeals` · POST `/admin/appeals/:id/resolve` | admin | FR-31 |
| GET | `/admin/forecast` | admin | FR-27 |
| GET | `/admin/reports/:kind` · `/admin/reports/export` | admin | FR-28 |
| GET | `/admin/audit?from&to&action&cursor&limit` (action = prefix, e.g. `policy`) · `/admin/audit/export` (CSV, formula-safe) | admin | FR-16 |
| PATCH | `/admin/sites/:id/ai-stage` | admin | FR-18, FR-19 |
| POST | `/admin/users/import` | admin | CSV import (P1, see I7) |

### System

| Method | Path | Role |
| --- | --- | --- |
| GET | `/health` | public |
| GET | `/docs` | admin (or dev only) |
