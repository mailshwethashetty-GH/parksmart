/**
 * Employee profile, consent and data rights (DPDP Act 2023; docs/05 privacy).
 * - Optional fields score neutral when empty; the plate is asked only if the gate needs it.
 * - Consent to "parking_allocation" is needed before making requests.
 * - Export returns everything held about the person; deletion anonymises them (the
 *   append-only audit log keeps their id, never their name).
 */
import {
  and,
  approvals,
  bookings,
  checkins,
  consents,
  eq,
  gte,
  inArray,
  isNull,
  notifications,
  pushSubscriptions,
  recurringPatterns,
  requests,
  sessions,
  userProfiles,
  users,
  vehicles,
  type Db,
} from '@parksmart/db';
import {
  CONSENT_PURPOSES,
  CONSENT_TEXT,
  siteLocalDate,
  type ConsentPurpose,
  type DistanceBand,
  type ProfileResponse,
  type VehicleType,
} from '@parksmart/shared';
import { businessRule, forbidden, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { writeAudit } from './audit';
import { loadSite } from './site';

function activeConsent(db: Db, userId: string, purpose: ConsentPurpose) {
  return db
    .select()
    .from(consents)
    .where(
      and(eq(consents.userId, userId), eq(consents.purpose, purpose), isNull(consents.revokedAt)),
    )
    .get();
}

export function hasConsent(
  db: Db,
  userId: string,
  purpose: ConsentPurpose = 'parking_allocation',
): boolean {
  return !!activeConsent(db, userId, purpose);
}

export function assertConsent(db: Db, userId: string): void {
  if (!hasConsent(db, userId)) {
    throw businessRule(
      'CONSENT_REQUIRED',
      'Please agree to how ParkSmart uses your data before requesting a bay.',
    );
  }
}

export function getProfile(db: Db, actor: Actor): ProfileResponse {
  const site = loadSite(db, actor.siteId);
  const profile = db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).get();
  return {
    distanceBand: profile?.distanceBand ?? null,
    requirePlate: site.settings.requireVehiclePlate,
    vehicles: db
      .select({ id: vehicles.id, type: vehicles.type, isEv: vehicles.isEv, plate: vehicles.plate })
      .from(vehicles)
      .where(eq(vehicles.userId, actor.id))
      .all(),
    consents: CONSENT_PURPOSES.map((purpose) => {
      const c = activeConsent(db, actor.id, purpose);
      return {
        purpose,
        granted: !!c,
        grantedAt: c?.grantedAt.toISOString() ?? null,
        ...CONSENT_TEXT[purpose],
      };
    }),
  };
}

export function updateProfile(
  db: Db,
  actor: Actor,
  input: { distanceBand: DistanceBand | null },
  now: Date,
) {
  db.insert(userProfiles)
    .values({ userId: actor.id, distanceBand: input.distanceBand, updatedAt: now })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { distanceBand: input.distanceBand, updatedAt: now },
    })
    .run();
  return getProfile(db, actor);
}

export function addVehicle(
  db: Db,
  actor: Actor,
  input: { type: VehicleType; isEv: boolean; plate?: string },
  now: Date,
) {
  const site = loadSite(db, actor.siteId);
  const plate = input.plate?.trim().toUpperCase() || null;
  if (site.settings.requireVehiclePlate && !plate) {
    throw businessRule('PLATE_REQUIRED', 'This site needs your vehicle number for the gate.');
  }
  if (!hasConsent(db, actor.id, 'vehicle_details')) {
    throw businessRule(
      'CONSENT_REQUIRED',
      'Agree to storing vehicle details first (Profile → Consent).',
    );
  }
  db.insert(vehicles)
    .values({
      userId: actor.id,
      type: input.type,
      isEv: input.type === 'car' && input.isEv,
      plate,
      createdAt: now,
    })
    .run();
  return getProfile(db, actor);
}

export function removeVehicle(db: Db, actor: Actor, vehicleId: string) {
  const v = db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).get();
  if (!v || v.userId !== actor.id) throw notFound('Vehicle');
  db.delete(vehicles).where(eq(vehicles.id, vehicleId)).run();
  return getProfile(db, actor);
}

