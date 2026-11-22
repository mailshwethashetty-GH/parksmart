# 06 — Tech Stack

> Any new runtime dependency, service or hosting change must be recorded here (and in `12-decision-log.md` if it replaces something). Dev-only tooling bumps do not need an entry.

## Overview

| Layer | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript 5.9 (strict)**, Node.js 22 LTS or later (`engines: >=22.12`) | One language and one set of types from DB to UI. TS is held at 5.9 until typescript-eslint supports 7 |
| Repo | **pnpm workspaces monorepo** (pnpm 12) | App, API, engine and shared code kept apart in one repo. Workspace packages export TypeScript source; native builds allowed via `allowBuilds` in `pnpm-workspace.yaml` |
| Frontend | **React 19 + Vite**, installable PWA | Mobile-first for employees; desktop for admins |
| Backend | **Node.js + Fastify 5** | Fast, typed, built-in logging; p95 < 500 ms |
| API | **REST + OpenAPI**, generated from Zod schemas | One schema validates and documents. Ready for access-control and HRMS links |
| DB | **SQLite** via `better-sqlite3` + **Drizzle ORM** | One file inside the project, no DB server; Postgres path kept open |
| Scheduling | **Croner** + `job_runs` table | Rounds and auto-release with no Redis |
| AI | **Anthropic TypeScript SDK** (Claude API) | NL requests, reasons, anomaly flags, AI stages |
| Hosting | **One Docker container on a VM in an India region** | SQLite needs a persistent disk and a single instance |

## Frontend — `apps/web`

| Concern | Library |
| --- | --- |
| Build / PWA | Vite 8, `vite-plugin-pwa` (Workbox; API, auth and `/docs` never cached) |
| Routing | React Router v7 (route groups `/app`, `/admin`, `/gate`) |
| Data from the server | TanStack Query |
| UI | Tailwind CSS v4 + shadcn/ui (Radix; `clsx`, `tailwind-merge`, `class-variance-authority`) |
| Forms / validation | React Hook Form + `@hookform/resolvers` (Zod 4) with schemas from `packages/shared` |
| Dates | `react-day-picker`, `date-fns`, `date-fns-tz` |
| QR | `qrcode.react` 4 (display: employee QR, bay stickers), `@zxing/browser` (camera scanner on `/gate`, loaded on demand; handheld scanners type into the field instead) |
| Charts | Recharts |
| Live updates | Server-Sent Events: `GET /api/v1/stream/me` sends "your requests changed" (no data); the app refetches. In-process event bus (one instance). 30 s polling stays as a fallback |
| Text strings | `react-i18next` + `i18next` (English at launch, `src/locales/en.json`) |

## Backend — `apps/api`

| Concern | Library / approach |
| --- | --- |
| HTTP | Fastify 5, `fastify-plugin`, `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui` (dev only), `@fastify/static` (serves built web app) |
| Auth | Better Auth + `@better-auth/sso` (OIDC/SAML for Google Workspace, Microsoft Entra), Drizzle/SQLite adapter, httpOnly cookie sessions (`parksmart.` prefix), mounted at `/api/v1/auth`. Only admins may register an identity provider. Dev-only login is a small Better Auth plugin registered only outside production |
| Roles | Middleware: `employee`, `admin`, `security`, scoped by site |
| Security | `@fastify/helmet` (strict CSP in production), `@fastify/rate-limit` (300/min/IP), `@fastify/cookie` + `@fastify/csrf-protection` (signed cookie + `x-csrf-token` header), same-origin (no CORS plugin needed) |
| QR tokens | `jose` 6, HS256 with `QR_SIGNING_SECRET`: booking tokens valid only on the booking's site-local day (`nbf`/`exp`); static bay-sticker tokens |
| Scheduler | `croner` (time-zone aware). Every run written to `job_runs` with a unique key (idempotent) |
| Notifications | In-app table; email via Nodemailer (SMTP) or Amazon SES Mumbai; Web Push (`web-push`, VAPID) at P1 |
| Import / export | `papaparse` (CSV import), `exceljs` / CSV (report export) |
| Forecast | Plain TS statistics (day-of-week moving average with range) |
| Logging / errors | `pino`, Sentry |

### Scheduled jobs

All round jobs run from one Croner tick every minute, in this order for each site: round-deadlines → weekly → daily → same-day, then offer-expiry. Each claims a `job_runs` key first (`weekly:<site>:<week>`, `daily:<site>:<date>`, `same-day:<site>:<date>:<HH:mm>`), so restarts never double-run.

| Job | Schedule (site time) | Purpose |
| --- | --- | --- |
| `weekly-round` | Fri 12:00 (checked every minute; once per target week) | Allocate next Mon–Fri |
| `daily-round` | 18:00 on each working day (waits while an earlier round for that day is pending) | Allocate the next working day's changes and waitlist (Friday covers Monday) |
| `same-day-round` | Every 30 min, 07:00–17:00 (same waiting rule); also straight after an offer is declined or expires | Pool, waitlist, released no-shows → 10-min offers |
| `auto-release` | Every minute (in the round tick, before same-day rounds) | Release bays past the check-in deadline and re-offer them at once; release checked-in bookings when the day ends |
| `offer-expiry` | Every minute | Expire 10-min offers, re-offer the bay at once |
| `round-deadlines` | Every minute | Day-start auto-publish of unapproved rounds (built in M4); approval reminders arrive with notifications (M7). "Results delayed" is shown from round data |
| `recurring-expand` | Every 15 min (idempotent per site and week) | Create requests from recurring patterns for the next weekly round's target week |
| `audit-retention` | Daily 03:00 | Purge logs older than 12 months |
| `ai-batch` | After each round | Reasons, anomaly flags (P1) |

