# 14 — Operations Runbook

> For whoever deploys and runs the pilot (IT or the delivery team). How to stand ParkSmart up (Vercel + Turso for the capstone prototype, or one Docker host), check it is healthy, back it up, restore it and handle an incident. Architecture is in `07-architecture.md`; hosting choices in `06-tech-stack.md`. Last reviewed: 2026-11-22.

## Capstone prototype: Vercel + Turso (ADR-016)

The hosted prototype runs on Vercel (web + API function) with a Turso database and GitHub Actions as the scheduler. The Docker deployment below stays the option for a real pilot.

**One-time setup**

1. **Turso** (app.turso.tech): create a database in AWS `ap-south-1` (Mumbai), for example `parksmart`. Copy its URL (`libsql://parksmart-<org>.turso.io`) and create a database token (read-write, no expiry or a long one).
2. **Schema and sample data**, from a checkout: `DATABASE_URL=… DATABASE_AUTH_TOKEN=… pnpm db:migrate`, then the same with `pnpm db:seed` (demo org, site, 150 bays, sample people, default policy).
3. **Vercel**: import the GitHub repo (Add New → Project). Framework preset: Other. `vercel.json` sets the install and build commands and the `bom1` region. Environment variables (Production):

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `APP_URL` | `https://<project>.vercel.app` (the production domain) |
   | `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | From step 1 |
   | `SESSION_SECRET`, `QR_SIGNING_SECRET`, `CRON_SECRET` | 48 random characters each: `openssl rand -base64 48` |
   | `DEMO_MODE` | `true` for the capstone demo (sample people sign in; ADR-017) |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (installs with the repo's pnpm 12) |
   | `ORG_EMAIL_DOMAIN`, `SSO_GOOGLE_CLIENT_ID`, `SSO_GOOGLE_CLIENT_SECRET` | Optional, for Google sign-in (step 5). `ORG_EMAIL_DOMAIN=gmail.com` when reviewers use Gmail |
   | `ALLOWED_EMAILS`, `INITIAL_ADMIN_EMAILS` | Who may sign in with Google, and who of them is admin |
   | `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `SMTP_*` | Optional, as for Docker |

4. **Scheduler**: GitHub repo → Settings → Secrets and variables → Actions: add `PARKSMART_URL` (`https://<project>.vercel.app`) and `CRON_SECRET` (same value as in Vercel). The "Scheduled jobs" workflow then calls `/api/v1/cron/tick` every 5 minutes; run it by hand from the Actions tab to test.
5. **Google sign-in (optional)**: Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application). Authorised redirect URI: `https://<project>.vercel.app/api/v1/auth/sso/callback/google`. Consent screen in Testing mode with the reviewers added as test users. Put the client ID and secret in Vercel and redeploy.

**Checks**: `https://<project>.vercel.app/health` returns `{"status":"ok","db":"ok"}`; the login page lists the sample people; the Actions run log shows `{"rounds":{"ok":true,…}}`.

**Deploys**: every push to `main` deploys to production; other branches get preview URLs (they share the production database unless given their own `DATABASE_URL`). Run `pnpm db:migrate` against Turso **before** merging a change that adds a migration.

