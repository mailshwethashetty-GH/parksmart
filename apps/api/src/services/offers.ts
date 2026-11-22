/**
 * Same-day offers (FR-20, P0 part): accept within the window to get the bay; decline or
 * let it expire and the bay goes to the next person (a fresh same-day round for that day).
 * Offers reference the request; waitlist rows are just the current queue.
 */
import { and, bookings, type Db, eq, lte, offers, requests, waitlist } from '@parksmart/db';
import { conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { writeAudit } from './audit';

async function ownOffer(db: Db, actor: Actor, offerId: string) {
  const row = await db
    .select({ offer: offers, request: requests })
    .from(offers)
    .innerJoin(requests, eq(requests.id, offers.requestId))
    .where(eq(offers.id, offerId))
    .get();
  // Someone else's offer is reported as not found.
  if (!row || row.request.userId !== actor.id) throw notFound('Offer');
  return row;
}

export async function acceptOffer(
  db: Db,
  actor: Actor,
  offerId: string,
  now: Date,
): Promise<{ bookingId: string }> {
  return await db.transaction(
    async (tx) => {
      const { offer, request } = await ownOffer(tx as unknown as Db, actor, offerId);
      if (offer.status !== 'open') throw conflict('This offer is no longer open.');
      if (offer.expiresAt.getTime() <= now.getTime()) throw conflict('This offer has expired.');
      const booking = await tx
        .insert(bookings)
        .values({
          orgId: request.orgId,
          siteId: request.siteId,
          userId: request.userId,
          bayId: offer.bayId,
          date: request.date,
          status: 'confirmed',
          createdAt: now,
        })
        .returning({ id: bookings.id })
        .get(); // UNIQUE(bay_id, date) on held bookings guards against over-booking.
      await tx.update(offers).set({ status: 'accepted' }).where(eq(offers.id, offer.id)).run();
      await tx
        .update(requests)
        .set({ status: 'allocated' })
        .where(eq(requests.id, request.id))
        .run();
      await tx.delete(waitlist).where(eq(waitlist.requestId, request.id)).run();
      await writeAudit(
        tx,
        {
          siteId: request.siteId,
          actorId: actor.id,
          action: 'offer.accept',
          entity: 'offer',
          entityId: offer.id,
          after: { bookingId: booking.id, bayId: offer.bayId, date: request.date },
        },
        now,
      );
      return { bookingId: booking.id };
    },
    { behavior: 'immediate' },
  );
}

/** Decline: the request is withdrawn. Returns the site and date so the caller can re-offer. */
export async function declineOffer(db: Db, actor: Actor, offerId: string, now: Date) {
  return await db.transaction(async (tx) => {
    const { offer, request } = await ownOffer(tx as unknown as Db, actor, offerId);
    if (offer.status !== 'open') throw conflict('This offer is no longer open.');
    await tx.update(offers).set({ status: 'declined' }).where(eq(offers.id, offer.id)).run();
    await tx.update(requests).set({ status: 'withdrawn' }).where(eq(requests.id, request.id)).run();
    await tx.delete(waitlist).where(eq(waitlist.requestId, request.id)).run();
    await writeAudit(
      tx,
      {
        siteId: request.siteId,
        actorId: actor.id,
        action: 'offer.decline',
        entity: 'offer',
        entityId: offer.id,
      },
      now,
    );
    return { siteId: request.siteId, date: request.date };
  });
}

/**
 * Expire open offers past their window. The request expires too (the person has had
 * their turn; they can request again). Returns what freed a bay, for re-offering.
 */
export async function expireOffers(
  db: Db,
  now: Date,
): Promise<{ siteId: string; date: string; offerId: string }[]> {
  return await db.transaction(async (tx) => {
    const due = await tx
      .select({ offer: offers, request: requests })
      .from(offers)
      .innerJoin(requests, eq(requests.id, offers.requestId))
      .where(and(eq(offers.status, 'open'), lte(offers.expiresAt, now)))
      .all();
    for (const { offer, request } of due) {
      await tx.update(offers).set({ status: 'expired' }).where(eq(offers.id, offer.id)).run();
      await tx.update(requests).set({ status: 'expired' }).where(eq(requests.id, request.id)).run();
      await tx.delete(waitlist).where(eq(waitlist.requestId, request.id)).run();
      await writeAudit(
        tx,
        {
          siteId: request.siteId,
          actorId: null,
          action: 'offer.expire',
          entity: 'offer',
          entityId: offer.id,
          after: { bayId: offer.bayId, date: request.date },
        },
        now,
      );
    }
    return due.map(({ offer, request }) => ({
      siteId: request.siteId,
      date: request.date,
      offerId: offer.id,
    }));
  });
}
