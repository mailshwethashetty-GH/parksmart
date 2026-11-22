# 04 — Functional Requirements

**Priority:** P0 = required for pilot launch · P1 = ships during the pilot · P2 = designed for but stubbed.
**Status:** `Planned` · `In progress` · `Done` · `Deferred` · `Dropped`. Claude Code updates the Status column when a feature is built or changes.
Defaults marked "configurable" are set by the admin per site.

When adding a feature, use the next free ID (`FR-34`, `FR-35`, …). Never renumber existing IDs.

## Requests

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-1 | Request a bay for a day by type (car, two-wheeler, EV, accessible, carpool), with arrival window and optional reason | 3 taps or fewer; median under 30 s; employee sees which round will decide it; EV requests can opt out of car-bay fallback ("EV bay only") | P0 | Done |
| FR-2 | Natural-language requests and questions via Claude ("EV bay Tue–Thu next week", "why was I waitlisted?") | Parsed request shown for confirmation; nothing is submitted without a tap | P1 | Planned |
| FR-3 | Recurring weekly pattern with single-day skips | Pattern feeds every weekly round; a skip withdraws that day's request at once | P0 | Done |
| FR-4 | Change or cancel a request or booking | Free edits until the round's cutoff; a cancelled confirmed bay returns to the next round within 1 min | P0 | Done |

## Collation

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-5 | Weekly, daily and same-day allocation rounds | Admin sets round times, cutoffs and working days; daily round runs on the previous working day (Friday for Monday); submission time never affects the score | P0 | Done |
| FR-6 | Same-day pool held out of weekly and daily rounds | Configurable share (default 10%); released no-shows join it | P0 | Done |
| FR-7 | Collation view for the admin | Requests vs supply by day and bay type, oversubscription ratio, forecast of requests still to come | P0 | Done |

## Rules

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-8 | Rule builder with five types: eligibility, reservation, weighted factor, cap, tie-breaker | Add, edit, disable, reorder; weights total 100%; per-factor cap (default 50%) enforced | P0 | Done |
| FR-9 | Starting rule catalogue with default weights | Preloaded as in `03-allocation-model.md`; admin can change any default before go-live | P0 | Done |
| FR-10 | Custom factors from profile fields or admin tags | Admin maps each value to 0–1; custom factors pass the same feasibility checks | P1 | Planned |
| FR-11 | Feasibility checks before a rule is published | **P0:** coverage, privacy class, gaming-risk flag; publish blocked below 90% coverage without a neutral default. **P1:** 4-week impact simulation once 2+ weeks of data exist | P0 / P1 | In progress |
| FR-12 | Policy versions and publication | Each version has an effective week (first Monday it applies) and starts at the next weekly round; plain-language policy for employees; past versions kept | P0 | Done |
| FR-13 | Accessible and medical approvals | Admin approves with an expiry date; only the flag is stored, never the medical detail | P0 | Done |

## Allocation

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-14 | Deterministic scoring and assignment engine | Same requests and policy always give the same result; never confirms more bookings than bays; ties settled by a logged random draw; weekly rounds allocate the most oversubscribed day first; bay-type fallback as in `03-allocation-model.md` | P0 | In progress |
| FR-15 | Plain-language reason for every decision | Employee sees a reason under 40 words; admin sees the full score breakdown by rule | P0 | Done |
| FR-16 | Stage 1 review, override and audit log | Admin (or a backup admin) approves each weekly and daily round before publish; same-day rounds auto-publish and are audited; reminders before the approval deadline and a "results delayed" notice after it; overrides need a reason; every change logged and exportable | P0 | Done |
| FR-20 | Waitlist with live position and auto-promotion | Promoted employee has a configurable window (default 10 min) to accept | P0 | Done |

## AI

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-17 | Anomaly flags | Flags repeated no-shows, unusual reason claims, low data coverage for admin review | P1 | Planned |
| FR-18 | Stage 2: AI recommends allocations and weights | Best-fit bays by zone/type, waitlist promotions, weight changes with simulated impact; admin reviews exceptions and approves | P1 | Planned |
| FR-19 | Stage 3: AI-run allocation | Offered only when the stage gate is met; rounds publish automatically; one-click pause returns the site to Stage 2 | P2 | Planned |

## Check-in

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-21 | QR check-in at gate or bay; manual check-in by security | Time and method recorded; under 5 s on a 4G phone | P0 | Done (e2e: about 0.9 s on throttled 4G with the PWA installed) |
| FR-22 | Auto-release after a grace window | Default 15 min, configurable to 30; one "running late" extension per employee per week | P0 | Done |
| FR-23 | No-show handling | Missed check-ins feed the no-show factor; any extra penalty is off by default (*hypothesis*) | P1 | Planned |

## EV

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-24 | Time-boxed charging sessions with a move-your-car nudge | Admin sets session length; overstays logged | P1 | Planned |

## Notifications

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-25 | Round results, waitlist moves, release warnings | In-app and email at P0, push at P1; max 3 per employee per day, with waitlist offers, release warnings and check-in reminders exempt from the cap and quiet hours | P0 | Done (P0: in-app inbox + email; the release warning 10 min before the check-in deadline is the check-in reminder). Push is P1 |

## Admin

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-26 | Site, zone and bay setup; block bays for events or documented reserved bays | Bulk block by date with a reason shown to employees; multi-site at P2 | P0 | Done |
| FR-27 | Demand forecast by bay type for tomorrow and next week | Shown with a range; feeds the collation view and same-day pool sizing | P1 | Planned |
| FR-28 | Reports | Utilisation, no-shows, fairness spread, disputes, override rate; one-click monthly export (P0); AI-written weekly summary (P1) | P0 / P1 | In progress (P0 done: `/admin/analytics` + monthly CSV. Disputes wait for appeals, FR-31; AI summary is P1) |

## Platform

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-29 | SSO and roles: Employee, Admin, Security | OIDC/SAML with Google Workspace or Microsoft Entra | P0 | In progress (Google/Entra OIDC configured from env, first admins and role changes in Site setup → People; sign-in against the real IdP waits for D2) |
| FR-30 | One booking covers parking and building entry | P1: combined booking flow; P2: access-control API integration | P1 | Planned |

## Employee

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-31 | Appeal a decision | Appeal goes to the admin queue with the score breakdown attached | P1 | Planned |

## Bays

| ID | Requirement | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FR-32 | Two-wheeler zones managed by capacity | Zone shows remaining capacity; requests optional per site | P1 | Planned |
| FR-33 | Visitor parking and verified carpool factor | Host books for visitors; carpool counts only when all riders confirm | P2 | Planned |

---

## Suggested build order (P0)

1. Monorepo, DB schema, seed, SSO + roles (FR-29)
2. Site / zone / bay setup (FR-26)
3. Engine + property tests (FR-14), rule catalogue and builder (FR-8, FR-9, FR-11 P0, FR-12, FR-13)
4. Requests and recurring patterns (FR-1, FR-3, FR-4)
5. Rounds, same-day pool, collation view (FR-5, FR-6, FR-7)
6. Stage 1 review, reasons, audit (FR-15, FR-16), waitlist (FR-20)
7. QR check-in and auto-release (FR-21, FR-22)
8. Notifications (FR-25), monthly export (FR-28 P0)
