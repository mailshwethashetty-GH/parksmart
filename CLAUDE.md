# CLAUDE.md — ParkSmart

ParkSmart is a parking allocation app for hybrid-work offices with limited bays. Employees request bays during a collation window. A deterministic engine scores every request against admin-defined, weighted rules, and the bays go to the highest scores. **Booking early earns no advantage.** v1 is a 60-day pilot at one Bengaluru site.

This file is loaded every session, so keep it short. Detailed context lives in `docs/`.

---

## Where the context lives

Read the relevant doc **before** working on an area. Do not load every doc for every task.

| Read this | When you are working on |
| --- | --- |
| `docs/01-product-overview.md` | Scope, goals, non-goals, success metrics |
| `docs/02-personas.md` | UX decisions, copy, privacy trade-offs |
| `docs/03-allocation-model.md` | Rounds, rules, scoring, the engine, AI stages |
| `docs/04-functional-requirements.md` | Any feature: what to build and its acceptance criteria |
| `docs/05-non-functional-requirements.md` | Performance, security, privacy, uptime, accessibility |
| `docs/06-tech-stack.md` | Choosing or adding a library, tool or service |
| `docs/07-architecture.md` | Repo layout, modules, scheduler, request flow |
| `docs/08-data-model.md` | DB schema, migrations, constraints |
| `docs/09-api-conventions.md` | Endpoints, errors, auth, validation |
| `docs/10-ux-flows.md` | Screens, booking states, user journeys |
| `docs/11-raid.md` | Risks, assumptions, open issues, dependencies |
| `docs/12-decision-log.md` | Why something is the way it is (ADRs) |
| `docs/13-build-plan.md` | What to build next: milestones, order, exit criteria |
| `docs/14-operations-runbook.md` | Deploying, monitoring, backups, restore, incidents |
| `docs/15-gate-guide.md` | Security staff at the gate (plain language, printable) |
| `docs/CHANGELOG.md` | What changed in the docs and when |

---

## Non-negotiable rules

1. **Never over-book.** Confirmed bookings for a bay type and date must never exceed bays. Enforce it in the engine **and** in the DB (`UNIQUE(bay_id, date)` on confirmed bookings).
2. **Submission time is never scored.** It is stored for audit only. Ties are settled by a seeded, logged random draw.
3. **The engine stays pure and deterministic.** `packages/engine` has no DB, network, clock or `Math.random` calls. Same inputs + seed = same output.
4. **AI never changes rules or weights.** It may only explain, flag or suggest. The current AI stage (1/2/3) is checked on the server.
5. **Every allocation, override, release and policy change writes to `audit_log`** with actor, time and reason. The audit log is append-only.
6. **SSO only.** No local passwords. The dev-only login must be disabled when `NODE_ENV=production`.
7. **Collect the least personal data.** Never store medical details (only an approved flag with an expiry). Never send names, vehicle numbers or medical flags to the Claude API.
8. **Policy changes take effect from the next weekly round**, never mid-round.
9. **All site times are in the site's time zone** (default `Asia/Kolkata`). Store UTC in the DB.

---

## Stack (summary; full detail in `docs/06-tech-stack.md`)

TypeScript (strict) · pnpm monorepo · React 19 + Vite PWA · Tailwind + shadcn/ui · TanStack Query · Fastify 5 · Zod (shared schemas) · REST + OpenAPI · SQLite (`better-sqlite3`) + Drizzle ORM · Croner scheduler · Better Auth (OIDC/SAML SSO) · Anthropic SDK · Vitest + fast-check + Playwright.

## Commands

```bash
pnpm install          # install all workspaces
pnpm dev              # run web (:5173) + api (:3000) in watch mode; needs .env (copy .env.example, set secrets)
pnpm test             # unit + engine property tests
pnpm test:e2e         # build web, then Playwright (e2e/: pilot week + axe + perf)
pnpm lint && pnpm typecheck
pnpm format           # prettier --write (CI runs format:check)
pnpm build            # web (vite) + api (esbuild bundle)
pnpm db:generate      # drizzle-kit: create a migration from schema changes
pnpm db:migrate       # apply migrations to data/parksmart.db
pnpm db:seed          # load sample site, bays, users, policy
```

(Update this list if scripts change.)

## Code conventions

- Zod schemas live in `packages/shared` and are the single source for request/response types.
- The Drizzle schema in `packages/db` is the single source of truth for the database. Never edit the DB by hand. Always generate a migration.
- Engine changes need tests first: add or update a fast-check property test, then make it pass.
- Feature IDs (`FR-n`) from `docs/04-functional-requirements.md` go in commit messages and PR titles.
- Prefer small, focused files. No business logic in React components or route handlers. Put it in services.

---

## Keeping the docs current

The docs are the project's memory. Update them **only when it matters**, not on every change.

**Update the docs when a change:**

- Adds, removes or materially changes a feature → `04-functional-requirements.md` (and its Status column)
- Changes allocation rules, rounds, scoring or AI stages → `03-allocation-model.md`
- Adds or removes a table or column, or changes a constraint → `08-data-model.md`
- Adds, renames or removes an endpoint, or changes the auth or error format → `09-api-conventions.md`
- Adds or replaces a runtime dependency, service or hosting choice → `06-tech-stack.md`
- Changes module boundaries, folder structure, jobs or deployment → `07-architecture.md`
- Changes a screen, a user flow or the booking states → `10-ux-flows.md`
- Is a significant decision with trade-offs → add an ADR to `12-decision-log.md`
- Resolves or raises a risk, assumption or issue → `11-raid.md`

**Do NOT update the docs for:** bug fixes, refactors that keep behaviour, styling or copy tweaks, test-only changes, dev-dependency bumps or small internal renames.

**How to update:**

1. Edit only the affected sections. Keep the existing structure and tone, and do not rewrite whole files.
2. Add one line to `docs/CHANGELOG.md`: `YYYY-MM-DD — file(s) — what changed — why`.
3. If code and docs disagree, tell the user before choosing one. Never silently "fix" the docs to match a bug.
4. At the end of a task that touched the docs, say in one line which docs you updated.
5. For drastic changes (for example, replacing SQLite or changing the allocation model), propose the doc changes and get the user's OK first.

The user can also run `/update-docs` to sync the docs on demand.
