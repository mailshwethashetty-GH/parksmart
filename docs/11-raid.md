# 11 — RAID (Risks, Assumptions, Issues, Dependencies)

Impact: High / Medium / Low. Risks also carry a likelihood. Update **Status** when an item is resolved; add new items with the next free ID.

**Most urgent:** I1. The strategy bets on AI allocation, and the only real admin interviewed rejects it. v1 removes FCFS anyway, starts AI at Stage 1 with the admin approving every round, and needs the pilot admin's sign-off before build.

## Risks

| ID | Description | Likelihood | Impact | Response | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Admins reject AI allocation | High | High | Stage 1 with admin approval of every round; published rules; override and audit log (FR-16); later stages only by opt-in | Open |
| R2 | A booked bay is taken when the employee arrives | Medium | High | Engine never over-books; QR check-in at the gate; security sees the bay map | Open |
| R3 | Low check-in compliance breaks auto-release | Medium | High | Gate QR plus manual check-in; tune the grace window with pilot data | Open |
| R4 | Not clearly better or cheaper than the incumbent app | High | High | Measure request time, disputes and admin hours against the current app | Open |
| R5 | ₹150 per bay per month is too high | Medium | Medium | Test price at pilot close | Open |
| R6 | Seniority-based cultures resist weighted rules | Medium | Medium | Seniority stays configurable; simulation before publish; documented reserved bays | Open |
| R7 | Employees won't share distance, vehicle or attendance data | Medium | Medium | Optional fields score neutral; coverage check before go-live | Open |
| R8 | Incumbents add India-specific features within a year | Medium | Medium | Build fairness data and tech-park partnerships early | Open |
| R9 | Self-declared business-need reasons are gamed | Medium | Medium | Gaming-risk flag, spot-checks, AI anomaly flags (FR-17), weight cap | Open |
| R10 | Waiting for a round feels slower than instant FCFS | Medium | Medium | Weekly answer by Friday; daily by 19:00; track in-window requests | Open |
| R11 | Badly tuned weights produce unfair outcomes | Medium | High | 50% cap; impact simulation; fairness-spread metric | Open |
| R12 | Admin does not approve a weekly or daily round by its deadline, delaying results | Medium | High | Reminders, backup admins, "results delayed" notice, day-start auto-publish (ADR-008) | Open |

## Assumptions

| ID | Description | Impact | Validation | Status |
| --- | --- | --- | --- | --- |
| A1 | ~1 car bay per 10 employees at the pilot site | Medium | Confirm from site data at onboarding | Open |
| A2 | Peak days are Tue–Thu plus event days | Medium | First 4 weeks of pilot requests | Open |
| A3 | Employees have smartphones and will scan a QR code | High | Check-in rate in week 1 | Open |
| A4 | 15-min grace window is enough on heavy-traffic days | Medium | Review after week 2 | Open |
| A5 | 10% same-day pool meets last-minute demand | High | Interviews; pilot waitlist data | Open |
| A6 | Employees accept rule-based decisions when reasons are shown (simulated only) | High | Track appeals and overrides from week 1 | Open |
| A7 | Default weights reflect what the pilot site values | Medium | Review with pilot admin; simulate before go-live | Open |
| A8 | EV owners accept a car bay when no EV bay is left | Low | Track "EV bay only" opt-out rate and appeals | Open |
| A9 | Pilot admin accepts same-day rounds and day-start auto-publish without approval | High | Confirm in the I1 walk-through; both are site settings | Open |

## Issues

| ID | Description | Impact | Next step | Status |
| --- | --- | --- | --- | --- |
| I1 | Removing FCFS goes against the real admin's stated preference | High | Walk-through of published rules, Stage 1 approval and a simulation; sign-off before build | Open |
| I2 | Admin treats SSO and access-control link as hard requirements; strategy stubs access control | High | SSO at P0; scope the access-control vendor's API | Open |
| I3 | Persona evidence is thin (3 real, 10 simulated) | Medium | 8–10 more employee and 8–10 admin interviews | Open |
| I4 | No-show penalty beyond the score factor is undecided | Medium | Ask leadership; ship off by default | Open |
| I5 | No method to verify accessible/medical eligibility without records | Medium | Self-declaration + admin approval process with HR | Open |
| I6 | Incumbent app's cost unknown | Medium | Ask pilot admin and procurement | Open |
| I7 | Seniority and role factors need HR data; HRMS stubbed | Medium | CSV import at P1; low weight until coverage > 90% | Open |

## Dependencies

| ID | Description | Impact | Needed for | Status |
| --- | --- | --- | --- | --- |
| D1 | Pilot site and Facilities Head sign-off | High | Build start | Open |
| D2 | Site identity provider (Google Workspace or Microsoft Entra) | High | Pilot launch (FR-29) | Open |
| D3 | Access-control vendor API | Medium | FR-30 (P2) | Open |
| D4 | QR codes printed; security staff briefed | High | Pilot launch | Open |
| D5 | Claude API access | Medium | FR-2, FR-15, FR-17, FR-18 | Open |
| D6 | Access to employees and admins for interviews | Medium | I3 | Open |
| D7 | HR data export (join date, role tags) | Medium | Seniority and client-facing factors | Open |
| D8 | At least 2 weeks of pilot data | Medium | Impact simulation, no-show factor, Stage 2 | Open |
