# 10 — UX and Key Flows

## Booking lifecycle

The only way a confirmed bay leaves its owner is a **cancel** or a **missed check-in**. (Keeps the Base44 status flow and adds auto-release.)

```mermaid
stateDiagram-v2
    direction LR
    Requested --> Confirmed: bay allocated
    Requested --> Waitlisted: no bay left
    Waitlisted --> Confirmed: promoted (offer accepted)
    Confirmed --> CheckedIn: QR scan at gate
    Confirmed --> AutoReleased: no check-in within grace
    Confirmed --> Cancelled: employee cancels
    CheckedIn --> Released: exit or day ends
    Cancelled --> [*]
    AutoReleased --> [*]
    Released --> [*]
    CheckedIn: Checked in
    AutoReleased: Auto-released
```

`Cancelled`, `AutoReleased` and `Released` are end states for that booking. A cancelled or auto-released booking frees its **bay**, which goes to the same-day pool and is offered to the next waitlisted request; the released booking itself does not change again.

## Key flows

1. **Planned request (Divya).** Open app → pick days or type "car bay Tue–Thu next week" → confirm → status *Requested* → weekly round on Friday → *Confirmed* or *Waitlisted* with a reason → reminder the evening before → QR scan at the gate.
2. **Last-minute day (Divya).** Request today → joins the next same-day round (every 30 min) with the held-back pool and released no-shows → offer to accept within 10 min, or waitlisted with live position and a reason.
3. **Set up rules (Meera).** Open Policy → start from the catalogue → add or edit a rule and its weight → builder shows coverage, privacy class, gaming risk and simulated impact → publish a new policy version from next week's round.
4. **Allocation round (Meera).** Round closes → engine scores requests → Stage 1: Meera (or a backup admin) approves or overrides weekly and daily rounds with a reason, while same-day rounds publish automatically for her to audit; Stage 2: reviews only AI-flagged exceptions; Stage 3: round publishes itself and she audits → employees notified.
5. **Event day (Meera).** Forecast flags a surge → Meera blocks bays and raises the same-day pool → employees see blocked bays and the reason.
6. **Reporting (Meera).** Weekly AI summary in plain English → monthly export of occupancy, no-shows, fairness spread, disputes and override rate.
7. **Gate check-in (Security).** Scan employee's daily QR → booking marked *Checked in* → or search name/bay and check in manually.

## Key screens

| Screen | Route | User | Must show |
| --- | --- | --- | --- |
| Sign in | `/login` | Everyone | Only the methods the server offers (`GET /login-options`): "Continue with Google" (or Microsoft) when an identity provider is set; the sample people (name and role) in dev, or in prototype demo mode, labelled as made-up demo data (ADR-017); otherwise "Sign-in is not set up yet" |
| Home | `/app` | Employee | Upcoming requests with status and the round that decides each (or "results by …" / "results delayed" while in review), waitlist position, same-day offer card with countdown and accept/decline, change/withdraw, links to book and weekly pattern. Confirmed bookings show bay and zone, the check-in deadline, today's QR code, "Running late", cancel; then "Checked in" or "Released" |
| Book | `/app/book` | Employee | 4-week day grid (closed days greyed), bay types the employee may request, "EV/accessible bay only", arrival window, optional reason, block notices, which round decides each selected day. Chat box for NL booking is P1 (FR-2) |
| Weekly pattern | `/app/recurring` | Employee | Weekday pattern, upcoming covered days with skip/undo, stop pattern |
| Booking detail | `/app/bookings/:id` | Employee | Not a separate page yet: bay and zone, reason and cancel are on the home list. Running late (M6) and appeal (P1) to come |
| Policy (read-only) | `/app/policy` | Employee | Current rules and weights in plain language |
| Profile | `/app/profile` | Employee | Vehicles (EV toggle; plate field only if the site requires it), optional distance band with why-we-ask and "prefer not to say", consent toggles with their text, data export and delete (with confirmation). Without `parking_allocation` consent the other `/app` screens show a one-time consent card; Profile and Parking rules stay open. A bell in the header opens the in-app inbox (unread count, mark all read) |
| Allocation review | `/admin/rounds/:id` | Admin | Decisions per day: rank, employee, outcome and bay, score (click for factor breakdown), reason; approve with optional note; inline override (move to waitlist / assign a free bay) with required reason. AI anomaly flags are P1 |
| Collation | `/admin/collation` | Admin | Per bay type and working day: requests, supply, same-day pool, demand ratio (red above 1×), confirmed, waitlisted, forecast still to come, rounds covering the day |
| Rounds | `/admin/rounds` | Admin | Recent rounds with status (awaiting review, past deadline, published and how), counts. Review/approve arrives in M5 |
| Policy | `/admin/policy` | Admin | Version list with status (draft, scheduled, in force, superseded); rule builder with live weight total, per-rule settings (neutral value, spot-check, cap, stated purpose) and inline feasibility; publish with a required reason and the week it takes effect; plain-language preview. Impact simulation (P1) and AI stage (M5+) to come. Round times and grace window are under Site setup → Settings |
| Site setup | `/admin/site` | Admin | Tabs: zones & bays (bulk add, deactivate, print stickers), blocks (bays or a whole zone, with a reason), accessible approvals (flag + end date only), people (search; change role with a reason, never your own), settings (rounds, deadlines, pool, grace, backup admins). User import is P1 |
| Analytics | `/admin/analytics` | Admin | Month picker; KPI tiles vs pilot targets (peak-day utilisation as the hero, no-shows, people below the fairness target, override rate, adoption) with on/off-target icon + label; daily utilisation columns (peak days highlighted, dashed 90% target, tooltips, table view); monthly CSV. Forecast is P1 (FR-27) |
| Audit | `/admin/audit` | Admin | Filter by action prefix and dates, load more, CSV export |
| Gate view | `/gate` | Security | Camera scanner + field for handheld scanners, result banner (name, bay, zone), checked-in/expected counts, bay map by state, today's bookings with search and manual check-in |
| Bay check-in | `/app/checkin?bay=…` | Employee | Opened by scanning a bay sticker; checks in and confirms the bay, or says which bay is theirs |
| Bay sticker | `/admin/site/bays/:id/sticker` | Admin | Printable QR sticker per bay ("Sticker" in the bays table) |

## UX principles

- **Under 30 seconds and 3 taps** for a single-day booking on mobile.
- **Always show the reason** for a decision, in under 40 words.
- **Show which round decides** a request and when the answer comes.
- **Explain why optional data is asked for**, and make "skip" obvious.
- **Accessible by default:** WCAG 2.1 AA; screen-reader-friendly accessible-bay flow.
- Respect the notification cap (3/day) and quiet hours (22:00–07:00). Waitlist offers, release warnings and check-in reminders are exempt.
- **Never leave the employee guessing.** If a round is still awaiting admin review after its deadline, show "Results delayed: awaiting admin review".
- If a request got a fallback bay (for example, an EV request given a car bay), say so in the reason.
