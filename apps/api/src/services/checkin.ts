/**
 * Check-in and auto-release (FR-21, FR-22).
 *
 * QR tokens are signed JWTs (jose, HS256, QR_SIGNING_SECRET):
 *  - booking token: valid only during the booking's site-local day (rotates daily, so a
 *    screenshot can't be reused another day); shown by the employee, scanned at the gate.
 *  - bay token: static, printed on a bay sticker; the employee scans it to check in.
 * Every check-in records time and method. Auto-release frees unclaimed bays after the
 * deadline and is audited (non-negotiable #5).
 */
import {
  and,
  bayBlocks,
  bays,
  bookings,
  checkins,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  requests,
  sites,
  users,
  zones,
  type Db,
} from '@parksmart/db';
import {
  addDays,
  BAY_HOLDING_BOOKING_STATUSES,
  checkInDeadline,
  siteLocalDate,
  siteLocalToUtc,
  weekStart,
  type ArrivalWindow,
  type CheckinMethod,
  type CheckinResult,
  type GateTodayResponse,
  type IsoDate,
} from '@parksmart/shared';
import { jwtVerify, SignJWT } from 'jose';
import { AppError, businessRule, conflict, forbidden, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { writeAudit } from './audit';
import { loadSite } from './site';

const ISSUER = 'parksmart';
type BookingRow = typeof bookings.$inferSelect;

const keyOf = (secret: string) => new TextEncoder().encode(secret);
const invalidToken = () =>
  new AppError(400, 'QR_INVALID', 'This QR code is not valid. Ask the employee to refresh it.');

/** The arrival window of the request that won this booking (one request per person per day). */
function arrivalWindowFor(db: Db, b: BookingRow): ArrivalWindow {
  return (
    db
      .select({ w: requests.arrivalWindow })
      .from(requests)
      .where(
        and(
          eq(requests.userId, b.userId),
          eq(requests.date, b.date),
          inArray(requests.status, ['allocated', 'expired']),
        ),
      )
      .get()?.w ?? 'before_9'
  );
}

export function deadlineFor(db: Db, b: BookingRow): Date {
  const site = loadSite(db, b.siteId);
  return checkInDeadline({
    date: b.date,
    arrivalWindow: arrivalWindowFor(db, b),
    bookedAt: b.createdAt,
    lateExtensionUsed: b.lateExtensionUsed,
    timeZone: site.timezone,
    settings: site.settings,
  });
}

function ownBooking(db: Db, actor: Actor, id: string): BookingRow {
  const b = db.select().from(bookings).where(eq(bookings.id, id)).get();
  if (!b || b.userId !== actor.id) throw notFound('Booking');
  return b;
}

// --- tokens ------------------------------------------------------------------------
export async function bookingQr(db: Db, actor: Actor, bookingId: string, secret: string) {
  const b = ownBooking(db, actor, bookingId);
  if (b.status !== 'confirmed' && b.status !== 'checked_in')
    throw conflict('This booking is no longer active.');
  const { timezone } = loadSite(db, b.siteId);
  const from = siteLocalToUtc(b.date, '00:00', timezone);
  const until = siteLocalToUtc(addDays(b.date, 1), '00:00', timezone);
  const token = await new SignJWT({ k: 'booking', b: b.id, s: b.siteId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setNotBefore(Math.floor(from.getTime() / 1000))
    .setExpirationTime(Math.floor(until.getTime() / 1000))
    .sign(keyOf(secret));
  return { token, date: b.date, expiresAt: until.toISOString() };
}

export async function bayQr(db: Db, actor: Actor, bayId: string, secret: string) {
  const bay = db.select().from(bays).where(eq(bays.id, bayId)).get();
  if (!bay) throw notFound('Bay');
  if (bay.siteId !== actor.siteId) throw forbidden('This bay belongs to another site.');
  const token = await new SignJWT({ k: 'bay', bay: bay.id, s: bay.siteId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .sign(keyOf(secret));
  return { token, bayCode: bay.code };
}

async function verify(token: string, secret: string, now: Date) {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      currentDate: now,
      algorithms: ['HS256'],
    });
    return payload as { k?: string; b?: string; bay?: string; s?: string };
  } catch {
    throw invalidToken();
  }
}

// --- check-in ------------------------------------------------------------------------
function markCheckedIn(
  db: Db,
  b: BookingRow,
  method: CheckinMethod,
  by: Actor,
  now: Date,
): CheckinResult {
  return db.transaction((tx) => {
    const current = tx.select().from(bookings).where(eq(bookings.id, b.id)).get()!;
    const already = current.status === 'checked_in';
    if (!already && current.status !== 'confirmed') {
      const why =
        current.status === 'auto_released'
          ? 'was released because nobody checked in in time'
          : `is ${current.status.replace('_', ' ')}`;
      throw conflict(`This booking ${why}.`, { status: current.status });
    }
    if (!already) {
      tx.update(bookings).set({ status: 'checked_in' }).where(eq(bookings.id, b.id)).run();
      tx.insert(checkins).values({ bookingId: b.id, method, at: now, byUserId: by.id }).run();
      writeAudit(
        tx,
        {
          siteId: b.siteId,
          actorId: by.id,
          action: 'booking.checkin',
          entity: 'booking',
          entityId: b.id,
          after: { method },
        },
        now,
      );
    }
    const info = tx
      .select({ bayCode: bays.code, zoneName: zones.name, employeeName: users.name })
      .from(bookings)
      .innerJoin(bays, eq(bays.id, bookings.bayId))
      .innerJoin(zones, eq(zones.id, bays.zoneId))
      .innerJoin(users, eq(users.id, bookings.userId))
      .where(eq(bookings.id, b.id))
      .get()!;
    const at =
      tx.select({ at: checkins.at }).from(checkins).where(eq(checkins.bookingId, b.id)).get()?.at ??
      now;
    return {
      alreadyCheckedIn: already,
      booking: { id: b.id, date: b.date, ...info, checkedInAt: at.toISOString() },
    };
  });
}

function assertToday(db: Db, b: BookingRow, now: Date) {
  if (b.date !== siteLocalDate(now, loadSite(db, b.siteId).timezone)) {
    throw businessRule('NOT_TODAY', 'This booking is not for today.');
  }
}

/** Security scans the employee's QR at the gate. */
export async function scanCheckin(db: Db, actor: Actor, token: string, secret: string, now: Date) {
  const payload = await verify(token, secret, now);
  if (payload.k !== 'booking' || !payload.b) throw invalidToken();
  if (payload.s !== actor.siteId) throw forbidden('This QR code is for another site.');
  const b = db.select().from(bookings).where(eq(bookings.id, payload.b)).get();
  if (!b) throw invalidToken();
  assertToday(db, b, now);
  return markCheckedIn(db, b, 'qr_employee', actor, now);
}

/** The employee scans the sticker on their bay. */
export async function bayCheckin(db: Db, actor: Actor, token: string, secret: string, now: Date) {
  const payload = await verify(token, secret, now);
  if (payload.k !== 'bay' || !payload.bay) throw invalidToken();
  if (payload.s !== actor.siteId) throw forbidden('This bay belongs to another site.');
  const today = siteLocalDate(now, loadSite(db, actor.siteId).timezone);
  const mine = db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.userId, actor.id),
        eq(bookings.date, today),
        inArray(bookings.status, [...BAY_HOLDING_BOOKING_STATUSES]),
      ),
    )
    .get();
  if (!mine) throw businessRule('NO_BOOKING_TODAY', 'You have no bay booked for today.');
  if (mine.bayId !== payload.bay) {
    const code = db
      .select({ code: bays.code })
      .from(bays)
      .where(eq(bays.id, mine.bayId))
      .get()?.code;
    throw businessRule('WRONG_BAY', `This isn't your bay. Your bay today is ${code}.`, {
      bayCode: code,
    });
  }
  return markCheckedIn(db, mine, 'qr_bay', actor, now);
}

