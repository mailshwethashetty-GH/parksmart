# 05 — Non-Functional Requirements

Trust is the product. A lost booking or an opaque decision ends use, so **reliability and auditability rank above feature breadth.**

| Area | Requirement | How we meet it (see `06-tech-stack.md`) |
| --- | --- | --- |
| **Integrity** | The engine never confirms more bookings than bays of that type. A confirmed booking is never silently reassigned | Engine invariant + property tests; DB `UNIQUE(bay_id, date)`; rounds commit in one transaction |
| **Availability** | 99.5% monthly uptime for booking and check-in. The 06:00–11:00 IST weekday peak gets priority for incident response | `/health` endpoint, uptime monitor, Sentry alerts, Litestream backups for fast restore |
| **Performance** | Booking and check-in API p95 < 500 ms. Overnight allocation for 2,000 bays finishes in < 5 min | `better-sqlite3` (synchronous, in-process), indexed queries, pure in-memory engine |
| **Scale** | v1: one site, up to 2,000 bays and 5,000 users. Data model supports multiple sites from day one | `org_id` / `site_id` on every table; Drizzle keeps a Postgres move open |
| **Privacy** | DPDP Act 2023 compliant: stated purpose, consent at sign-up, data export and deletion on request. Vehicle number optional unless the site requires it. Attendance history visible only to the user and admins | Consent table, export/delete endpoints, role checks, pseudonymous data sent to the AI |
| **Security** | SSO only, no local passwords. Role-based access. Encryption in transit and at rest. QR codes rotate daily to prevent sharing | Better Auth SSO, HTTPS via Caddy, disk encryption, signed daily QR tokens (`jose`) |
| **Auditability** | Every allocation, override, release and policy change is logged with actor, time and reason. Logs kept for 12 months | Append-only `audit_log` (triggers block UPDATE/DELETE), retention job |
| **AI guardrails** | AI acts only at the stage the admin has enabled, never changes rules or weights, scoring is deterministic and replayable, all AI outputs are logged, one-click pause, requests made via Claude need user confirmation | Server-side stage check, `ai_logs` table, template fallback when the API is down |
| **Accessibility** | WCAG 2.1 AA for employee and admin screens. Accessible-bay flows usable with a screen reader | shadcn/ui (Radix), axe checks in Playwright |
| **Platforms** | Mobile-first responsive PWA for employees, desktop web for admins, English at launch | React + Vite PWA, `react-i18next` |
| **Notifications** | Max 3 per user per day. Quiet hours 22:00–07:00. Time-critical messages (waitlist offers, release warnings, check-in reminders) are exempt from both | One notification service enforces the cap and quiet hours |

## Data residency note

The app and DB are hosted in an India region. Claude API calls are processed outside India. Send only pseudonymous IDs and scores, state this in the privacy notice, and confirm it with each customer.
