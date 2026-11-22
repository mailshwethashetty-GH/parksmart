/**
 * Employee requests (FR-1, FR-4). Rules (docs/03 §1):
 * - one active request per employee per day; a new one replaces an undecided one
 * - free to change or withdraw until the deciding round runs
 * - submission time is stored for audit only, never scored
 */
import {
  approvals,
  bayBlocks,
  bays,
  recurringSkips,
  requests,
  vehicles,
  type Db,
} from '@parksmart/db';
import {
  ACTIVE_REQUEST_STATUSES,
  addDays,
  decidingRound,
  siteLocalDate,
  type BayType,
  type CalendarResponse,
  type DecidedBy,
  type EmployeeRequest,
  type IsoDate,
  type RequestCreate,
} from '@parksmart/shared';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { businessRule, conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { loadSite } from './site';

type Site = ReturnType<typeof loadSite>;
type RequestRow = typeof requests.$inferSelect;
type Problem = { date: IsoDate; code: string; message: string };

const CLOSED_MESSAGES: Record<string, string> = {
  PAST_DATE: 'That day has passed.',
  NOT_WORKING_DAY: 'The office is closed that day.',
  BEYOND_HORIZON: 'Too far ahead to request yet.',
  SAME_DAY_CLOSED: "Today's last same-day round has run.",
};

export function decidedBy(site: Site, date: IsoDate, now: Date): DecidedBy | null {
  const d = decidingRound({ date, now, timeZone: site.timezone, settings: site.settings });
  return d.open
    ? { round: d.round, runAt: d.runAt.toISOString(), resultsBy: d.resultsBy.toISOString() }
    : null;
}

export function toEmployeeRequest(row: RequestRow, site: Site, now: Date): EmployeeRequest {
  const decided = row.status === 'requested' ? decidedBy(site, row.date, now) : null;
  return {
    id: row.id,
    date: row.date,
    bayType: row.bayType,
    arrivalWindow: row.arrivalWindow,
    reasonCategory: row.reasonCategory,
    allowFallback: row.allowFallback,
    status: row.status,
    recurringPatternId: row.recurringPatternId,
    decidedBy: decided,
    editable: row.status === 'requested' && decided !== null,
  };
}

// --- eligibility -------------------------------------------------------------
export function eligibilityOf(db: Db, userId: string, site: Site, now: Date) {
  const ev = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.userId, userId), eq(vehicles.isEv, true)))
    .get();
  const approval = db
    .select({ expiresAt: approvals.expiresAt })
    .from(approvals)
    .where(
      and(
        eq(approvals.userId, userId),
        eq(approvals.kind, 'accessible'),
        isNull(approvals.revokedAt),
      ),
    )
    .all()
    .filter((a) => a.expiresAt.getTime() > now.getTime())
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
  return {
    ev: !!ev,
    // Last valid site-local day (expiresAt is the start of the following day).
    accessibleThrough: approval
      ? siteLocalDate(new Date(approval.expiresAt.getTime() - 1), site.timezone)
      : null,
  };
}

function siteBayTypes(db: Db, siteId: string): Set<BayType> {
  return new Set(
    db
      .selectDistinct({ bayType: bays.bayType })
      .from(bays)
      .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
      .all()
      .map((b) => b.bayType),
  );
}

/** Request types this employee may make here. Carpool is P2. */
export function allowedBayTypes(
  types: Set<BayType>,
  eligibility: { ev: boolean; accessibleThrough: IsoDate | null },
): BayType[] {
  const allowed: BayType[] = [];
  if (types.has('car')) allowed.push('car');
  if (types.has('ev') && eligibility.ev) allowed.push('ev');
  if (types.has('accessible') && eligibility.accessibleThrough) allowed.push('accessible');
  if (types.has('two_wheeler')) allowed.push('two_wheeler');
  return allowed;
}