/** Security checks someone in by hand (no phone, damaged QR, …). */
export function manualCheckin(db: Db, actor: Actor, bookingId: string, now: Date) {
  const b = db.select().from(bookings).where(eq(bookings.id, bookingId)).get();
  if (!b) throw notFound('Booking');
  if (b.siteId !== actor.siteId) throw forbidden('This booking belongs to another site.');
  assertToday(db, b, now);
  return markCheckedIn(db, b, 'manual_security', actor, now);
}

// --- running late ---------------------------------------------------------------------
export function runningLate(
  db: Db,
  actor: Actor,
  bookingId: string,
  now: Date,
): { checkInBy: string } {
  const b = ownBooking(db, actor, bookingId);
  if (b.status !== 'confirmed')
    throw conflict('Only a booking that is waiting for check-in can be extended.');
  assertToday(db, b, now);
  if (b.lateExtensionUsed) throw conflict('You have already extended this booking.');
  if (deadlineFor(db, b).getTime() <= now.getTime())
    throw conflict('The check-in time has already passed.');
  const site = loadSite(db, b.siteId);
  const week = weekStart(b.date);
  const used = db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.userId, actor.id),
        eq(bookings.lateExtensionUsed, true),
        gte(bookings.date, week),
        lt(bookings.date, addDays(week, 7)),
      ),
    )
    .all().length;
  if (used >= site.settings.lateExtensionsPerWeek) {
    throw businessRule(
      'LATE_LIMIT',
      `You can use "running late" ${site.settings.lateExtensionsPerWeek} time(s) a week.`,
    );
  }
  db.transaction((tx) => {
    tx.update(bookings).set({ lateExtensionUsed: true }).where(eq(bookings.id, b.id)).run();
    writeAudit(
      tx,
      {
        siteId: b.siteId,
        actorId: actor.id,
        action: 'booking.running_late',
        entity: 'booking',
        entityId: b.id,
      },
      now,
    );
  });
  return { checkInBy: deadlineFor(db, { ...b, lateExtensionUsed: true }).toISOString() };
}