**Known limits**: deadlines can run a few minutes late (GitHub's schedule, R15); live updates are 30 s polling; Turso's dashboard shows usage against the free tier (R17); restore from Turso's point-in-time backups in its dashboard.

## What runs where

One Linux host in an India region (AWS Lightsail/EC2 `ap-south-1` or Azure Central India) with Docker:

| Container | What it does |
| --- | --- |
| `app` | The ParkSmart image: Fastify serves the API and the web app, runs the scheduler (rounds every minute, notifications, recurring requests) and, with Litestream, streams every database write to object storage |
| `caddy` | HTTPS (Let's Encrypt), gzip/zstd, reverse proxy to `app:3000` |

The database is one SQLite file on the `parksmart-data` volume (`/data/parksmart.db`). There is **one** app container; never run two against the same file.

## First deployment

1. **DNS.** Point the pilot hostname (for example `parking.example.com`) at the host. Open ports 80 and 443.
2. **Identity provider (D2).** Register an OIDC web app with the site's IdP:
   - Google Workspace: Google Cloud console → OAuth client (Web). Microsoft Entra: App registrations → new app, single tenant.
   - Redirect URI: `https://<host>/api/v1/auth/sso/callback/google` (or `/entra`).
   - Scopes: `openid email profile`. Keep the client ID and secret (and the Entra tenant ID).
3. **Backups bucket.** Create a private S3 bucket in `ap-south-1` (versioning on) and an access key limited to that bucket.
4. **Configuration.** On the host, in the repo checkout: `cp .env.example .env.production` and fill in:

   | Variable | Value |
   | --- | --- |
   | `APP_URL` | `https://<host>` |
   | `SESSION_SECRET`, `QR_SIGNING_SECRET` | 48+ random characters each: `openssl rand -base64 48` |
   | `ORG_EMAIL_DOMAIN` | The company email domain, e.g. `example.com` |
   | `SSO_GOOGLE_*` **or** `SSO_ENTRA_*` | From step 2. Exactly one provider |
   | `SETUP_ORG_NAME`, `SETUP_SITE_NAME` | e.g. `Example GCC`, `Bengaluru HQ`. Used once, on the empty database |
   | `INITIAL_ADMIN_EMAILS` | The Facilities Head and a backup admin, comma-separated |
   | `SMTP_*`, `MAIL_FROM` | The company relay or Amazon SES (Mumbai). Without them emails are only logged |
   | `LITESTREAM_REPLICA_URL`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` | From step 3, e.g. `s3://parksmart-backups/prod` |
   | `SENTRY_DSN` | Optional. Events carry no personal data |
   | `ANTHROPIC_API_KEY` | Optional. Without it, decision reasons stay as templates |

   Leave `DEV_LOGIN_ENABLED` unset. The server refuses to start if it is `true`, or if no identity provider is configured.

5. **Start.** `DOMAIN=<host> docker compose -f deploy/docker-compose.yml up -d --build`
6. **Check.** `curl https://<host>/health` returns `{"status":"ok","db":"ok"}`. `docker compose -f deploy/docker-compose.yml logs app` shows "First-run setup created the org and site" and "SSO identity provider configured".
7. **First admin.** An `INITIAL_ADMIN_EMAILS` person signs in at `https://<host>`. They land on `/admin`.
8. **Site data (admin, in the app).** Site setup → Zones & bays: add zones and bulk-add the real bays (codes as painted). Settings: working days, round times, approval deadlines, backup admins, grace window. Accessible approvals: flag + end date only. Policy: review the default rules and publish any changes (they apply from the next weekly round).
9. **Bay stickers (D4).** Site setup → each bay → Sticker → Print. Laminate and fix at eye level in each bay.
10. **Gate.** Give security staff accounts (they sign in with SSO; an admin sets their role) and the gate guide (`15-gate-guide.md`). A tablet or phone at the gate on `/gate`.

## Monitoring

| Check | How | Alert |
| --- | --- | --- |
| Uptime | Better Stack or UptimeRobot on `https://<host>/health` every 1 min | Two failures in a row. Page during 06:00–11:00 IST on weekdays |
| Errors | Sentry (`SENTRY_DSN`): unhandled API errors and failed jobs, tagged by route or job | New issue, or more than 10 events in 5 min |
| Rounds | The weekly round appears under Admin → Rounds by Friday 12:05; the round approval reminder emails reach admins | Admin reports it missing |
| Backups | `docker compose … exec app litestream snapshots /data/parksmart.db` lists a snapshot from the last 24 h | Weekly manual check |
| Disk | Host disk under 80% | Host monitoring |

The image has a Docker `HEALTHCHECK` on `/health`; `docker ps` shows `healthy`.

## Backups and restore

Litestream streams the WAL to the bucket within seconds and takes a daily snapshot; 30 days are kept (`deploy/litestream.yml`).

**Restore drill (do it before launch, then monthly):**

1. On a spare host or a laptop with Docker, use the same `.env.production` (with `LITESTREAM_*`) and an **empty** volume.
2. `docker compose -f deploy/docker-compose.yml up -d app`. On an empty volume the entrypoint restores the latest replica before starting.
3. Sign in and check yesterday's rounds and bookings are there. Then stop and remove that copy.

**Real restore:** stop the app (`docker compose … stop app`), move the broken `parksmart.db*` files out of the volume, start the app again. It restores from the replica on start. To restore to a point in time: `litestream restore -config /app/litestream.yml -timestamp 2026-12-15T05:00:00Z -o /data/parksmart.db "$DATABASE_PATH"` with the app stopped.

## Upgrades

1. `git pull` the tagged release on the host.
2. `DOMAIN=<host> docker compose -f deploy/docker-compose.yml up -d --build app`. Migrations run at start. The scheduler is idempotent, so a restart never runs a round twice.
3. Avoid 06:00–11:00 IST and Friday 11:30–14:30 IST (weekly round and approval window).
4. Check `/health` and the app log. Set `APP_VERSION` to the release tag so Sentry groups errors by release.

## Incidents

| Symptom | First steps |
| --- | --- |
| Site down | `docker compose … ps` and `logs app --tail 200`. "Refusing to start: …" names the config problem. Restart: `docker compose … restart app` |
| Nobody can sign in | Check the IdP app (secret expiry, redirect URI). Log shows the error. Unknown email domains are refused by design |
| Weekly round missing on Friday | Check the log for `job failed` (also in Sentry). Fix and restart: the round runs on the next minute tick as long as it is still before the target week |
| Round not approved in time | It publishes itself at the day-start same-day round (07:00) if auto-publish is on. Tell employees results are delayed |
| Gate cannot check people in | Gate staff use manual check-in by name or bay (gate guide). If the whole app is down, staff keep a paper list and an admin records check-ins afterwards |
| Wrong allocation reported | Admin → Audit and the round's review page show every decision with its score and reason. Overrides need a reason and are logged |

Write a short note after each incident (what, impact, cause, fix) and add risks to `11-raid.md`.

## Secrets

- Rotate `SESSION_SECRET` to sign everyone out (for example after a leak).
- Rotate `QR_SIGNING_SECRET` outside gate hours: QR codes on phones refresh from the app, and printed bay stickers must be reprinted.
- The IdP client secret expires (Entra: max 24 months). Diary the expiry date.
- Never commit `.env.production`. It is git-ignored.

## Data protection (DPDP)

- Employees export or delete their own data from Profile. Deletion anonymises the account and keeps allocation history for the audit trail.
- The `audit-retention` job deletes audit and AI logs older than 12 months.
- Only pseudonymous facts are sent to the Claude API; Sentry events carry no user, cookies, headers (except user-agent), query strings or bodies.
