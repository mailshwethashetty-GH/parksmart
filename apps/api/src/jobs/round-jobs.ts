/**
 * Round jobs (docs/06 scheduled jobs; ADR-004, ADR-008). Called every minute. For each
 * site, in order:
 *   1. round-deadlines  pending rounds auto-publish at the first same-day round of their
 *                       first day (if the site allows it)
 *   2. weekly-round     after the weekly run time, once per target week
 *   3. daily-round      after the daily run time, for the next working day, once — waits
 *                       while an earlier round for that day is still pending
 *   4. same-day-round   on each slot of the day, once per slot — same waiting rule
 * then offer-expiry for all sites, re-offering freed bays straight away.
 * Every run claims a `job_runs` key first, so restarts never double-run a round.
 */
import { and, asc, type Db, eq, rounds, sites } from '@parksmart/db';
import {
  addDays,
  isWorkingDay,
  nextWorkingDay,
  parseSiteSettings,
  siteLocalDate,
  siteLocalToUtc,
  weekStart,
  type IsoDate,
  type SiteSettings,
} from '@parksmart/shared';
import { autoRelease } from '../services/checkin';
import { expireOffers } from '../services/offers';
import { pendingRoundsCovering, publishRound, runRound } from '../services/rounds';
import { runOnce } from './runner';

type Site = { id: string; timezone: string; settings: SiteSettings };
export type JobEvent = { job: string; siteId: string; key?: string; detail: unknown };

const pad = (n: number) => String(n).padStart(2, '0');
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** The latest same-day slot (HH:mm) at or before `now`, or null outside same-day hours. */
export function currentSameDaySlot(site: Site, now: Date): string | null {
  const today = siteLocalDate(now, site.timezone);
  const { startTime, endTime, intervalMinutes } = site.settings.rounds.sameDay;
  const first = siteLocalToUtc(today, startTime, site.timezone).getTime();
  const last = siteLocalToUtc(today, endTime, site.timezone).getTime();
  if (now.getTime() < first || now.getTime() > last + intervalMinutes * 60_000) return null;
  const steps = Math.floor((now.getTime() - first) / (intervalMinutes * 60_000));
  const minutes = toMinutes(startTime) + steps * intervalMinutes;
  return minutes > toMinutes(endTime) ? null : fromMinutes(minutes);
}

function deadlines(db: Db, site: Site, now: Date, events: JobEvent[]) {
  if (!site.settings.autoPublishAtDayStart) return;
  const pending = db
    .select()
    .from(rounds)
    .where(and(eq(rounds.siteId, site.id), eq(rounds.status, 'pending_review')))
    .orderBy(asc(rounds.runAt))
    .all();
  for (const round of pending) {
    const dayStart = siteLocalToUtc(
      round.targetDateFrom,
      site.settings.rounds.sameDay.startTime,
      site.timezone,
    );
    if (now.getTime() < dayStart.getTime()) continue;
    publishRound(db, round.id, 'auto_timeout', null, now);
    events.push({
      job: 'round-deadlines',
      siteId: site.id,
      detail: { roundId: round.id, mode: 'auto_timeout' },
    });
  }
}

function weekly(db: Db, site: Site, now: Date, events: JobEvent[]) {
  const { weekday, time } = site.settings.rounds.weekly;
  const today = siteLocalDate(now, site.timezone);
  const runDate = addDays(weekStart(today), weekday - 1);
  if (now.getTime() < siteLocalToUtc(runDate, time, site.timezone).getTime()) return;
  const targetWeek = addDays(weekStart(runDate), 7);
  if (now.getTime() >= siteLocalToUtc(targetWeek, '00:00', site.timezone).getTime()) return;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(targetWeek, i)).filter((d) =>
    isWorkingDay(d, site.settings.workingDays),
  );
  const key = `weekly:${site.id}:${targetWeek}`;
  const out = runOnce(db, key, now, () =>
    runRound(db, { siteId: site.id, type: 'weekly', dates, now }),
  );
  if (out.ran && out.result.status !== 'skipped')
    events.push({ job: 'weekly-round', siteId: site.id, key, detail: summarise(out.result) });
}

