/**
 * What happens after the job tick: tell affected employees (live updates, FR-20) and
 * have the AI rewrite reasons for rounds that just ran (FR-15). Runs outside the round
 * transactions so a slow AI call never holds the database.
 */
import { allocations, type Db, eq, offers, requests } from '@parksmart/db';
import type { FastifyInstance } from 'fastify';
import { rewriteRoundReasons } from '../ai/reasons';
import type { JobEvent } from './round-jobs';

export function usersInRound(db: Db, roundId: string): string[] {
  return db
    .select({ userId: requests.userId })
    .from(allocations)
    .innerJoin(requests, eq(requests.id, allocations.requestId))
    .where(eq(allocations.roundId, roundId))
    .all()
    .map((r) => r.userId);
}

export function userOfOffer(db: Db, offerId: string): string | undefined {
  return db
    .select({ userId: requests.userId })
    .from(offers)
    .innerJoin(requests, eq(requests.id, offers.requestId))
    .where(eq(offers.id, offerId))
    .get()?.userId;
}

export function roundIdsOf(events: JobEvent[]): string[] {
  return events
    .map((e) => (e.detail as { roundId?: string } | null)?.roundId)
    .filter((id): id is string => !!id);
}

export function afterJobs(app: FastifyInstance, events: JobEvent[]): void {
  const users: string[] = [];
  for (const roundId of roundIdsOf(events)) users.push(...usersInRound(app.db, roundId));
  for (const e of events.filter((x) => x.job === 'offer-expiry')) {
    const user = userOfOffer(app.db, (e.detail as { offerId: string }).offerId);
    if (user) users.push(user);
  }
  app.events.notifyUsers(users);

  // Only newly run rounds (not auto-published older ones) need reasons rewritten.
  const ran = events.filter((e) => e.job !== 'round-deadlines' && e.job !== 'offer-expiry');
  for (const roundId of roundIdsOf(ran)) {
    void rewriteRoundReasons(app.db, app.ai, roundId)
      .then((summary) => {
        if (summary.status === 'done') app.log.info({ roundId, ...summary }, 'reasons rewritten');
        // Rewritten reasons are new information for employees too.
        if (summary.status === 'done' && summary.rewritten > 0) {
          app.events.notifyUsers(usersInRound(app.db, roundId));
        }
      })
      .catch((err) => app.log.error({ err, roundId }, 'reason rewrite failed'));
  }
}