## Allocation engine — `packages/engine`

- Pure TypeScript. No DB, network, clock or `Math.random`.
- Seeded PRNG: `pure-rand` v8 (xoroshiro128+, one draw per request from a hash of seed, date and request id; seed stored with the round).
- Tests: Vitest + **fast-check** property tests.
- P1 best-fit by zone: `javascript-lp-solver` (inside the engine package).

## Database — `packages/db`

- `better-sqlite3` + Drizzle ORM; migrations via `drizzle-kit`.
- Settings applied at startup: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- File: `data/parksmart.db` (gitignored). Test DBs use `:memory:`.
- Backups: **Litestream** to S3-compatible storage in an India region.
- Encryption at rest: host disk encryption; `better-sqlite3-multiple-ciphers` (SQLCipher) if a customer requires it.
- **Migration trigger to Postgres:** many customers on one deployment, or more than one app instance. Avoid SQLite-only SQL to keep this cheap.

## AI — Claude API

| Use | Approach |
| --- | --- |
| NL requests (FR-2) | Tool use / structured output → Zod-validated draft → user confirms |
| Reasons (FR-15) | Template reason stored at run time; after each round Claude rewrites it (`AI_MODEL_FAST`, default `claude-haiku-5-5`, effort `low`, 20 s timeout, 2 SDK retries, concurrency 4). Accepted only if under 40 words and every bay code/number is kept; otherwise the template stays |
| Flags, summaries, weight suggestions (FR-17/18/28) | Batch after rounds; suggest-only |
| Models | Sonnet-class for parsing and suggestions, Haiku-class for high-volume reasons (set via env vars `AI_MODEL_SMART`, `AI_MODEL_FAST`) |
| Guardrails | `ai_logs` for every call; pseudonymous data only (no names, ids, emails, reason category); server-side stage check; no key → templates only; `@anthropic-ai/sdk` 1.x behind a small `AiClient` interface (tests inject a fake) |

## Testing and quality

| Concern | Tool |
| --- | --- |
| Unit / integration | Vitest, `fastify.inject` |
| Engine rules | fast-check |
| End-to-end | Playwright (+ `@axe-core/playwright`, WCAG 2.1 AA, fails on serious/critical) in the `e2e/` workspace: one serial pilot-week story on a harness with a test-driven clock, plus p95 (< 500 ms) and 4G (< 5 s) checks. `pnpm test:e2e` |
| API mocking in UI tests | MSW |
| Lint / format | ESLint + Prettier (or Biome) |
| Git hooks | Husky + lint-staged |
| CI | GitHub Actions: lint → format → typecheck → test → build; then e2e (report uploaded on failure) and a Docker build that checks the image starts healthy |

## Deployment

- API build: `esbuild` bundles `apps/api` and the workspace packages into `apps/api/dist/server.js`; npm dependencies stay external (so every runtime dependency of a bundled workspace package must also be listed in `apps/api`). Migrations are copied next to the bundle and applied at startup.
- Single Docker image (`Dockerfile`, Node 22 bookworm-slim, runs as `node` under `tini`): Fastify serves API + built web app; `pnpm deploy --prod` gives the API a production-only `node_modules`. Docker `HEALTHCHECK` on `/health`.
- **Litestream** 0.3 in the image: with `LITESTREAM_REPLICA_URL` set, the entrypoint restores an empty volume from the replica, then runs the app under `litestream replicate` (S3 `ap-south-1`, 30-day retention). Config in `deploy/litestream.yml`.
- **Caddy** reverse proxy for automatic HTTPS and gzip/zstd (`deploy/Caddyfile`, `deploy/docker-compose.yml`).
- Host: AWS Lightsail/EC2 (ap-south-1, Mumbai) or Azure Central India, with a persistent volume for `data/`.
- **Not** Vercel, Netlify or other serverless hosts (temporary file systems break SQLite and the scheduler).
- Monitoring: `/health`, Better Stack or UptimeRobot, Sentry (`@sentry/node`, API errors and failed jobs; all Sentry 11 data collection off and events scrubbed: no user, cookies, bodies, query strings or AI inputs). Steps in `14-operations-runbook.md`.

## Environment variables (initial)

```
NODE_ENV, PORT, APP_URL
DATABASE_PATH=./data/parksmart.db
SESSION_SECRET, QR_SIGNING_SECRET
ORG_EMAIL_DOMAIN                          # SSO users' email domain; required with SSO
SSO_GOOGLE_CLIENT_ID, SSO_GOOGLE_CLIENT_SECRET          # one provider, required in production
SSO_ENTRA_TENANT_ID, SSO_ENTRA_CLIENT_ID, SSO_ENTRA_CLIENT_SECRET
SETUP_ORG_NAME, SETUP_SITE_NAME           # first run on an empty database only (ADR-014)
INITIAL_ADMIN_EMAILS                      # comma-separated; admins on first sign-in
ANTHROPIC_API_KEY, AI_MODEL_SMART, AI_MODEL_FAST
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY      # P1
SENTRY_DSN, APP_VERSION                   # optional; APP_VERSION = Sentry release
LITESTREAM_REPLICA_URL, LITESTREAM_ACCESS_KEY_ID, LITESTREAM_SECRET_ACCESS_KEY   # optional
DEFAULT_TIMEZONE=Asia/Kolkata
DEV_LOGIN_ENABLED                         # dev/test only; server refuses to start if "true" in production
LOG_LEVEL                                 # optional pino level
```

Keep `.env.example` in sync with this list. Never commit `.env`.
