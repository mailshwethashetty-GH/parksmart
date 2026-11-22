# 12 — Decision Log (ADRs)

Record significant decisions with trade-offs here: anything someone might later ask "why did we do it this way?" about. Newest at the top. Never delete an entry; mark it `Superseded by ADR-n` instead.

### Template

```
## ADR-NNN — Title
- Date: YYYY-MM-DD
- Status: Accepted | Superseded by ADR-n | Proposed
- Context: what problem or constraint forced a choice
- Decision: what we chose
- Alternatives: what we rejected and why
- Consequences: trade-offs we accept
```

---

## ADR-012 — One tie-break seed per week, shared by all rounds
- Date: 2026-11-22
- Status: Accepted
- Context: Each round drew a fresh random seed. Equal scores could then break differently in the weekly, daily and same-day rounds for the same date, so the person shown first on the waitlist could lose a same-day offer to second place by a new coin flip — undermining the "live position" promised to employees.
- Decision: Rounds reuse the seed of that week's weekly round (or a fresh one if no weekly round ran). The tie-break draw depends only on (seed, date, request), so ties resolve identically in every round for a date. Real score changes (e.g. wins earlier in the week) can still reorder people.
- Alternatives: Fresh seed per round (rejected: unstable positions); carry waitlist order forward and skip re-scoring (rejected: ignores rules that legitimately change during the week).
- Consequences: Seeds are still stored per round and replayable. A week's seed is set by its weekly round.

## ADR-011 — Better Auth owns `users`; SSO users join an org by email domain
- Date: 2026-11-22
- Status: Accepted
- Context: Better Auth needs its own user/session/account tables, and the data model needs org, site and role on every user. A first-time SSO user must land in the right org and site without an admin step.
- Decision: `users` is Better Auth's user model (renamed) with our `org_id`, `site_id`, `role` and `active` columns. A `user.create` hook looks up `orgs.email_domain`; matching users join that org's site as `employee`, and unknown domains are refused. Roles are raised by an admin. Instants are stored as integer epoch ms everywhere.
- Alternatives: separate `users` and auth tables joined 1:1 (rejected: two sources of truth for email and name); admin pre-provisions every user (rejected: slows pilot onboarding; CSV import stays P1).
- Consequences: A test pins our auth tables to Better Auth's schema, so library upgrades that add fields fail loudly. Multi-site orgs (P2) will need a site picker or mapping instead of "first site".

## ADR-010 — Bay-type fallback
- Date: 2026-11-22
- Status: Accepted
- Context: EV and accessible requests can find no bay of their type while car bays remain. The docs did not say whether a request may take another type.
- Decision: EV, accessible and carpool requests fall back to a car bay after all first-choice assignments for the day (EV requests can opt out). Car requests never get EV or accessible bays, except EV bays in same-day rounds when a site turns on `evOverflowSameDay` (default off).
- Alternatives: No fallback (rejected: EV owners lose a bay that a car would get); full overflow both ways (rejected: breaks the EV eligibility rule and charger turnover).
- Consequences: The engine needs a second assignment pass per day. Decision records and reasons must note fallback.

## ADR-009 — Weekly rounds allocate the most oversubscribed day first
- Date: 2026-11-22
- Status: Accepted
- Context: Caps (e.g. 3 peak days a week) span the weekly round, so the order in which days are allocated decides who wins.
- Decision: Allocate days one at a time in order of oversubscription (ties by date). Wins update caps and rolling fairness before the next day. Capped requests wait behind all uncapped ones.
- Alternatives: Calendar order Mon→Fri (rejected: caps bind early in the week, not on peak days); global optimisation across the week (deferred: harder to explain and test; may revisit with the P1 LP solver).
- Consequences: Day order depends only on inputs, so results stay deterministic. Reasons must explain `cap_reached`.