// --- gate view ------------------------------------------------------------------------
export function gateToday(db: Db, siteId: string, now: Date): GateTodayResponse {
  const site = loadSite(db, siteId);
  const today = siteLocalDate(now, site.timezone);
  const rows = db
    .select({
      booking: bookings,
      employeeName: users.name,
      bayCode: bays.code,
      bayType: bays.bayType,
      zoneName: zones.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(bays, eq(bays.id, bookings.bayId))
    .innerJoin(zones, eq(zones.id, bays.zoneId))
    .where(and(eq(bookings.siteId, siteId), eq(bookings.date, today)))
    .all();
  const ins = rows.length
    ? db
        .select()
        .from(checkins)
        .where(
          inArray(
            checkins.bookingId,
            rows.map((r) => r.booking.id),
          ),
        )
        .all()
    : [];
  const blocked = db
    .select()
    .from(bayBlocks)
    .where(
      and(
        eq(bayBlocks.siteId, siteId),
        isNull(bayBlocks.deletedAt),
        lte(bayBlocks.dateFrom, today),
        gte(bayBlocks.dateTo, today),
      ),
    )
    .all();
  const allBays = db
    .select({
      id: bays.id,
      code: bays.code,
      bayType: bays.bayType,
      zoneId: bays.zoneId,
      zoneName: zones.name,
    })
    .from(bays)
    .innerJoin(zones, eq(zones.id, bays.zoneId))
    .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
    .all();
  const holding = rows.filter(
    (r) => r.booking.status === 'confirmed' || r.booking.status === 'checked_in',
  );
  return {
    date: today,
    bookings: rows
      .map(({ booking: b, ...rest }) => {
        const c = ins.find((x) => x.bookingId === b.id);
        return {
          id: b.id,
          ...rest,
          status: b.status,
          checkInBy: b.status === 'confirmed' ? deadlineFor(db, b).toISOString() : null,
          checkedInAt: c?.at.toISOString() ?? null,
          method: c?.method ?? null,
        };
      })
      .sort((a, b) => a.bayCode.localeCompare(b.bayCode)),
    bays: allBays
      .map((bay) => {
        const h = holding.find((r) => r.booking.bayId === bay.id);
        const isBlocked = blocked.some((x) => x.bayId === bay.id || x.zoneId === bay.zoneId);
        return {
          id: bay.id,
          code: bay.code,
          bayType: bay.bayType,
          zoneName: bay.zoneName,
          state: h
            ? h.booking.status === 'checked_in'
              ? 'checked_in'
              : 'booked'
            : isBlocked
              ? 'blocked'
              : 'free',
        } as const;
      })
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// --- auto-release (job) ---------------------------------------------------------------
export type Released = { siteId: string; date: IsoDate; bookingId: string; userId: string };

/**
 * Release confirmed bookings past their check-in deadline (FR-22), and close out
 * checked-in bookings from earlier days ("day ends"). Returns what was auto-released so
 * the caller can re-offer the bays and tell the employees.
 */
export function autoRelease(db: Db, now: Date): Released[] {
  const released: Released[] = [];
  for (const site of db.select().from(sites).all()) {
    const today = siteLocalDate(now, site.timezone);
    const due = db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.siteId, site.id),
          eq(bookings.status, 'confirmed'),
          lte(bookings.date, today),
        ),
      )
      .all()
      .filter((b) => deadlineFor(db, b).getTime() <= now.getTime());
    for (const b of due) {
      const deadline = deadlineFor(db, b);
      db.transaction((tx) => {
        tx.update(bookings)
          .set({ status: 'auto_released' })
          .where(and(eq(bookings.id, b.id), eq(bookings.status, 'confirmed')))
          .run();
        // The request is over; the employee can request again (a same-day bay, say).
        tx.update(requests)
          .set({ status: 'expired' })
          .where(
            and(
              eq(requests.userId, b.userId),
              eq(requests.date, b.date),
              eq(requests.status, 'allocated'),
            ),
          )
          .run();
        writeAudit(
          tx,
          {
            siteId: b.siteId,
            actorId: null,
            action: 'booking.auto_release',
            entity: 'booking',
            entityId: b.id,
            before: { status: 'confirmed', bayId: b.bayId },
            after: { status: 'auto_released' },
            reason: `No check-in by ${deadline.toISOString()} (grace window)`,
          },
          now,
        );
      });
      released.push({ siteId: b.siteId, date: b.date, bookingId: b.id, userId: b.userId });
    }
    // Day ends: checked-in bookings from earlier days are released (audited, like every release).
    const ended = db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.siteId, site.id),
          eq(bookings.status, 'checked_in'),
          lt(bookings.date, today),
        ),
      )
      .all();
    for (const b of ended) {
      db.transaction((tx) => {
        tx.update(bookings).set({ status: 'released' }).where(eq(bookings.id, b.id)).run();
        writeAudit(
          tx,
          {
            siteId: b.siteId,
            actorId: null,
            action: 'booking.release',
            entity: 'booking',
            entityId: b.id,
            reason: 'Day ended',
          },
          now,
        );
      });
    }
  }
  return released;
}