function daily(db: Db, site: Site, now: Date, events: JobEvent[]) {
  const today = siteLocalDate(now, site.timezone);
  if (!isWorkingDay(today, site.settings.workingDays)) return;
  if (
    now.getTime() < siteLocalToUtc(today, site.settings.rounds.daily.time, site.timezone).getTime()
  )
    return;
  const target = nextWorkingDay(today, site.settings.workingDays);
  const closes = siteLocalToUtc(target, site.settings.rounds.sameDay.startTime, site.timezone);
  if (now.getTime() >= closes.getTime()) return;
  if (pendingRoundsCovering(db, site.id, target).length > 0) return; // publish in order (ADR-008)
  const key = `daily:${site.id}:${target}`;
  const out = runOnce(db, key, now, () =>
    runRound(db, { siteId: site.id, type: 'daily', dates: [target], now }),
  );
  if (out.ran && out.result.status !== 'skipped')
    events.push({ job: 'daily-round', siteId: site.id, key, detail: summarise(out.result) });
}

function sameDayRun(db: Db, site: Site, date: IsoDate, key: string, now: Date, events: JobEvent[]) {
  if (pendingRoundsCovering(db, site.id, date).length > 0) return;
  const out = runOnce(db, key, now, () =>
    runRound(db, { siteId: site.id, type: 'same_day', dates: [date], now }),
  );
  if (out.ran && out.result.status !== 'skipped')
    events.push({ job: 'same-day-round', siteId: site.id, key, detail: summarise(out.result) });
}

function sameDay(db: Db, site: Site, now: Date, events: JobEvent[]) {
  const today = siteLocalDate(now, site.timezone);
  if (!isWorkingDay(today, site.settings.workingDays)) return;
  const slot = currentSameDaySlot(site, now);
  if (!slot) return;
  sameDayRun(db, site, today, `same-day:${site.id}:${today}:${slot}`, now, events);
}

/** After an offer is declined or expires, offer the bay to the next person at once. */
export function reofferAfter(
  db: Db,
  siteId: string,
  date: IsoDate,
  offerId: string,
  now: Date,
): JobEvent[] {
  return sameDayNow(db, siteId, date, `after-offer:${offerId}`, now);
}

/**
 * Run a same-day round for `date` straight away when it is today and within same-day
 * hours (a bay was just freed). `trigger` makes the job key unique per cause.
 */
export function sameDayNow(
  db: Db,
  siteId: string,
  date: IsoDate,
  trigger: string,
  now: Date,
): JobEvent[] {
  const site = loadJobSite(db, siteId);
  const events: JobEvent[] = [];
  if (date !== siteLocalDate(now, site.timezone) || !currentSameDaySlot(site, now)) return events;
  sameDayRun(db, site, date, `same-day:${siteId}:${date}:${trigger}`, now, events);
  return events;
}

function loadJobSite(db: Db, siteId: string): Site {
  const row = db.select().from(sites).where(eq(sites.id, siteId)).get()!;
  return { id: row.id, timezone: row.timezone, settings: parseSiteSettings(row.settingsJson) };
}

function summarise(outcome: ReturnType<typeof runRound>) {
  return outcome.status === 'skipped'
    ? outcome
    : {
        status: outcome.status,
        roundId: outcome.roundId,
        confirmed: outcome.result.assignments.length,
        waitlisted: outcome.result.waitlist.length,
      };
}

export function roundJobs(db: Db, now: Date): JobEvent[] {
  const events: JobEvent[] = [];
  for (const row of db.select().from(sites).all()) {
    const site: Site = {
      id: row.id,
      timezone: row.timezone,
      settings: parseSiteSettings(row.settingsJson),
    };
    deadlines(db, site, now, events);
    weekly(db, site, now, events);
    daily(db, site, now, events);
    sameDay(db, site, now, events);
  }
  // FR-22: release unclaimed bays, then offer them straight away (same-day pool).
  for (const r of autoRelease(db, now)) {
    events.push({ job: 'auto-release', siteId: r.siteId, detail: r });
    events.push(...sameDayNow(db, r.siteId, r.date, `after-release:${r.bookingId}`, now));
  }
  for (const freed of expireOffers(db, now)) {
    events.push({ job: 'offer-expiry', siteId: freed.siteId, detail: freed });
    events.push(...reofferAfter(db, freed.siteId, freed.date, freed.offerId, now));
  }
  return events;
}
