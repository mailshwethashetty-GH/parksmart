/** M6: QR check-in, bay stickers, manual check-in, gate view, auto-release, running late. */
import {
  auditLog,
  bays,
  bookings,
  checkins,
  eq,
  notInArray,
  requests,
  sites,
  users,
} from '@parksmart/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { roundJobs } from './jobs/round-jobs';
import { clientFor, createTestApp, filterAsync, findAsync } from './test-utils';

const ist = (local: string) => new Date(`${local}:00+05:30`);
type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Client = Awaited<ReturnType<typeof clientFor>>;
let ctx: Ctx;
let now: Date;
let admin: Client;
let security: Client;
const c: Record<string, Client> = {};
const NAMES = ['divya', 'arjun', 'priya'];

beforeEach(async () => {
  now = ist('2026-11-25T10:00');
  ctx = await createTestApp({}, { clock: () => now });
  await ctx.db
    .update(sites)
    .set({ settingsJson: { sameDayPoolPercent: 0 } })
    .run();
  await ctx.db
    .update(bays)
    .set({ active: false })
    .where(notInArray(bays.code, ['B1-001', 'B1-002']))
    .run();
  admin = await clientFor(ctx.app, 'admin@parksmart.test');
  security = await clientFor(ctx.app, 'security@parksmart.test');
  for (const n of NAMES) {
    c[n] = await clientFor(ctx.app, `${n}@parksmart.test`);
    await c[n]!.post('/requests', {
      dates: ['2026-12-01'],
      bayType: 'car',
      arrivalWindow: 'before_9',
    });
  }
  await run('2026-11-27T12:00'); // weekly round
  await run('2026-11-30T07:00'); // published by the day-start safety valve: 2 booked, 1 waitlisted
});
afterEach(async () => await ctx.app.close());

async function run(at: string) {
  now = ist(at);
  return await roundJobs(ctx.db, now);
}
const userId = async (n: string) =>
  (await ctx.db
    .select()
    .from(users)
    .where(eq(users.email, `${n}@parksmart.test`))
    .get())!.id;
const bookingOf = async (n: string) =>
  await ctx.db
    .select()
    .from(bookings)
    .where(eq(bookings.userId, await userId(n)))
    .get();
const holders = async () => await filterAsync(NAMES, bookingOf);
const waiting = async () => (await findAsync(NAMES, async (n) => !(await bookingOf(n))))!;
const qrFor = async (n: string) =>
  (await c[n]!.get(`/bookings/${(await bookingOf(n))!.id}/qr`)).body;

describe('QR check-in at the gate (FR-21)', () => {
  it('issues a daily token only to the booking owner; security scans it once', async () => {
    const [a, b] = await holders();
    expect((await c[b!]!.get(`/bookings/${(await bookingOf(a!))!.id}/qr`)).status).toBe(404);
    const qr = await qrFor(a!);
    expect(qr).toMatchObject({
      date: '2026-12-01',
      expiresAt: ist('2026-12-02T00:00').toISOString(),
    });

    now = ist('2026-12-01T08:40');
    const scan = await security.post('/checkins/scan', { token: qr.token });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({
      alreadyCheckedIn: false,
      booking: {
        bayCode: expect.stringMatching(/^B1-00[12]$/),
        zoneName: 'Basement 1',
        employeeName: expect.any(String),
      },
    });
    expect((await bookingOf(a!))!.status).toBe('checked_in');
    expect(await ctx.db.select().from(checkins).get()).toMatchObject({
      method: 'qr_employee',
      byUserId: await userId('security'),
    });
    expect(
      await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'booking.checkin')).all(),
    ).toHaveLength(1);
    expect((await security.post('/checkins/scan', { token: qr.token })).body.alreadyCheckedIn).toBe(
      true,
    );
    expect(await ctx.db.select().from(checkins).all()).toHaveLength(1);
  });

  it('rejects tokens on another day, tampered tokens, and scans by non-security staff', async () => {
    const qr = await qrFor((await holders())[0]!);
    now = ist('2026-11-30T20:00'); // the evening before: not valid yet
    expect((await security.post('/checkins/scan', { token: qr.token })).body.error.code).toBe(
      'QR_INVALID',
    );
    now = ist('2026-12-02T08:00'); // the day after: expired
    expect((await security.post('/checkins/scan', { token: qr.token })).body.error.code).toBe(
      'QR_INVALID',
    );
    now = ist('2026-12-01T08:00');
    const tampered = `${qr.token.slice(0, -4)}AAAA`;
    expect((await security.post('/checkins/scan', { token: tampered })).body.error.code).toBe(
      'QR_INVALID',
    );
    expect((await c.divya!.post('/checkins/scan', { token: qr.token })).status).toBe(403);
  });
});

