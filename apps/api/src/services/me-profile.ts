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

async function activeConsent(db: Db, userId: string, purpose: ConsentPurpose) {
  return await db
    .select()
    .from(consents)
    .where(
      and(eq(consents.userId, userId), eq(consents.purpose, purpose), isNull(consents.revokedAt)),
    )
    .get();
}

export async function hasConsent(
  db: Db,
  userId: string,
  purpose: ConsentPurpose = 'parking_allocation',
): Promise<boolean> {
  return !!(await activeConsent(db, userId, purpose));
}

export async function assertConsent(db: Db, userId: string): Promise<void> {
  if (!(await hasConsent(db, userId))) {
    throw businessRule(
      'CONSENT_REQUIRED',
      'Please agree to how ParkSmart uses your data before requesting a bay.',
    );
  }
}

export async function getProfile(db: Db, actor: Actor): Promise<ProfileResponse> {
  const site = await loadSite(db, actor.siteId);
  const profile = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, actor.id))
    .get();
  const consents = [];
  for (const purpose of CONSENT_PURPOSES) {
    const c = await activeConsent(db, actor.id, purpose);
    consents.push({
      purpose,
      granted: !!c,
      grantedAt: c?.grantedAt.toISOString() ?? null,
      ...CONSENT_TEXT[purpose],
    });
  }
  return {
    distanceBand: profile?.distanceBand ?? null,
    requirePlate: site.settings.requireVehiclePlate,
    vehicles: await db
      .select({ id: vehicles.id, type: vehicles.type, isEv: vehicles.isEv, plate: vehicles.plate })
      .from(vehicles)
      .where(eq(vehicles.userId, actor.id))
      .all(),
    consents,
  };
}

export async function updateProfile(
  db: Db,
  actor: Actor,
  input: { distanceBand: DistanceBand | null },
  now: Date,
) {
  await db
    .insert(userProfiles)
    .values({ userId: actor.id, distanceBand: input.distanceBand, updatedAt: now })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { distanceBand: input.distanceBand, updatedAt: now },
    })
    .run();
  return await getProfile(db, actor);
}

export async function addVehicle(
  db: Db,
  actor: Actor,
  input: { type: VehicleType; isEv: boolean; plate?: string },
  now: Date,
) {
  const site = await loadSite(db, actor.siteId);
  const plate = input.plate?.trim().toUpperCase() || null;
  if (site.settings.requireVehiclePlate && !plate) {
    throw businessRule('PLATE_REQUIRED', 'This site needs your vehicle number for the gate.');
  }
  if (!(await hasConsent(db, actor.id, 'vehicle_details'))) {
    throw businessRule(
      'CONSENT_REQUIRED',
      'Agree to storing vehicle details first (Profile → Consent).',
    );
  }
  await db
    .insert(vehicles)
    .values({
      userId: actor.id,
      type: input.type,
      isEv: input.type === 'car' && input.isEv,
      plate,
      createdAt: now,
    })
    .run();
  return await getProfile(db, actor);
}

export async function removeVehicle(db: Db, actor: Actor, vehicleId: string) {
  const v = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).get();
  if (!v || v.userId !== actor.id) throw notFound('Vehicle');
  await db.delete(vehicles).where(eq(vehicles.id, vehicleId)).run();
  return await getProfile(db, actor);
}

export async function setConsent(
  db: Db,
  actor: Actor,
  purpose: ConsentPurpose,
  granted: boolean,
  now: Date,
) {
  const current = await activeConsent(db, actor.id, purpose);
  await db.transaction(async (tx) => {
    if (granted && !current) {
      await tx.insert(consents).values({ userId: actor.id, purpose, grantedAt: now }).run();
    } else if (!granted && current) {
      await tx.update(consents).set({ revokedAt: now }).where(eq(consents.id, current.id)).run();
      // Withdrawing consent to vehicle details removes them.
      if (purpose === 'vehicle_details')
        await tx.delete(vehicles).where(eq(vehicles.userId, actor.id)).run();
    } else return;
    await writeAudit(
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
  return await getProfile(db, actor);
}

/** Everything held about the person (DPDP right to access). */
export async function exportMyData(db: Db, actor: Actor) {
  const me = (await db.select().from(users).where(eq(users.id, actor.id)).get())!;
  const myBookings = await db.select().from(bookings).where(eq(bookings.userId, actor.id)).all();
  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: me.id,
      name: me.name,
      email: me.email,
      role: me.role,
      createdAt: me.createdAt.toISOString(),
    },
    profile:
      (await db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).get()) ?? null,
    vehicles: await db.select().from(vehicles).where(eq(vehicles.userId, actor.id)).all(),
    approvals: await db
      .select({
        kind: approvals.kind,
        expiresAt: approvals.expiresAt,
        revokedAt: approvals.revokedAt,
      })
      .from(approvals)
      .where(eq(approvals.userId, actor.id))
      .all(),
    consents: await db.select().from(consents).where(eq(consents.userId, actor.id)).all(),
    recurringPatterns: await db
      .select()
      .from(recurringPatterns)
      .where(eq(recurringPatterns.userId, actor.id))
      .all(),
    requests: await db.select().from(requests).where(eq(requests.userId, actor.id)).all(),
    bookings: myBookings,
    checkins: myBookings.length
      ? await db
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
    notifications: await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.id))
      .all(),
  };
}

/**
 * Delete my account (DPDP right to erasure). Future bookings are cancelled and open
 * requests withdrawn, personal data removed, and the user row anonymised so history
 * and the append-only audit log stay consistent. Admins can't delete themselves here.
 */
export async function deleteMyAccount(db: Db, actor: Actor, now: Date): Promise<void> {
  if (actor.role !== 'employee')
    throw forbidden('Admin and security accounts are removed by an administrator.');
  const site = await loadSite(db, actor.siteId);
  const today = siteLocalDate(now, site.timezone);
  await db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(bookings.userId, actor.id),
          gte(bookings.date, today),
          eq(bookings.status, 'confirmed'),
        ),
      )
      .run();
    await tx
      .update(requests)
      .set({ status: 'withdrawn' })
      .where(
        and(
          eq(requests.userId, actor.id),
          inArray(requests.status, ['requested', 'waitlisted', 'allocated']),
        ),
      )
      .run();
    await tx
      .update(recurringPatterns)
      .set({ active: false })
      .where(eq(recurringPatterns.userId, actor.id))
      .run();
    await tx.delete(vehicles).where(eq(vehicles.userId, actor.id)).run();
    await tx.delete(userProfiles).where(eq(userProfiles.userId, actor.id)).run();
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.id)).run();
    await tx.delete(notifications).where(eq(notifications.userId, actor.id)).run();
    await tx
      .update(approvals)
      .set({ revokedAt: now })
      .where(and(eq(approvals.userId, actor.id), isNull(approvals.revokedAt)))
      .run();
    await tx
      .update(consents)
      .set({ revokedAt: now })
      .where(and(eq(consents.userId, actor.id), isNull(consents.revokedAt)))
      .run();
    await tx
      .update(users)
      .set({
        name: 'Deleted user',
        email: `deleted+${actor.id}@deleted.invalid`,
        image: null,
        active: false,
      })
      .where(eq(users.id, actor.id))
      .run();
    await tx.delete(sessions).where(eq(sessions.userId, actor.id)).run();
    await writeAudit(
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