/** Why `bayType` can't be requested for `date`, or null when it can. */
export function typeProblem(
  bayType: BayType,
  date: IsoDate,
  types: Set<BayType>,
  eligibility: { ev: boolean; accessibleThrough: IsoDate | null },
): Omit<Problem, 'date'> | null {
  if (bayType === 'carpool')
    return { code: 'CARPOOL_NOT_AVAILABLE', message: 'Carpool bays are not available yet.' };
  if (!types.has(bayType))
    return { code: 'NO_BAYS_OF_TYPE', message: 'This site has no bays of that type.' };
  if (bayType === 'ev' && !eligibility.ev) {
    return { code: 'NOT_EV', message: 'EV bays need a registered electric vehicle.' };
  }
  if (
    bayType === 'accessible' &&
    (!eligibility.accessibleThrough || eligibility.accessibleThrough < date)
  ) {
    return {
      code: 'ACCESSIBLE_NOT_APPROVED',
      message: 'Accessible bays need an approval valid on that day.',
    };
  }
  return null;
}

// --- queries -----------------------------------------------------------------
const ownActive = (userId: string) =>
  and(eq(requests.userId, userId), inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]));

export function listRequests(
  db: Db,
  actor: Actor,
  now: Date,
  from?: IsoDate,
  to?: IsoDate,
): EmployeeRequest[] {
  const site = loadSite(db, actor.siteId);
  const start = from ?? siteLocalDate(now, site.timezone);
  const end = to ?? addDays(start, 42);
  return db
    .select()
    .from(requests)
    .where(and(ownActive(actor.id), gte(requests.date, start), lte(requests.date, end)))
    .orderBy(asc(requests.date))
    .all()
    .map((r) => toEmployeeRequest(r, site, now));
}

export function getCalendar(
  db: Db,
  actor: Actor,
  now: Date,
  from: IsoDate | undefined,
  days: number,
): CalendarResponse {
  const site = loadSite(db, actor.siteId);
  const start = from ?? siteLocalDate(now, site.timezone);
  const end = addDays(start, days - 1);
  const existing = new Map(
    db
      .select()
      .from(requests)
      .where(and(ownActive(actor.id), gte(requests.date, start), lte(requests.date, end)))
      .all()
      .map((r) => [r.date, r]),
  );
  const eligibility = eligibilityOf(db, actor.id, site, now);
  const notices = db
    .select({ dateFrom: bayBlocks.dateFrom, dateTo: bayBlocks.dateTo, reason: bayBlocks.reason })
    .from(bayBlocks)
    .where(
      and(
        eq(bayBlocks.siteId, actor.siteId),
        isNull(bayBlocks.deletedAt),
        lte(bayBlocks.dateFrom, end),
        gte(bayBlocks.dateTo, start),
      ),
    )
    .orderBy(asc(bayBlocks.dateFrom))
    .all();
  const uniqueNotices = [
    ...new Map(notices.map((n) => [`${n.dateFrom}|${n.dateTo}|${n.reason}`, n])).values(),
  ];

  return {
    days: Array.from({ length: days }, (_, i) => {
      const date = addDays(start, i);
      const d = decidingRound({ date, now, timeZone: site.timezone, settings: site.settings });
      const req = existing.get(date);
      return {
        date,
        open: d.open,
        closedReason: d.open ? null : d.reason,
        decidedBy: d.open
          ? { round: d.round, runAt: d.runAt.toISOString(), resultsBy: d.resultsBy.toISOString() }
          : null,
        request: req ? { id: req.id, status: req.status, bayType: req.bayType } : null,
      };
    }),
    bayTypes: allowedBayTypes(siteBayTypes(db, actor.siteId), eligibility),
    eligibility,
    notices: uniqueNotices,
  };
}