describe('bay sticker and manual check-in (FR-21)', () => {
  it('lets the employee scan their own bay, and points them to it if they scan the wrong one', async () => {
    const [a] = await holders();
    const mine = (await bookingOf(a!))!;
    const other = (await ctx.db.select().from(bays).where(eq(bays.active, true)).all()).find(
      (b) => b.id !== mine.bayId,
    )!;
    const myBayToken = (await admin.get(`/admin/bays/${mine.bayId}/qr`)).body.token;
    const otherToken = (await admin.get(`/admin/bays/${other.id}/qr`)).body.token;
    now = ist('2026-12-01T08:30');
    const wrong = await c[a!]!.post('/checkins/bay', { token: otherToken });
    expect(wrong.body.error).toMatchObject({
      code: 'WRONG_BAY',
      details: { bayCode: expect.any(String) },
    });
    expect((await c[a!]!.post('/checkins/bay', { token: myBayToken })).status).toBe(200);
    expect((await ctx.db.select().from(checkins).get())!.method).toBe('qr_bay');
    expect(
      (await c[await waiting()]!.post('/checkins/bay', { token: myBayToken })).body.error.code,
    ).toBe('NO_BOOKING_TODAY');
    expect(
      (await c[a!]!.post('/checkins/bay', { token: (await qrFor(a!)).token })).body.error.code,
    ).toBe('QR_INVALID');
  });

  it('lets security check someone in by hand, only on the day', async () => {
    const b = (await bookingOf((await holders())[0]!))!;
    now = ist('2026-11-30T09:00');
    expect((await security.post('/checkins/manual', { bookingId: b.id })).body.error.code).toBe(
      'NOT_TODAY',
    );
    now = ist('2026-12-01T09:00');
    expect((await security.post('/checkins/manual', { bookingId: b.id })).status).toBe(200);
    expect((await ctx.db.select().from(checkins).get())!.method).toBe('manual_security');
  });
});

describe('gate view', () => {
  it("lists today's bookings and bay states for security", async () => {
    const [a] = await holders();
    now = ist('2026-12-01T08:00');
    await security.post('/checkins/scan', { token: (await qrFor(a!)).token });
    const res = await security.get('/gate/today');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-12-01');
    expect(res.body.bookings).toHaveLength(2);
    expect(res.body.bookings.map((b: { status: string }) => b.status).sort()).toEqual([
      'checked_in',
      'confirmed',
    ]);
    const waitingCheckIn = res.body.bookings.find(
      (b: { status: string }) => b.status === 'confirmed',
    );
    expect(waitingCheckIn.checkInBy).toBe(ist('2026-12-01T09:15').toISOString());
    expect(res.body.bays.map((b: { state: string }) => b.state).sort()).toEqual([
      'booked',
      'checked_in',
    ]);
    expect((await c.divya!.get('/gate/today')).status).toBe(403);
  });
});

describe('auto-release (FR-22)', () => {
  it('releases unclaimed bays after the grace window and offers them at once', async () => {
    const [a, b] = await holders();
    now = ist('2026-12-01T08:30');
    await security.post('/checkins/scan', { token: (await qrFor(a!)).token });
    expect((await run('2026-12-01T09:14')).filter((e) => e.job === 'auto-release')).toEqual([]);
    const events = await run('2026-12-01T09:15');
    expect(events.filter((e) => e.job === 'auto-release')).toHaveLength(1);
    expect((await bookingOf(b!))!.status).toBe('auto_released');
    expect((await bookingOf(a!))!.status).toBe('checked_in');
    const audit = (await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'booking.auto_release'))
      .get())!;
    expect(audit.reason).toContain('No check-in by');
    // The employee sees what happened; the bay goes straight to the waitlist.
    const mine = ((await c[b!]!.get('/requests')).body.items as Record<string, unknown>[])[0]!;
    expect(mine).toMatchObject({ status: 'expired', booking: { status: 'auto_released' } });
    expect(events.map((e) => e.job)).toContain('same-day-round');
    const next = (
      (await c[await waiting()]!.get('/requests')).body.items as Record<string, unknown>[]
    )[0]!;
    expect(next.offer).toMatchObject({ bayCode: expect.any(String) });
  });

  it('"running late" adds 30 minutes once a week; never after the deadline', async () => {
    const [a] = await holders();
    const id = (await bookingOf(a!))!.id;
    now = ist('2026-12-01T09:00');
    const late = await c[a!]!.post(`/bookings/${id}/running-late`, {});
    expect(late.body).toEqual({ checkInBy: ist('2026-12-01T09:45').toISOString() });
    expect((await c[a!]!.post(`/bookings/${id}/running-late`, {})).status).toBe(409);
    expect((await run('2026-12-01T09:20')).filter((e) => e.job === 'auto-release')).toHaveLength(1); // the other one
    expect((await bookingOf(a!))!.status).toBe('confirmed');
    await run('2026-12-01T09:45');
    expect((await bookingOf(a!))!.status).toBe('auto_released');

    // Weekly limit: a second booking later that week can't be extended.
    await ctx.db
      .insert(bookings)
      .values({
        orgId: (await bookingOf(a!))!.orgId,
        siteId: (await bookingOf(a!))!.siteId,
        userId: await userId(a!),
        bayId: (await bookingOf(a!))!.bayId,
        date: '2026-12-03',
        status: 'confirmed',
        createdAt: now,
      })
      .run();
    const second = (await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.date, '2026-12-03'))
      .get())!;
    await ctx.db
      .insert(requests)
      .values({
        orgId: second.orgId,
        siteId: second.siteId,
        userId: await userId(a!),
        date: '2026-12-03',
        bayType: 'car',
        arrivalWindow: 'before_9',
        status: 'allocated',
        submittedAt: now,
      })
      .run();
    now = ist('2026-12-03T08:00');
    expect((await c[a!]!.post(`/bookings/${second.id}/running-late`, {})).body.error.code).toBe(
      'LATE_LIMIT',
    );
  });

  it('closes out checked-in bookings when the day ends', async () => {
    const [a] = await holders();
    now = ist('2026-12-01T08:00');
    await security.post('/checkins/scan', { token: (await qrFor(a!)).token });
    await run('2026-12-02T00:05');
    expect((await bookingOf(a!))!.status).toBe('released');
    expect(
      await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'booking.release')).all(),
    ).toHaveLength(1);
  });
});
