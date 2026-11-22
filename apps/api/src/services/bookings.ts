/**
 * Booking cancellation (FR-4). A cancelled confirmed bay is free at once: the next round
 * that covers the day picks it up (a same-day round straight away when it's today).
 * Every release is audited (non-negotiable #5).
 */
import { and, bookings, eq, requests, type Db } from '@parksmart/db';
import { conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { writeAudit } from './audit';

export function cancelBooking(
  db: Db,
  actor: Actor,
  bookingId: string,
  now: Date,
  reason?: string,
): { siteId: string; date: string } {
  return db.transaction(
    (tx) => {
      const booking = tx.select().from(bookings).where(eq(bookings.id, bookingId)).get();
      if (!booking || booking.userId !== actor.id) throw notFound('Booking');
      if (booking.status === 'checked_in')
        throw conflict('You have already checked in for this booking.');
      if (booking.status !== 'confirmed') throw conflict('This booking is no longer active.');
      tx.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, bookingId)).run();
      // The request that won it is finished too.
      tx.update(requests)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(requests.userId, actor.id),
            eq(requests.date, booking.date),
            eq(requests.status, 'allocated'),
          ),
        )
        .run();
      writeAudit(
        tx,
        {
          siteId: booking.siteId,
          actorId: actor.id,
          action: 'booking.cancel',
          entity: 'booking',
          entityId: booking.id,
          before: { status: booking.status, bayId: booking.bayId, date: booking.date },
          after: { status: 'cancelled' },
          reason: reason ?? 'Cancelled by employee',
        },
        now,
      );
      return { siteId: booking.siteId, date: booking.date };
    },
    { behavior: 'immediate' },
  );
}
