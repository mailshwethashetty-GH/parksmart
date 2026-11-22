# 01 — Product Overview

> Source: ParkSmart AI PRD v2 (Nov 21, 2026), Strategy & Opportunity Document. Last reviewed: 2026-11-22.

## What ParkSmart is

ParkSmart replaces first-come-first-served (FCFS) parking with **rule-based allocation** for hybrid-work offices that have limited parking. Employees submit requests during a collation window. The system scores every request against admin-defined rules and weights, and bays go to the highest scores. **Booking early earns no advantage.**

v1 rebuilds the Base44 prototype (ParkWise) for a **60-day free pilot at one Bengaluru site**. The data model supports multiple sites from day one, so the product can later serve small, mid and large offices.

## Problem

- Employees cannot know in advance whether they will get a bay that fits their vehicle.
- Admins have no fair, data-backed way to ration bays on peak days.
- Reference site: **150 car bays (~10 EV) for ~1,500 employees**. The lot is 100% full until noon. Booked-but-empty bays carry no consequence.
- Allocation today runs on speed (a 28-day FCFS app, or informal WhatsApp and email claims). Advance bookers take every slot. Last-minute, EV and accessibility needs lose out.

## Three product decisions

1. **Collate, then allocate.** Requests for a day are gathered over a window and allocated together in scheduled rounds, so submission time never decides who parks.
2. **Admins own the rules.** A rule builder lets admins add rules, set their weights, and see whether each rule is feasible with the data the site holds before it goes live.
3. **AI earns autonomy in stages.** AI first explains and flags, then recommends allocations for admin approval, and eventually runs allocation on its own within the published weights. Each step needs admin opt-in and must pass trust criteria from pilot data.

## Goals (v1)

1. A booked bay is always there when the employee arrives.
2. Last-minute office days have a fair path to a bay.
3. No booked bay sits empty past the grace window.
4. Allocation follows published, weighted rules the admin can defend, never submission speed.
5. Booking takes seconds, not the ~10 minutes it takes today.
6. The admin gets forecasts and reports she does not have today.

**v1 succeeds if** the pilot site fills more than 90% of bays on its three busiest days and the admin chooses to keep it after 60 days.

## Non-goals (v1)

Payments and paid parking · ANPR cameras · hardware bay sensors · HRMS integration · public or street parking · a consumer app.
Building access-control and HRMS hooks are **designed for but stubbed**.

## Success metrics

| Metric | Baseline | Pilot target |
| --- | --- | --- |
| **Peak-day utilisation (north star):** bays occupied by a checked-in vehicle, Tue–Thu | ~70–75% (est.) | > 90% |
| No-show rate after auto-release | 10–20% | < 5% |
| Booked-but-no-bay incidents | Unknown | 0 per month |
| Missed bays per employee | 2–3 / month | < 1 / month |
| Median time to book one day | ~10 min | < 30 s on mobile |
| Booking adoption | n/a | > 70% of drivers by week 4 |
| Fairness spread | n/a | No employee below 60% of peak-day requests met per month |
| Allocation disputes | 1–3 days to resolve | −50% minimum, −80% stretch |
| Admin time on parking | 4–30 hrs/week | −5 hrs/week |
| EV charger turnover | ~1 session/day | ≥ 2 sessions per charger per day |
| Admin override rate | n/a | < 2% for 4 straight weeks before AI-run allocation is offered |
| Requests submitted inside the collation window | n/a | > 85% of planned-day requests |

The admin's keep-or-drop rule: **disputes down ~50% and 5+ admin hours saved a week.** The pilot dashboard tracks both from day one.

## Business context

- Wedge: mid-to-large Indian enterprises (GCCs) and managed tech parks, starting in Bengaluru.
- Indicative price: **₹150 per car bay per month** (to be tested at pilot close; two-wheeler bays priced lower).
- Competitors: incumbent FCFS booking apps, spreadsheets and WhatsApp groups, global parking tools (for example Wayleadr) priced and built for other markets.
