/**
 * Stage 1 review (FR-16): see every decision with its score breakdown, approve the
 * round, or override single decisions with a reason. Overrides are only possible while
 * the round awaits review, and can never over-book (non-negotiable #1).
 */
import {
  allocations,
  and,
  bayBlocks,
  bays,
  bookings,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  overrides,
  policyVersions,
  requests,
  rounds,
  users,
  type Db,
} from '@parksmart/db';
import {
  BAY_HOLDING_BOOKING_STATUSES,
  type FactorScoreLike,
  type OverrideInput,
  type RoundDetail,
} from '@parksmart/shared';
import { businessRule, conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { assertInSite } from './_scope';
import { writeAudit } from './audit';
import { listRounds } from './collation';
import { overrideReason } from './reasons';
import { publishRound } from './rounds';

type Breakdown = { date: string; reasonCode: string; factors?: FactorScoreLike[] };

function roundInSite(db: Db, actor: Actor, roundId: string) {
  return assertInSite(
    db.select().from(rounds).where(eq(rounds.id, roundId)).get(),
    actor.siteId,
    'Round',
  );
}

/** Active bays not blocked, held, or already confirmed in this round, per date. */
function freeBays(db: Db, round: typeof rounds.$inferSelect, dates: string[]) {
  const all = db
    .select()
    .from(bays)
    .where(and(eq(bays.siteId, round.siteId), eq(bays.active, true)))
    .all();
  const blocks = db
    .select()
    .from(bayBlocks)
    .where(
      and(
        eq(bayBlocks.siteId, round.siteId),
        isNull(bayBlocks.deletedAt),
        lte(bayBlocks.dateFrom, round.targetDateTo),
        gte(bayBlocks.dateTo, round.targetDateFrom),
      ),
    )
    .all();
  const held = db
    .select({ bayId: bookings.bayId, date: bookings.date })
    .from(bookings)
    .where(
      and(
        eq(bookings.siteId, round.siteId),
        inArray(bookings.date, dates),
        inArray(bookings.status, [...BAY_HOLDING_BOOKING_STATUSES]),
      ),
    )
    .all();
  const assigned = db
    .select({ bayId: allocations.bayId, breakdown: allocations.scoreBreakdownJson })
    .from(allocations)
    .where(and(eq(allocations.roundId, round.id), eq(allocations.outcome, 'confirmed')))
    .all()
    .map((a) => ({ bayId: a.bayId, date: (a.breakdown as Breakdown).date }));
  return dates.map((date) => {
    const taken = new Set(
      [...held, ...assigned].filter((x) => x.date === date).map((x) => x.bayId),
    );
    return {
      date,
      bays: all
        .filter(
          (b) =>
            !taken.has(b.id) &&
            !blocks.some(
              (x) =>
                x.dateFrom <= date &&
                x.dateTo >= date &&
                (x.bayId === b.id || x.zoneId === b.zoneId),
            ),
        )
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((b) => ({ id: b.id, code: b.code, bayType: b.bayType })),
    };
  });
}

export function getRoundDetail(db: Db, actor: Actor, roundId: string, now: Date): RoundDetail {
  const round = roundInSite(db, actor, roundId);
  const summary = listRounds(db, actor.siteId, now, undefined, 500).find((r) => r.id === roundId)!;
  const rows = db
    .select({
      allocation: allocations,
      request: requests,
      userName: users.name,
      bayCode: bays.code,
    })
    .from(allocations)
    .innerJoin(requests, eq(requests.id, allocations.requestId))
    .innerJoin(users, eq(users.id, requests.userId))
    .leftJoin(bays, eq(bays.id, allocations.bayId))
    .where(eq(allocations.roundId, roundId))
    .all();
  const overridden = new Set(
    rows.length
      ? db
          .select({ id: overrides.allocationId })
          .from(overrides)
          .where(
            inArray(
              overrides.allocationId,
              rows.map((r) => r.allocation.id),
            ),
          )
          .all()
          .map((o) => o.id)
      : [],
  );
  const version = db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.id, round.policyVersionId))
    .get()!;
  const decisions = rows
    .map(({ allocation: a, request: r, userName, bayCode }) => {
      const b = a.scoreBreakdownJson as Breakdown;
      return {
        allocationId: a.id,
        requestId: r.id,
        date: b.date,
        employee: { id: r.userId, name: userName },
        requestedBayType: r.bayType,
        arrivalWindow: r.arrivalWindow,
        reasonCategory: r.reasonCategory,
        outcome: a.outcome,
        bayId: a.bayId,
        bayCode: bayCode ?? null,
        rank: a.rank,
        score: a.score,
        factors: b.factors ?? [],
        reasonCode: b.reasonCode,
        reasonText: a.reasonText,
        fallbackUsed: a.fallbackUsed,
        capReached: a.capReached,
        overridden: overridden.has(a.id),
      };
    })
    .sort((x, y) => x.date.localeCompare(y.date) || (x.rank || 1e9) - (y.rank || 1e9));
  const dates = [...new Set(decisions.map((d) => d.date))].sort();
  return {
    ...summary,
    seed: round.seed,
    policyVersion: version.version,
    decisions,
    freeBays: round.status === 'pending_review' ? freeBays(db, round, dates) : [],
  };
}

