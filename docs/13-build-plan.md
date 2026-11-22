# 13 — Build Plan

> Plan for building the **P0 pilot scope** in `04-functional-requirements.md`. P1 follows during the pilot; P2 is modelled in the schema only. Update the milestone status as work lands. Last reviewed: 2026-11-22.

Order follows the suggested build order in `04-functional-requirements.md`, with two changes: the engine (the highest-risk part) is built early and in parallel, and each milestone ships a vertical slice (DB → service → route → screen).

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Foundations, SSO + roles (FR-29) | Done (2026-11-22). SSO is wired but untested against a real IdP until D2; that check is in M8 |
| M1 | Allocation engine (FR-14) | Done (2026-11-22). Engine and property tests complete; wired into rounds in M4 |
| M2 | Site setup and policy (FR-26, FR-8, FR-9, FR-11 P0, FR-12, FR-13) | Done (2026-11-22). Employees see block reasons once booking lands (M3) |
| M3 | Requests (FR-1, FR-3, FR-4) | Done (2026-11-22). Booking cancel (rest of FR-4) comes with bookings in M5 |
| M4 | Rounds and collation (FR-5, FR-6, FR-7) | Planned |
| M5 | Review, reasons, waitlist (FR-15, FR-16, FR-20) | Planned |
| M6 | Check-in (FR-21, FR-22) | Planned |
| M7 | Notifications, reports, privacy, employee profile (FR-25, FR-28 P0, DPDP) | Planned |
| M8 | Pilot hardening and deployment | Planned |

## M0 — Foundations (FR-29)

- `git init`; pnpm workspaces; shared strict `tsconfig`; ESLint + Prettier; Vitest; Husky + lint-staged; GitHub Actions (lint → typecheck → test → build); `.env.example` matching `06-tech-stack.md`.
- `packages/shared`: enums, Zod schemas, time-zone helpers (site-local day ↔ UTC, working days).
- `packages/db`: Drizzle schema for all P0 tables. Raw-SQL migrations for the partial unique indexes (`bookings(bay_id, date)` on confirmed/checked-in; `requests(user_id, date)` on active) and the `audit_log` UPDATE/DELETE-blocking triggers. Startup PRAGMAs. Seed: one site, ~150 car bays (10 EV), users for all roles, default policy.
- `apps/api`: Fastify with Zod type provider, Swagger, helmet, rate-limit, CSRF, standard error format, `/health`, and one `auditLog.write()` helper.
- Auth: Better Auth SSO plugin plus dev-only login; **startup fails if dev login is enabled when `NODE_ENV=production`**; role + site guard on every route.
- `apps/web`: Vite + React 19 + Tailwind v4 + shadcn; route groups `/app`, `/admin`, `/gate`; typed API client; TanStack Query; auth shell.
- **Exit:** `pnpm dev` runs; dev login works for all three roles; CI green.

## M1 — Allocation engine (FR-14), tests first

- fast-check generators and the invariant properties in `03-allocation-model.md` §3 first, then the implementation.
- 7-step order per day; multi-day weekly ordering (most oversubscribed day first, ADR-009); bay-type fallback pass (ADR-010); `pure-rand` tie-break.
- Extra properties: caps respected, reservations never leak, factors in 0–1, same-day pool held back, fallback never displaces a first-choice request.
- Benchmark: 2,000 bays × 5,000 requests, well under the 5-minute budget.
- **Exit:** all properties pass; ESLint import ban keeps the package pure.

## M2 — Site setup and policy

- Admin CRUD for zones, bays, bay blocks; site settings (working days, round times, deadlines, backup admins, pool %, grace window).
- Seed the rule catalogue; rule builder (weights total 100%, 50% per-factor cap); P0 feasibility checks (coverage, privacy class, gaming risk; publish blocked below 90% without a neutral value).
- Policy versions with `effective_from_week`; publish locks the version; plain-language view at `/app/policy`.
- Accessible approvals (flag + expiry only). Every change audited.

## M3 — Requests

- Booking screen within 3 taps; shows the deciding round and when the answer arrives; "EV bay only" option.
- Recurring patterns, skips, `recurring-expand` job. Cutoff-aware edit and cancel.

## M4 — Rounds and collation

- Croner scheduler with `job_runs` idempotency keys.
- `RoundService`: load inputs → engine → save as `pending_review` (or publish for same-day) in one `BEGIN IMMEDIATE` transaction.
- Weekly, daily and same-day rounds; same-day pool; offers with 10-minute expiry (`offer-expiry`); `round-deadlines` job (reminders, delay notices, day-start auto-publish — ADR-008).
- Admin collation view (forecast arrives at P1).

## M5 — Review, reasons, waitlist

- `/admin/rounds/:id`: approve all, override with required reason; publish writes bookings, waitlist, notifications and audit entries with `publish_mode`.
- Reasons: deterministic template always available; Claude rewrite with pseudonymous input only, server-side stage check, every call in `ai_logs`.
- Waitlist with live position over SSE; auto-promotion; audit screen and export.

## M6 — Check-in

- Daily-rotating signed QR tokens (`jose`); `/gate` with scanner, manual check-in and today's bays.
- `auto-release` job (15-min default grace) → bay to the same-day pool; one "running late" extension per week.

## M7 — Notifications, reports, privacy, employee profile

- In-app + email through one service enforcing the 3/day cap and quiet hours (time-critical messages exempt).
- Reports: utilisation, no-shows, fairness spread, override rate; one-click monthly export.
- Consent at sign-up; data export and deletion; `audit-retention` job.
- Employee profile `/app/profile` (docs/10): register vehicles incl. EV (needed for EV requests), plate only if the site requires it, optional fields (distance band) with why-we-ask and an obvious skip, consent status, data export/delete. Endpoints `PATCH /me/profile`, `/me/vehicles`, `/me/data-export`, `DELETE /me`. Until then only seeded employees have vehicles.

## M8 — Pilot hardening

- Playwright end-to-end tests for the 7 flows in `10-ux-flows.md`, with axe checks; p95 < 500 ms check for booking and check-in.
- Docker + Caddy + Litestream; Sentry; uptime monitor.
- Real SSO against the site IdP (D2); real bay data; security-staff runbook and printed QR codes (D4).

## After launch (P1)

FR-2, FR-10, FR-11 simulation, FR-17, FR-18, FR-23, FR-24, push notifications (FR-25), FR-27, FR-28 AI summary, FR-30, FR-31, FR-32, CSV user import.

## Where each non-negotiable is enforced

| Rule (CLAUDE.md) | Enforcement |
| --- | --- |
| Never over-book | Engine invariant test + partial unique index + one-transaction publish |
| Submission time never scored | Engine input type has no `submittedAt`; property test |
| Engine pure | ESLint import ban in `packages/engine` (no DB, network, clock, `Math.random`) |
| AI never changes rules | AI service gets read-only inputs; server-side stage check |
| Everything audited | Single `auditLog.write()` helper; append-only triggers |
| SSO only | Startup guard on dev login |
| Least personal data | Zod schema on the AI payload allows only pseudonymous IDs and scores |
| Policy from next weekly round | `effective_from_week` resolved at publish time |
| Site time zone | Shared time-zone helpers; UTC in the DB |