export function setConsent(
  db: Db,
  actor: Actor,
  purpose: ConsentPurpose,
  granted: boolean,
  now: Date,
) {
  const current = activeConsent(db, actor.id, purpose);
  db.transaction((tx) => {
    if (granted && !current) {
      tx.insert(consents).values({ userId: actor.id, purpose, grantedAt: now }).run();
    } else if (!granted && current) {
      tx.update(consents).set({ revokedAt: now }).where(eq(consents.id, current.id)).run();
      // Withdrawing consent to vehicle details removes them.
      if (purpose === 'vehicle_details')
        tx.delete(vehicles).where(eq(vehicles.userId, actor.id)).run();
    } else return;
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: granted ? 'consent.grant' : 'consent.revoke',
        entity: 'consent',
        entityId: purpose,
      },
      now,
    );
  });
  return getProfile(db, actor);
}

/** Everything held about the person (DPDP right to access). */
export function exportMyData(db: Db, actor: Actor) {
  const me = db.select().from(users).where(eq(users.id, actor.id)).get()!;
  const myBookings = db.select().from(bookings).where(eq(bookings.userId, actor.id)).all();
  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: me.id,
      name: me.name,
      email: me.email,
      role: me.role,
      createdAt: me.createdAt.toISOString(),
    },
    profile: db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).get() ?? null,
    vehicles: db.select().from(vehicles).where(eq(vehicles.userId, actor.id)).all(),
    approvals: db
      .select({
        kind: approvals.kind,
        expiresAt: approvals.expiresAt,
        revokedAt: approvals.revokedAt,
      })
      .from(approvals)
      .where(eq(approvals.userId, actor.id))
      .all(),
    consents: db.select().from(consents).where(eq(consents.userId, actor.id)).all(),
    recurringPatterns: db
      .select()
      .from(recurringPatterns)
      .where(eq(recurringPatterns.userId, actor.id))
      .all(),
    requests: db.select().from(requests).where(eq(requests.userId, actor.id)).all(),
    bookings: myBookings,
    checkins: myBookings.length
      ? db
          .select()
          .from(checkins)
          .where(
            inArray(
              checkins.bookingId,
              myBookings.map((b) => b.id),
            ),
          )
          .all()
      : [],
    notifications: db.select().from(notifications).where(eq(notifications.userId, actor.id)).all(),
  };
}

/**
 * Delete my account (DPDP right to erasure). Future bookings are cancelled and open
 * requests withdrawn, personal data removed, and the user row anonymised so history
 * and the append-only audit log stay consistent. Admins can't delete themselves here.
 */
export function deleteMyAccount(db: Db, actor: Actor, now: Date): void {
  if (actor.role !== 'employee')
    throw forbidden('Admin and security accounts are removed by an administrator.');
  const site = loadSite(db, actor.siteId);
  const today = siteLocalDate(now, site.timezone);
  db.transaction((tx) => {
    tx.update(bookings)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(bookings.userId, actor.id),
          gte(bookings.date, today),
          eq(bookings.status, 'confirmed'),
        ),
      )
      .run();
    tx.update(requests)
      .set({ status: 'withdrawn' })
      .where(
        and(
          eq(requests.userId, actor.id),
          inArray(requests.status, ['requested', 'waitlisted', 'allocated']),
        ),
      )
      .run();
    tx.update(recurringPatterns)
      .set({ active: false })
      .where(eq(recurringPatterns.userId, actor.id))
      .run();
    tx.delete(vehicles).where(eq(vehicles.userId, actor.id)).run();
    tx.delete(userProfiles).where(eq(userProfiles.userId, actor.id)).run();
    tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.id)).run();
    tx.delete(notifications).where(eq(notifications.userId, actor.id)).run();
    tx.update(approvals)
      .set({ revokedAt: now })
      .where(and(eq(approvals.userId, actor.id), isNull(approvals.revokedAt)))
      .run();
    tx.update(consents)
      .set({ revokedAt: now })
      .where(and(eq(consents.userId, actor.id), isNull(consents.revokedAt)))
      .run();
    tx.update(users)
      .set({
        name: 'Deleted user',
        email: `deleted+${actor.id}@deleted.invalid`,
        image: null,
        active: false,
      })
      .where(eq(users.id, actor.id))
      .run();
    tx.delete(sessions).where(eq(sessions.userId, actor.id)).run();
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'user.delete',
        entity: 'user',
        entityId: actor.id,
        reason: "Deleted at the user's request (DPDP)",
      },
      now,
    );
  });
}
