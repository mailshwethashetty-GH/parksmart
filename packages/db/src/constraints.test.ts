import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client';
import * as s from './schema';
import { seed } from './seed';
import { createTestDb } from './testing';

/** Drizzle wraps driver errors ("Failed query: …"); assert on SQLite's own message. */
const rootCause = (p: Promise<unknown>) =>
  p.catch((err: unknown) => {
    throw (err as { cause?: unknown }).cause ?? err;
  });

let db: Db;
let ids: { orgId: string; siteId: string };

beforeEach(async () => {
  db = await createTestDb();
  ids = await seed(db, new Date('2026-11-22T04:00:00Z'));
});

const firstBay = async () => (await db.select().from(s.bays).limit(1).get())!;
const employees = async () =>
  await db.select().from(s.users).where(eq(s.users.role, 'employee')).all();

function booking(userId: string, bayId: string, status: s.BookingInsert['status'] = 'confirmed') {
  return { orgId: ids.orgId, siteId: ids.siteId, userId, bayId, date: '2026-11-24', status };
}

describe('seed', () => {
  it('creates 150 car-park bays incl. 10 EV and 5 accessible', async () => {
    const bays = await db.select().from(s.bays).all();
    expect(bays).toHaveLength(150);
    expect(bays.filter((b) => b.bayType === 'ev')).toHaveLength(10);
    expect(bays.filter((b) => b.bayType === 'accessible')).toHaveLength(5);
  });

  it('publishes policy v1 with weights totalling 100', async () => {
    const rules = await db.select().from(s.rules).where(eq(s.rules.ruleType, 'weighted')).all();
    expect(rules.reduce((sum, r) => sum + (r.weight ?? 0), 0)).toBe(100);
    const version = (await db.select().from(s.policyVersions).get())!;
    expect(version.effectiveFromWeek).toBe('2026-11-16');
  });
});

describe('never over-book (non-negotiable #1)', () => {
  it('rejects a second bay-holding booking for the same bay and date', async () => {
    const [a, b] = await employees();
    const bay = await firstBay();
    await db.insert(s.bookings).values(booking(a!.id, bay.id)).run();
    await expect(
      rootCause(db.insert(s.bookings).values(booking(b!.id, bay.id)).run()),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('allows rebooking a bay once the earlier booking is released', async () => {
    const [a, b] = await employees();
    const bay = await firstBay();
    await db.insert(s.bookings).values(booking(a!.id, bay.id)).run();
    await db
      .update(s.bookings)
      .set({ status: 'auto_released' })
      .where(and(eq(s.bookings.bayId, bay.id), eq(s.bookings.userId, a!.id)))
      .run();
    await expect(db.insert(s.bookings).values(booking(b!.id, bay.id)).run()).resolves.not.toThrow();
  });

  it('an employee holds at most one bay per day', async () => {
    const [a] = await employees();
    const [bay1, bay2] = await db.select().from(s.bays).limit(2).all();
    await db.insert(s.bookings).values(booking(a!.id, bay1!.id)).run();
    await expect(
      rootCause(db.insert(s.bookings).values(booking(a!.id, bay2!.id)).run()),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe('one active request per employee per day', () => {
  const req = (userId: string, status: s.RequestInsert['status'] = 'requested') => ({
    orgId: ids.orgId,
    siteId: ids.siteId,
    userId,
    date: '2026-11-24',
    bayType: 'car' as const,
    arrivalWindow: 'before_9' as const,
    status,
    submittedAt: new Date(),
  });

  it('rejects a second active request, allows one after withdrawal', async () => {
    const [a] = await employees();
    await db.insert(s.requests).values(req(a!.id, 'withdrawn')).run();
    await db.insert(s.requests).values(req(a!.id)).run();
    await expect(rootCause(db.insert(s.requests).values(req(a!.id)).run())).rejects.toThrow(
      /UNIQUE/,
    );
  });
});

describe('audit_log is append-only (non-negotiable #5)', () => {
  it('blocks UPDATE', async () => {
    await expect(
      rootCause(db.update(s.auditLog).set({ reason: 'tampered' }).run()),
    ).rejects.toThrow(/append-only/);
  });

  it('blocks DELETE of rows inside the 12-month retention window', async () => {
    await expect(rootCause(db.delete(s.auditLog).run())).rejects.toThrow(/12 months/);
  });

  it('allows the retention job to delete rows older than 12 months', async () => {
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 13);
    await db.insert(s.auditLog).values({ action: 'old', entity: 'test', at: old }).run();
    await db.delete(s.auditLog).where(eq(s.auditLog.action, 'old')).run();
    expect(
      await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'old')).all(),
    ).toHaveLength(0);
  });
});