// --- mutations ---------------------------------------------------------------
export function createRequests(
  db: Db,
  actor: Actor,
  input: RequestCreate,
  now: Date,
): EmployeeRequest[] {
  const site = loadSite(db, actor.siteId);
  const types = siteBayTypes(db, actor.siteId);
  const eligibility = eligibilityOf(db, actor.id, site, now);
  const existing = new Map(
    db
      .select()
      .from(requests)
      .where(and(ownActive(actor.id), inArray(requests.date, input.dates)))
      .all()
      .map((r) => [r.date, r]),
  );

  const problems: Problem[] = [];
  for (const date of input.dates) {
    const d = decidingRound({ date, now, timeZone: site.timezone, settings: site.settings });
    if (!d.open) {
      problems.push({ date, code: d.reason, message: CLOSED_MESSAGES[d.reason]! });
      continue;
    }
    const typeIssue = typeProblem(input.bayType, date, types, eligibility);
    if (typeIssue) problems.push({ date, ...typeIssue });
    const prior = existing.get(date);
    if (prior && prior.status !== 'requested') {
      problems.push({
        date,
        code: 'ALREADY_DECIDED',
        message:
          prior.status === 'allocated'
            ? 'You already have a bay that day. Cancel it first to change it.'
            : 'You are on the waitlist that day. Withdraw first to change it.',
      });
    }
  }
  if (problems.length > 0) {
    throw businessRule(problems[0]!.code, problems[0]!.message, { problems });
  }

  const ids = db.transaction((tx) =>
    input.dates.map((date) => {
      const fields = {
        bayType: input.bayType,
        arrivalWindow: input.arrivalWindow,
        reasonCategory: input.reasonCategory,
        allowFallback: input.allowFallback,
        submittedAt: now, // audit only; never scored
      };
      const prior = existing.get(date);
      if (prior) {
        // A new request for the same day replaces the old one.
        tx.update(requests)
          .set({ ...fields, recurringPatternId: null })
          .where(eq(requests.id, prior.id))
          .run();
        return prior.id;
      }
      return tx
        .insert(requests)
        .values({
          orgId: actor.orgId,
          siteId: actor.siteId,
          userId: actor.id,
          date,
          status: 'requested',
          ...fields,
        })
        .returning({ id: requests.id })
        .get().id;
    }),
  );
  const rows = db
    .select()
    .from(requests)
    .where(inArray(requests.id, ids))
    .orderBy(asc(requests.date))
    .all();
  return rows.map((r) => toEmployeeRequest(r, site, now));
}

function ownRequest(db: Db, actor: Actor, id: string): RequestRow {
  const row = db.select().from(requests).where(eq(requests.id, id)).get();
  // Someone else's request is reported as not found, so ids can't be probed.
  if (!row || row.userId !== actor.id) throw notFound('Request');
  return row;
}

export function updateRequest(
  db: Db,
  actor: Actor,
  id: string,
  patch: Partial<
    Pick<RequestRow, 'bayType' | 'arrivalWindow' | 'reasonCategory' | 'allowFallback'>
  >,
  now: Date,
): EmployeeRequest {
  const site = loadSite(db, actor.siteId);
  const row = ownRequest(db, actor, id);
  if (!toEmployeeRequest(row, site, now).editable) {
    throw conflict('This request can no longer be changed: its round has run.');
  }
  if (patch.bayType && patch.bayType !== row.bayType) {
    const issue = typeProblem(
      patch.bayType,
      row.date,
      siteBayTypes(db, actor.siteId),
      eligibilityOf(db, actor.id, site, now),
    );
    if (issue) throw businessRule(issue.code, issue.message);
  }
  db.update(requests)
    .set({ ...patch, submittedAt: now })
    .where(eq(requests.id, id))
    .run();
  return toEmployeeRequest(db.select().from(requests).where(eq(requests.id, id)).get()!, site, now);
}

export function withdrawRequest(db: Db, actor: Actor, id: string, now: Date): EmployeeRequest {
  const site = loadSite(db, actor.siteId);
  const row = ownRequest(db, actor, id);
  if (row.status === 'allocated') {
    throw conflict('You have a bay for this day. Cancel the booking instead.');
  }
  if (row.status !== 'requested' && row.status !== 'waitlisted') {
    throw conflict('This request is no longer active.');
  }
  db.transaction((tx) => {
    tx.update(requests).set({ status: 'withdrawn' }).where(eq(requests.id, id)).run();
    // Withdrawing a pattern's request skips that day, so the pattern won't recreate it.
    if (row.recurringPatternId) {
      tx.insert(recurringSkips)
        .values({ patternId: row.recurringPatternId, date: row.date })
        .onConflictDoNothing()
        .run();
    }
  });
  return toEmployeeRequest({ ...row, status: 'withdrawn' }, site, now);
}
