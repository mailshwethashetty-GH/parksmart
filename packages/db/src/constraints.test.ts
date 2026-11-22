import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client';
import * as s from './schema';
import { seed } from './seed';
import { createTestDb } from './testing';

let db: Db;
let ids: { orgId: string; siteId: string };

beforeEach(() => {
  db = createTestDb();
  ids = seed(db, new Date('2026-11-22T04:00:00Z'));
});

const firstBay = () => db.select().from(s.bays).limit(1).get()!;
const employees = () => db.select().from(s.users).where(eq(s.users.role, 'employee')).all();

function booking(userId: string, bayId: string, status: s.BookingInsert['status'] = 'confirmed') {
  return { orgId: ids.orgId, siteId: ids.siteId, userId, bayId, date: '2026-11-24', status };
}

describe('seed', () => {
  it('creates 150 car-park bays incl. 10 EV and 5 accessible', () => {
    const bays = db.select().from(s.bays).all();
    expect(bays).toHaveLength(150);
    expect(bays.filter((b) => b.bayType === 'ev')).toHaveLength(10);
    expect(bays.filter((b) => b.bayType === 'accessible')).toHaveLength(5);
  });

  it('publishes policy v1 with weights totalling 100', () => {
    const rules = db.select().from(s.rules).where(eq(s.rules.ruleType, 'weighted')).all();
    expect(rules.reduce((sum, r) => sum + (r.weight ?? 0), 0)).toBe(100);
    const version = db.select().from(s.policyVersions).get()!;
    expect(version.effectiveFromWeek).toBe('2026-11-16');
  });
});

describe('never over-book (non-negotiable #1)', () => {
  it('rejects a second bay-holding booking for the same bay and date', () => {
    const [a, b] = employees();
    const bay = firstBay();
    db.insert(s.bookings).values(booking(a!.id, bay.id)).run();
    expect(() => db.insert(s.bookings).values(booking(b!.id, bay.id)).run()).toThrow(/UNIQUE/);
  });

  it('allows rebooking a bay once the earlier booking is released', () => {
    const [a, b] = employees();
    const bay = firstBay();
    db.insert(s.bookings).values(booking(a!.id, bay.id)).run();
    db.update(s.bookings)
      .set({ status: 'auto_released' })
      .where(and(eq(s.bookings.bayId, bay.id), eq(s.bookings.userId, a!.id)))
      .run();
    expect(() => db.insert(s.bookings).values(booking(b!.id, bay.id)).run()).not.toThrow();
  });

  it('an employee holds at most one bay per day', () => {
    const [a] = employees();
    const [bay1, bay2] = db.select().from(s.bays).limit(2).all();
    db.insert(s.bookings).values(booking(a!.id, bay1!.id)).run();
    expect(() => db.insert(s.bookings).values(booking(a!.id, bay2!.id)).run()).toThrow(/UNIQUE/);
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

  it('rejects a second active request, allows one after withdrawal', () => {
    const [a] = employees();
    db.insert(s.requests).values(req(a!.id, 'withdrawn')).run();
    db.insert(s.requests).values(req(a!.id)).run();
    expect(() => db.insert(s.requests).values(req(a!.id)).run()).toThrow(/UNIQUE/);
  });
});

describe('audit_log is append-only (non-negotiable #5)', () => {
  it('blocks UPDATE', () => {
    expect(() => db.update(s.auditLog).set({ reason: 'tampered' }).run()).toThrow(/append-only/);
  });

  it('blocks DELETE of rows inside the 12-month retention window', () => {
    expect(() => db.delete(s.auditLog).run()).toThrow(/12 months/);
  });

  it('allows the retention job to delete rows older than 12 months', () => {
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 13);
    db.insert(s.auditLog).values({ action: 'old', entity: 'test', at: old }).run();
    db.delete(s.auditLog).where(eq(s.auditLog.action, 'old')).run();
    expect(db.select().from(s.auditLog).where(eq(s.auditLog.action, 'old')).all()).toHaveLength(0);
  });
});
