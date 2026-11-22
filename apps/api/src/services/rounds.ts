/**
 * Allocation rounds (FR-5, FR-6; docs/07 round lifecycle; ADR-008).
 *
 * run:     load inputs → engine.allocate() → round + allocations, in one IMMEDIATE
 *          transaction so nothing else writes mid-allocation.
 * publish: confirmed → bookings (weekly/daily) or 10-minute offers (same-day);
 *          the rest → waitlist; ineligible → expired; audited.
 * Weekly and daily rounds wait for review (pending_review); same-day rounds publish
 * at once. Any round still pending at the first same-day round of its first day
 * auto-publishes when the site allows it (`auto_timeout`).
 */
import { allocate, type AllocateResult } from '@parksmart/engine';
import {
  allocations,
  and,
  bookings,
  type Db,
  eq,
  gte,
  inArray,
  lte,
  offers,
  requests,
  rounds,
  waitlist,
} from '@parksmart/db';
import {
  addDays,
  previousWorkingDay,
  siteLocalDate,
  siteLocalToUtc,
  weekStart,
  type IsoDate,
  type PublishMode,
  type RoundType,
} from '@parksmart/shared';
import { randomUUID } from 'node:crypto';
import { conflict, notFound } from '../lib/errors';
import { writeAudit } from './audit';
import { templateReason } from './reasons';
import { buildRoundInputs } from './round-inputs';
import { loadSite } from './site';

type RoundRow = typeof rounds.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const AUTO_REASONS: Record<Exclude<PublishMode, 'admin'>, string> = {
  auto_same_day: 'Same-day rounds publish automatically (ADR-008).',
  auto_timeout:
    'Not approved by the start of the day; published by the day-start safety valve (ADR-008).',
  auto_stage3: 'AI stage 3: rounds publish automatically.',
};

/** Rounds awaiting review that cover `date`. Later rounds for that date must wait. */
export function pendingRoundsCovering(db: Db, siteId: string, date: IsoDate): RoundRow[] {
  return db
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.siteId, siteId),
        eq(rounds.status, 'pending_review'),
        lte(rounds.targetDateFrom, date),
        gte(rounds.targetDateTo, date),
      ),
    )
    .all();
}

function approvalDeadline(
  db: Db,
  siteId: string,
  type: RoundType,
  dates: IsoDate[],
  now: Date,
): Date | null {
  const { settings, timezone } = loadSite(db, siteId);
  if (type === 'same_day') return null;
  if (type === 'weekly') {
    // Same calendar day as the run (the weekly round's own day).
    const runDate = siteLocalDate(now, timezone);
    return siteLocalToUtc(runDate, settings.rounds.weekly.approvalDeadline, timezone);
  }
  const runDate = previousWorkingDay(dates[0]!, settings.workingDays);
  return siteLocalToUtc(runDate, settings.rounds.daily.approvalDeadline, timezone);
}

/**
 * Tie-break seed for a round. Rounds in the same week reuse that week's weekly-round seed,
 * so equal scores break the same way in every round for a date and waitlist positions stay
 * stable (only real score changes reorder people). Otherwise a fresh random seed.
 */
export function seedFor(db: Db, siteId: string, dates: IsoDate[]): string {
  const week = weekStart(dates[0]!);
  const weeklyRound = db
    .select({ seed: rounds.seed })
    .from(rounds)
    .where(
      and(
        eq(rounds.siteId, siteId),
        eq(rounds.roundType, 'weekly'),
        gte(rounds.targetDateFrom, week),
        lte(rounds.targetDateFrom, addDays(week, 6)),
      ),
    )
    .get();
  return weeklyRound?.seed ?? randomUUID();
}

export type RunOutcome =
  | { status: 'skipped'; reason: 'NO_REQUESTS' }
  | { status: 'pending_review' | 'published'; roundId: string; result: AllocateResult };

/**
 * Run a round. Returns 'skipped' (and stores nothing) when there is nothing to allocate.
 */
export function runRound(
  db: Db,
  opts: { siteId: string; type: RoundType; dates: IsoDate[]; now: Date; seed?: string },
): RunOutcome {
  const seed = opts.seed ?? seedFor(db, opts.siteId, opts.dates);
  return db.transaction(
    (tx) => {
      const { input, policyVersionId } = buildRoundInputs(tx as unknown as Db, { ...opts, seed });
      if (input.requests.length === 0) return { status: 'skipped', reason: 'NO_REQUESTS' } as const;
      const result = allocate(input);
      const site = loadSite(tx as unknown as Db, opts.siteId);
      const round = tx
        .insert(rounds)
        .values({
          orgId: site.orgId,
          siteId: opts.siteId,
          roundType: opts.type,
          targetDateFrom: opts.dates[0]!,
          targetDateTo: opts.dates.at(-1)!,
          status: 'pending_review',
          seed,
          policyVersionId,
          runAt: opts.now,
          approvalDeadline: approvalDeadline(
            tx as unknown as Db,
            opts.siteId,
            opts.type,
            opts.dates,
            opts.now,
          ),
          createdAt: opts.now,
        })
        .returning()
        .get();
      // Context for the plain-language reasons (FR-15).
      const bayCode = new Map(input.bays.map((b) => [b.id, b.code]));
      const requestType = new Map(input.requests.map((r) => [r.id, r.bayType]));
      const ranked = new Map<string, number>();
      for (const d of result.decisions)
        if (d.rank) ranked.set(d.date, Math.max(ranked.get(d.date) ?? 0, d.rank));
      const cap = input.policy.rules.find((r) => r.key === 'peak_day_cap' && r.enabled);
      for (const d of result.decisions) {
        const reasonText = templateReason(d, {
          roundType: opts.type,
          requestedType: requestType.get(d.requestId)!,
          bayCode: d.bayId ? (bayCode.get(d.bayId) ?? null) : null,
          rankedCount: ranked.get(d.date) ?? 0,
          capMaxDays: cap ? Number(cap.config.maxDays) : null,
        });
        tx.insert(allocations)
          .values({
            roundId: round.id,
            requestId: d.requestId,
            bayId: d.bayId,
            outcome: d.outcome,
            rank: d.rank ?? 0,
            score: d.score ?? 0,
            scoreBreakdownJson: {
              date: d.date,
              reasonCode: d.reasonCode,
              tiebreak: d.tiebreak,
              factors: d.breakdown,
            },
            fallbackUsed: d.fallbackUsed,
            capReached: d.capReached,
            reasonText,
            createdAt: opts.now,
          })
          .run();
      }
      writeAudit(
        tx,
        {
          siteId: opts.siteId,
          actorId: null,
          action: 'round.run',
          entity: 'round',
          entityId: round.id,
          after: {
            type: opts.type,
            dates: opts.dates,
            seed,
            policyVersionId,
            dayOrder: result.dayOrder,
            confirmed: result.assignments.length,
            waitlisted: result.waitlist.length,
            heldBack: result.heldBack,
          },
        },
        opts.now,
      );
      if (opts.type === 'same_day') {
        publishInTx(tx, round, 'auto_same_day', null, opts.now);
        return { status: 'published', roundId: round.id, result } as const;
      }
      return { status: 'pending_review', roundId: round.id, result } as const;
    },
    { behavior: 'immediate' },
  );
}

