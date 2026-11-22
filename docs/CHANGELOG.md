# Docs Changelog

One line per meaningful doc change, newest at the top.
Format: `YYYY-MM-DD — file(s) — what changed — why`

- 2026-11-22 — 09 — Admin endpoint map rewritten for M2 (one policy per site: `/admin/policy/...`; site settings PUT; bulk bays; approvals revoke; users lookup) — matches built routes
- 2026-11-22 — 03 — Feasibility blocking rules, version rules (one draft, same-week precedence), loose-read/strict-write for stored rules — decided while building M2
- 2026-11-22 — 04, 10, 06, 13 — FR-8/9/12/13 Done, FR-11 and FR-26 In progress; Site setup and Policy screens described; React Hook Form resolver; M2 Done — M2 complete
- 2026-11-22 — 03, 08, 06 — Engine contract made concrete: `ineligible` outcome and reason codes, per-request seeded tie-break, same-day pool selection (car/EV, highest codes), accessible bays never pooled, capped requests only get same-day leftovers, input-order invariance — fixed while building M1
- 2026-11-22 — 04, 13 — FR-14 In progress; M1 Done — engine built and tested
- 2026-11-22 — 08 — M0 schema: epoch-ms timestamps; `users.site_id`, `orgs.email_domain`; Better Auth tables; one-bay-per-user-per-day index; audit DELETE allowed only after 12 months; smaller column additions — matches the Drizzle schema built in M0
- 2026-11-22 — 09 — Added `/csrf-token` and dev-only `/auth/dev/*` endpoints; CSRF header name — built in M0
- 2026-11-22 — 06, 07 — Pinned TS 5.9, pnpm 12, Vite 8; auth, security and build details; lint-enforced layering — M0 implementation choices
- 2026-11-22 — 12 — ADR-011 Better Auth owns `users`; SSO onboarding by email domain — needed a home org/site for first-time SSO users
- 2026-11-22 — 04, 13, CLAUDE.md — FR-29 In progress; M0 Done; commands updated — M0 complete
- 2026-11-22 — 03, 04, 06, 07, 08, 10, 11, 12 — Same-day rounds auto-publish; approval deadlines, reminders, backup admins and day-start auto-publish for weekly/daily rounds (ADR-008) — Stage 1 "approve every round" was unworkable for 30-min same-day rounds
- 2026-11-22 — 03, 04, 12 — Weekly rounds allocate the most oversubscribed day first; capped requests wait behind uncapped ones (ADR-009) — day order decided who won under weekly caps
- 2026-11-22 — 03, 04, 08, 10, 11, 12 — Bay-type fallback rules and `requests.allow_fallback` (ADR-010) — fallback was undefined
- 2026-11-22 — 08, 07, 10 — Booking status meanings fixed (cancel → `cancelled`); removed `AutoReleased → Waitlisted` from the state diagram — statuses were inconsistent across docs
- 2026-11-22 — 03, 04, 08 — `policy_versions.effective_from_round` → `effective_from_week` — the target round does not exist when a policy is published
- 2026-11-22 — 03, 04, 06 — Working days per site; daily round runs on the previous working day (Friday for Monday) — weekend handling was undefined
- 2026-11-22 — 04, 05, 10 — Offers, release warnings and check-in reminders exempt from the 3/day cap and quiet hours — a capped offer would waste a bay
- 2026-11-22 — 09 — `/admin/users/import` marked P1 — matches I7
- 2026-11-22 — 13, README, CLAUDE.md — Added build plan — kickoff
- 2026-11-22 — all — Initial docs created from PRD v2, Strategy doc and Persona docs — project kickoff