/** Approve and publish (FR-16). Returns the employees affected, for live updates. */
export function approveRound(
  db: Db,
  actor: Actor,
  roundId: string,
  now: Date,
  note?: string,
): string[] {
  const round = roundInSite(db, actor, roundId);
  if (round.status !== 'pending_review') throw conflict('This round is not awaiting review.');
  publishRound(db, roundId, 'admin', actor.id, now, note ?? 'Approved by admin');
  return db
    .select({ userId: requests.userId })
    .from(allocations)
    .innerJoin(requests, eq(requests.id, allocations.requestId))
    .where(eq(allocations.roundId, roundId))
    .all()
    .map((r) => r.userId);
}

export function overrideAllocation(
  db: Db,
  actor: Actor,
  allocationId: string,
  input: OverrideInput,
  now: Date,
): void {
  db.transaction(
    (tx) => {
      const tdb = tx as unknown as Db;
      const a = tx.select().from(allocations).where(eq(allocations.id, allocationId)).get();
      if (!a) throw notFound('Decision');
      const round = roundInSite(tdb, actor, a.roundId);
      if (round.status !== 'pending_review') {
        throw conflict('Only decisions in a round awaiting review can be overridden.');
      }
      const date = (a.scoreBreakdownJson as Breakdown).date;
      const before = { outcome: a.outcome, bayId: a.bayId };
      let after: { outcome: 'confirmed' | 'waitlisted'; bayId: string | null };
      let bayCode: string | null = null;

      if (input.action === 'assign') {
        if (a.outcome === 'confirmed' && a.bayId === input.bayId)
          throw conflict('That bay is already assigned.');
        const free = freeBays(tdb, round, [date])[0]!.bays.find((b) => b.id === input.bayId);
        // Never over-book: the bay must be free that day (also enforced by the DB at publish).
        if (!free) throw businessRule('BAY_NOT_FREE', 'That bay is not free on that day.');
        bayCode = free.code;
        after = { outcome: 'confirmed', bayId: input.bayId };
      } else {
        if (a.outcome !== 'confirmed')
          throw conflict('Only a confirmed decision can be moved to the waitlist.');
        after = { outcome: 'waitlisted', bayId: null };
      }

      tx.update(allocations)
        .set({ ...after, reasonText: overrideReason(input.action, date, bayCode) })
        .where(eq(allocations.id, allocationId))
        .run();
      tx.insert(overrides)
        .values({
          allocationId,
          adminId: actor.id,
          beforeJson: before,
          afterJson: after,
          reason: input.reason,
          createdAt: now,
        })
        .run();
      writeAudit(
        tx,
        {
          siteId: actor.siteId,
          actorId: actor.id,
          action: 'allocation.override',
          entity: 'allocation',
          entityId: allocationId,
          before,
          after,
          reason: input.reason,
        },
        now,
      );
    },
    { behavior: 'immediate' },
  );
}