/** Publish a pending round. `actorId` is the approving admin, or null for automatic modes. */
export function publishRound(
  db: Db,
  roundId: string,
  mode: PublishMode,
  actorId: string | null,
  now: Date,
  reason?: string,
): void {
  db.transaction(
    (tx) => {
      const round = tx.select().from(rounds).where(eq(rounds.id, roundId)).get();
      if (!round) throw notFound('Round');
      if (round.status !== 'pending_review') throw conflict('This round is not awaiting review.');
      publishInTx(tx, round, mode, actorId, now, reason);
    },
    { behavior: 'immediate' },
  );
}

function publishInTx(
  tx: Tx,
  round: RoundRow,
  mode: PublishMode,
  actorId: string | null,
  now: Date,
  reason?: string,
): void {
  const site = loadSite(tx as unknown as Db, round.siteId);
  const rows = tx
    .select({ allocation: allocations, request: requests })
    .from(allocations)
    .innerJoin(requests, eq(requests.id, allocations.requestId))
    .where(eq(allocations.roundId, round.id))
    .all();
  // Requests withdrawn since the run are left alone (edits are locked while in review).
  const live = rows.filter(
    (r) => r.request.status === 'requested' || r.request.status === 'waitlisted',
  );

  // Recompute the waitlist for these requests from this round.
  const liveIds = live.map((r) => r.request.id);
  if (liveIds.length) tx.delete(waitlist).where(inArray(waitlist.requestId, liveIds)).run();

  const positions = new Map<string, number>();
  const ordered = [...live].sort(
    (a, b) =>
      Number(a.allocation.capReached) - Number(b.allocation.capReached) ||
      a.allocation.rank - b.allocation.rank,
  );
  const counts = { confirmed: 0, offered: 0, waitlisted: 0, ineligible: 0 };
  for (const { allocation: a, request: r } of ordered) {
    if (a.outcome === 'ineligible') {
      tx.update(requests).set({ status: 'expired' }).where(eq(requests.id, r.id)).run();
      counts.ineligible++;
    } else if (a.outcome === 'confirmed' && round.roundType !== 'same_day') {
      tx.insert(bookings)
        .values({
          orgId: r.orgId,
          siteId: r.siteId,
          userId: r.userId,
          bayId: a.bayId!,
          date: r.date,
          status: 'confirmed',
          allocationId: a.id,
          createdAt: now,
        })
        .run(); // UNIQUE(bay_id, date) on held bookings guards against over-booking.
      tx.update(requests).set({ status: 'allocated' }).where(eq(requests.id, r.id)).run();
      counts.confirmed++;
    } else if (a.outcome === 'confirmed') {
      // Same-day: an offer to accept within the site's window (FR-20).
      tx.insert(offers)
        .values({
          requestId: r.id,
          bayId: a.bayId!,
          expiresAt: new Date(now.getTime() + site.settings.offerWindowMinutes * 60_000),
          status: 'open',
          createdAt: now,
        })
        .run();
      tx.update(requests).set({ status: 'waitlisted' }).where(eq(requests.id, r.id)).run();
      counts.offered++;
    } else {
      const key = `${r.date}|${r.bayType}`;
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);
      tx.insert(waitlist)
        .values({
          siteId: r.siteId,
          date: r.date,
          bayType: r.bayType,
          requestId: r.id,
          position,
          capReached: a.capReached,
          createdAt: now,
        })
        .run();
      tx.update(requests).set({ status: 'waitlisted' }).where(eq(requests.id, r.id)).run();
      counts.waitlisted++;
    }
  }
  tx.update(rounds)
    .set({
      status: 'published',
      publishMode: mode,
      publishedAt: now,
      approvedBy: actorId,
      approvedAt: actorId ? now : null,
    })
    .where(eq(rounds.id, round.id))
    .run();
  writeAudit(
    tx,
    {
      siteId: round.siteId,
      actorId,
      action: 'round.publish',
      entity: 'round',
      entityId: round.id,
      after: { mode, ...counts },
      reason: reason ?? (mode === 'admin' ? null : AUTO_REASONS[mode]),
    },
    now,
  );
}