## ADR-008 — Same-day rounds auto-publish; approval deadlines for weekly and daily rounds
- Date: 2026-11-22
- Status: Accepted (pending pilot admin confirmation, A9)
- Context: Stage 1 said the admin approves every round, but same-day rounds run every 30 minutes with 10-minute offers, and weekly and daily results have fixed promise times.
- Decision: Same-day rounds publish automatically at every stage and are audited afterwards. Weekly and daily rounds need approval by a deadline (Fri 14:00 / 19:00), with reminders and backup admins. After the deadline employees see "results delayed". Any round still unapproved at 07:00 on its target day auto-publishes (site setting, default on), logged as `auto_timeout`.
- Alternatives: Approve every same-day round (rejected: unworkable and leaves bays empty); auto-publish at the deadline (rejected: removes admin control too early).
- Consequences: Rounds need `publish_mode` and `approval_deadline`. A new `round-deadlines` job. The admin must accept the safety valve (A9).

## ADR-007 — AI explains first, runs allocation only after staged opt-in
- Date: 2026-11-22
- Status: Accepted
- Context: The strategy bets on AI allocation, but the real admin interviewed does not trust it.
- Decision: The deterministic rules engine allocates. AI starts at Stage 1 (explain and flag); Stages 2 and 3 need admin opt-in and pilot trust gates.
- Alternatives: AI allocates from day one (rejected: kills admin trust); no AI (rejected: loses explanations and the strategic edge).
- Consequences: The engine must be fully deterministic and replayable. AI is suggest-only for rules and weights.

## ADR-006 — Collate-then-allocate rounds instead of FCFS
- Date: 2026-11-22
- Status: Accepted
- Context: FCFS rewards speed, not need. Advance bookers take every slot.
- Decision: Weekly, daily and same-day rounds. Submission time is never scored. Ties use a seeded logged draw.
- Alternatives: FCFS (rejected); lottery only (rejected: ignores need and fairness history).
- Consequences: Employees wait for a round; the UI must show which round decides and when.

## ADR-005 — Self-hosted single container, India region
- Date: 2026-11-22
- Status: Accepted
- Context: SQLite needs a persistent disk and a single writer. DPDP favours India hosting.
- Decision: One Docker container on a VM (AWS Mumbai or Azure Central India) behind Caddy, with Litestream backups.
- Alternatives: Vercel/serverless (rejected: temporary file system); Kubernetes (rejected: overkill for a pilot).
- Consequences: Vertical scaling only until we move to Postgres.

## ADR-004 — Scheduler in-process with Croner and a `job_runs` table
- Date: 2026-11-22
- Status: Accepted
- Context: Rounds, auto-release and offer expiry need reliable timed jobs.
- Decision: Croner (time-zone aware) in the API process; idempotency via unique `job_runs.job_key`.
- Alternatives: BullMQ + Redis (rejected: extra infrastructure); OS cron (rejected: harder to test and deploy).
- Consequences: One app instance only.

## ADR-003 — Pure allocation engine package
- Date: 2026-11-22
- Status: Accepted
- Context: Allocation must be deterministic, replayable and provably never over-book.
- Decision: `packages/engine` is a pure function with no I/O, a seeded PRNG and fast-check property tests.
- Alternatives: Allocation logic inside API services or SQL (rejected: hard to test and replay).
- Consequences: Services must load all inputs before calling the engine.

## ADR-002 — SQLite + Drizzle ORM
- Date: 2026-11-22
- Status: Accepted
- Context: The team wants an embedded DB inside the project. Pilot scale is small (one site, 2,000 bays, 5,000 users).
- Decision: SQLite via `better-sqlite3` with WAL mode, Drizzle ORM and drizzle-kit migrations.
- Alternatives: Postgres (deferred: more operations for a pilot); Prisma (rejected: heavier, weaker SQLite story).
- Consequences: Single writer, single instance. Move to Postgres when many customers share one deployment or we need more than one instance. Avoid SQLite-only SQL.

## ADR-001 — TypeScript monorepo (React + Fastify)
- Date: 2026-11-22
- Status: Accepted
- Context: Built with Cursor and Claude Code; one language gives the AI shared types end to end.
- Decision: pnpm monorepo with `apps/web` (React + Vite PWA), `apps/api` (Fastify), `packages/engine`, `packages/db`, `packages/shared`.
- Alternatives: Next.js full-stack (rejected: its serverless default fits poorly with SQLite and long-running jobs); separate repos (rejected: type drift).
- Consequences: Two build targets; Fastify serves the built web app in production.
