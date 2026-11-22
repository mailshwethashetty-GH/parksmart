# 02 — Personas

> Evidence: 3 real interviews (2 employees, 1 admin) and 10 simulated. Requirements resting only on simulated data are marked as hypotheses in `04-functional-requirements.md` and `11-raid.md`.

## Primary personas

|  | **Divya Nair**, hybrid driver (primary user) | **Meera Raghavan**, parking admin (primary buyer-user) |
| --- | --- | --- |
| Context | 38, Program Manager, drives 2–3 flexible days a week; owns an EV or is considering one | 38, Facilities Admin at a 1,500-person GCC site with ~150 car bays (~10 EV) |
| Today | Books in a 28-day FCFS app; ~10 min per booking; misses a bay 2–3 times a month | Runs FCFS with 28/14/7-day releases; lot full until noon; logs no-shows with no consequence |
| Top need | A booked bay that is really there | A fair, defensible rule and fewer no-shows |
| Second need | A path for last-minute office days | Calm event days (townhalls, ~4 per quarter) |
| Fairness view | Need and medical first; seniority feels unfair | FCFS, because no one can claim favouritism |
| On AI | Fine if the reason is shown | Does not recommend AI allocation; needs audit trail, override and stated reasons if it is used |
| Privacy | Reluctant to share attendance pattern or vehicle number | Needs DPDP compliance |
| Deal-breaker | Shows up with a booking and no bay | Not better or cheaper than the current app; no SSO or access-control link |
| Tech comfort | Mobile-first, expects consumer-grade speed | Confident app user, sceptical of AI. Works daily with security guards, IT (SSO) and the tech-park team |

## Secondary segments (supported, not designed around)

- **Two-wheeler riders**: capacity-based zones (FR-32).
- **Carpoolers**: verified carpool factor at P2 (FR-33).
- **Employees with accessibility needs**: reserved bays via admin approval with an expiry date (FR-13).
- **Security staff**: gate view, manual check-in, bay map (role: Security).

## What this means for the product

- **Guarantee comes first.** A confirmed booking must hold a physical bay, so the engine never over-books.
- **Same-day demand is real and frequent.** A held-back pool serves it instead of the "come after noon" workaround.
- **FCFS goes, but its one virtue for Meera, defensibility, stays.** Rules and weights are published in plain language for every employee, and she approves each allocation round until she chooses otherwise.
- **Collect the least personal data.** Vehicle number is optional unless the site's gate requires it. Optional fields score neutral when missing.
- **Show the reason.** Every decision comes with a plain-language reason (employee) and a full score breakdown (admin).

## Interview signals behind the default weights

- Need and medical priority rated high (avg 4.4 / 5).
- Seniority rated low (avg 2.4 / 5).
- Distance split → small weight.
- Admin price band (simulated only): bargain ~₹60–120; "getting expensive" ~₹120–250 per bay per month.
