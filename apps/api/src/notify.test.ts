/** M7: notifications (FR-25), reminders, retention, profile & consent, data rights, reports (FR-28). */
import {
  auditLog,
  bays,
  bookings,
  consents,
  eq,
  notifications,
  notInArray,
  overrides,
  sites,
  users,
  vehicles,
} from '@parksmart/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notificationJobs } from './jobs/notification-jobs';
import { roundJobs } from './jobs/round-jobs';
import { dispatchEmails, queueNotification } from './services/notifications';
import { clientFor, createTestApp, findAsync, mapAsync } from './test-utils';

const ist = (local: string) => new Date(`${local}:00+05:30`);
type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Client = Awaited<ReturnType<typeof clientFor>>;
let ctx: Ctx;
let now: Date;
let admin: Client;
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
  for (const n of NAMES) c[n] = await clientFor(ctx.app, `${n}@parksmart.test`);
});
afterEach(async () => await ctx.app.close());

const run = async (at: string) => {
  now = ist(at);
  return await roundJobs(ctx.db, now);
};
const userId = async (n: string) =>
  (await ctx.db
    .select()
    .from(users)
    .where(eq(users.email, `${n}@parksmart.test`))
    .get())!.id;
const inApp = async (n: string) =>
  (
    await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, await userId(n)))
      .all()
  ).filter((x) => x.channel === 'in_app');
async function tuesdayRound() {
  for (const n of NAMES)
    await c[n]!.post('/requests', {
      dates: ['2026-12-01'],
      bayType: 'car',
      arrivalWindow: 'before_9',
    });
  await run('2026-11-27T12:00');
}

describe('notifications on results (FR-25)', () => {
  it('tells each person their result once, in the inbox and by email', async () => {
    await tuesdayRound();
    await run('2026-11-30T07:00'); // published: 2 confirmed, 1 waitlisted
    const kinds = await mapAsync(NAMES, async (n) =>
      (await inApp(n)).map((x) => (x.payloadJson as { outcome: string }).outcome),
    );
    expect(kinds.flat().sort()).toEqual(['confirmed', 'confirmed', 'waitlisted']);
    const holder = (await findAsync(
      NAMES,
      async (n) => (await inApp(n))[0]!.payloadJson.outcome === 'confirmed',
    ))!;
    const inbox = await c[holder]!.get('/me/notifications');
    expect(inbox.body).toMatchObject({
      unread: 1,
      items: [
        {
          kind: 'round_result',
          title: expect.stringMatching(/^Bay B1-00[12] confirmed for Tue 1 Dec$/),
        },
      ],
    });
    await c[holder]!.post('/me/notifications/read', { ids: 'all' });
    expect((await c[holder]!.get('/me/notifications')).body.unread).toBe(0);

    // The daily round re-ranks the waitlist; someone still waitlisted is not told again.
    await run('2026-11-30T18:00');
    await run('2026-12-01T07:00');
    const waiter = (await findAsync(
      NAMES,
      async (n) => n !== holder && (await inApp(n))[0]!.payloadJson.outcome === 'waitlisted',
    ))!;
    expect(await inApp(waiter)).toHaveLength(1);
  });

  it('same-day offers are time-critical; auto-release is reported', async () => {
    await tuesdayRound();
    await run('2026-11-30T07:00');
    const [held] = await ctx.db.select().from(bookings).all();
    await ctx.db
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(eq(bookings.id, held!.id))
      .run();
    await run('2026-12-01T07:00'); // same-day round offers the freed bay
    const offer = (await ctx.db.select().from(notifications).all()).find(
      (x) => x.kind === 'offer' && x.channel === 'email',
    )!;
    expect(offer.timeCritical).toBe(true);
    await run('2026-12-01T09:15'); // the other booking is auto-released (nobody checked in)
    expect(
      (await ctx.db.select().from(notifications).all()).some((x) => x.kind === 'auto_released'),
    ).toBe(true);
  });
});

describe('email rules: daily cap and quiet hours', () => {
  const queue = async (n: string, kind: 'round_result' | 'offer', count: number) => {
    for (let i = 0; i < count; i++) {
      await queueNotification(ctx.db, {
        userId: await userId(n),
        kind,
        payload: { outcome: 'confirmed', date: '2026-12-01', bayCode: 'B1-001' },
        now,
      });
    }
  };

  it('sends at most 3 non-urgent emails a day; urgent ones always go', async () => {
    now = ist('2026-11-30T10:00');
    await queue('divya', 'round_result', 5);
    await queue('divya', 'offer', 2);
    const result = await dispatchEmails(ctx.db, ctx.app.mailer, now);
    expect(result).toMatchObject({ sent: 5, skipped: 2 });
    expect(ctx.sent).toHaveLength(5);
    expect(ctx.sent[0]!.to).toBe('divya@parksmart.test');
    const skipped = (await ctx.db.select().from(notifications).all()).filter(
      (x) => x.skippedReason === 'daily_cap',
    );
    expect(skipped).toHaveLength(2);
    expect(await inApp('divya')).toHaveLength(7); // the inbox still has all of them
  });

  it('holds non-urgent email during quiet hours and sends it after', async () => {
    now = ist('2026-11-30T23:00');
    await queue('divya', 'round_result', 1);
    await queue('divya', 'offer', 1);
    expect(await dispatchEmails(ctx.db, ctx.app.mailer, now)).toMatchObject({ sent: 1, held: 1 });
    now = ist('2026-12-01T07:05');
    expect(await dispatchEmails(ctx.db, ctx.app.mailer, now)).toMatchObject({ sent: 1, held: 0 });
  });

  it('drops stale urgent messages and retries failed sends', async () => {
    now = ist('2026-11-30T10:00');
    await queue('divya', 'offer', 1);
    now = ist('2026-11-30T11:00');
    expect(await dispatchEmails(ctx.db, ctx.app.mailer, now)).toMatchObject({ skipped: 1 });
    await queue('arjun', 'round_result', 1);
    const failing = { send: async () => await Promise.reject(new Error('SMTP down')) };
    expect(await dispatchEmails(ctx.db, failing, now)).toMatchObject({ failed: 1 });
    expect(await dispatchEmails(ctx.db, ctx.app.mailer, now)).toMatchObject({ sent: 1 });
  });
});

describe('reminders and housekeeping', () => {
  it('warns 10 minutes before auto-release, once', async () => {
    await tuesdayRound();
    await run('2026-11-30T07:00');
    now = ist('2026-12-01T09:04');
    expect(
      (await notificationJobs(ctx.db, now)).filter((e) => e.job === 'release-warning'),
    ).toHaveLength(0);
    now = ist('2026-12-01T09:05');
    expect(
      (await notificationJobs(ctx.db, now)).filter((e) => e.job === 'release-warning'),
    ).toHaveLength(2);
    now = ist('2026-12-01T09:06');
    expect(
      (await notificationJobs(ctx.db, now)).filter((e) => e.job === 'release-warning'),
    ).toHaveLength(0);
  });

  it('reminds admins 60 minutes after a round runs and 15 minutes before its deadline', async () => {
    await tuesdayRound(); // weekly round ran Fri 12:00, deadline 14:00
    now = ist('2026-11-27T13:00');
    expect((await notificationJobs(ctx.db, now)).map((e) => e.job)).toContain('approval-reminder');
    now = ist('2026-11-27T13:45');
    const events = (await notificationJobs(ctx.db, now)).filter(
      (e) => e.job === 'approval-reminder',
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.userIds).toEqual([await userId('admin')]);
    expect((await admin.get('/me/notifications')).body.items[0].title).toBe(
      'Round approval due in 15 minutes',
    );
  });

  it('removes audit entries older than 12 months, keeps the rest', async () => {
    const siteId = (await ctx.db.select().from(sites).get())!.id;
    await ctx.db
      .insert(auditLog)
      .values({ siteId, action: 'old', entity: 'test', at: ist('2025-10-01T10:00') })
      .run();
    now = ist('2026-11-30T03:00');
    await notificationJobs(ctx.db, now);
    const actions = (await ctx.db.select().from(auditLog).all()).map((a) => a.action);
    expect(actions).not.toContain('old');
    expect(actions).toContain('seed');
  });
});

describe('profile, consent and data rights (DPDP)', () => {
  it('asks for consent before storing vehicles; withdrawing removes them', async () => {
    const p = await c.arjun!.get('/me/profile');
    expect(
      p.body.consents.find((x: { purpose: string }) => x.purpose === 'parking_allocation'),
    ).toMatchObject({ granted: true, required: true });
    // The seed grants vehicle consent with the seeded car; withdrawing it deletes the car.
    await c.arjun!.post('/me/consents', { purpose: 'vehicle_details', granted: false });
    expect((await c.arjun!.get('/me/profile')).body.vehicles).toHaveLength(0);
    expect((await c.arjun!.post('/me/vehicles', { type: 'car', isEv: true })).body.error.code).toBe(
      'CONSENT_REQUIRED',
    );
    await c.arjun!.post('/me/consents', { purpose: 'vehicle_details', granted: true });
    const added = await c.arjun!.post('/me/vehicles', { type: 'car', isEv: true });
    expect(added.body.vehicles.filter((v: { isEv: boolean }) => v.isEv)).toHaveLength(1);
    // Now Arjun can request an EV bay (he couldn't before).
    expect(
      (
        await c.arjun!.post('/requests', {
          dates: ['2026-12-02'],
          bayType: 'car',
          arrivalWindow: 'before_9',
        })
      ).status,
    ).toBe(201);
    await c.arjun!.post('/me/consents', { purpose: 'vehicle_details', granted: false });
    expect(
      await ctx.db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, await userId('arjun')))
        .all(),
    ).toHaveLength(0);
  });

  it('requires a plate only when the site needs it', async () => {
    await c.arjun!.post('/me/consents', { purpose: 'vehicle_details', granted: true });
    await ctx.db
      .update(sites)
      .set({ settingsJson: { sameDayPoolPercent: 0, requireVehiclePlate: true } })
      .run();
    expect((await c.arjun!.post('/me/vehicles', { type: 'car' })).body.error.code).toBe(
      'PLATE_REQUIRED',
    );
    expect(
      (await c.arjun!.post('/me/vehicles', { type: 'car', plate: 'ka 01 ab 1234' })).body
        .vehicles[1].plate,
    ).toBe('KA 01 AB 1234');
  });

  it('no requests without consent to allocation', async () => {
    await c.priya!.post('/me/consents', { purpose: 'parking_allocation', granted: false });
    const res = await c.priya!.post('/requests', {
      dates: ['2026-12-02'],
      bayType: 'car',
      arrivalWindow: 'before_9',
    });
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('exports my data and only mine', async () => {
    await c.divya!.post('/requests', {
      dates: ['2026-12-02'],
      bayType: 'car',
      arrivalWindow: 'before_9',
    });
    await c.arjun!.post('/requests', {
      dates: ['2026-12-02'],
      bayType: 'car',
      arrivalWindow: 'before_9',
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/data-export',
      headers: { cookie: c.divya!.cookie },
    });
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = res.json();
    expect(data.user.email).toBe('divya@parksmart.test');
    expect(data.requests).toHaveLength(1);
    const divyaId = await userId('divya');
    expect(data.requests.every((r: { userId: string }) => r.userId === divyaId)).toBe(true);
  });

  it('deletes my account: anonymised, future bookings cancelled, signed out, audited', async () => {
    await tuesdayRound();
    await run('2026-11-30T07:00');
    now = ist('2026-11-30T09:00');
    const holder = (await findAsync(
      NAMES,
      async (n) =>
        await ctx.db
          .select()
          .from(bookings)
          .where(eq(bookings.userId, await userId(n)))
          .get(),
    ))!;
    const id = await userId(holder);
    expect((await admin.delete('/me')).status).toBe(403);
    expect((await c[holder]!.delete('/me')).status).toBe(200);
    const u = (await ctx.db.select().from(users).where(eq(users.id, id)).get())!;
    expect(u).toMatchObject({ name: 'Deleted user', active: false });
    expect(u.email).toMatch(/\.invalid$/);
    expect(
      (await ctx.db.select().from(bookings).where(eq(bookings.userId, id)).get())!.status,
    ).toBe('cancelled');
    expect(
      (await ctx.db.select().from(consents).where(eq(consents.userId, id)).all()).every(
        (x) => x.revokedAt,
      ),
    ).toBe(true);
    expect((await c[holder]!.get('/me')).status).toBe(401);
    expect(
      await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'user.delete')).all(),
    ).toHaveLength(1);
  });
});

describe('monthly report (FR-28)', () => {
  it('computes utilisation, no-shows, fairness and override rate, and exports CSV', async () => {
    await tuesdayRound();
    const round = (await admin.get('/admin/rounds')).body.items[0];
    const detail = (await admin.get(`/admin/rounds/${round.id}`)).body;
    const winner = detail.decisions.find((d: { outcome: string }) => d.outcome === 'confirmed');
    await admin.post(`/admin/allocations/${winner.allocationId}/override`, {
      action: 'waitlist',
      reason: 'Swap for testing',
    });
    const loser = detail.decisions.find((d: { outcome: string }) => d.outcome === 'waitlisted');
    await admin.post(`/admin/allocations/${loser.allocationId}/override`, {
      action: 'assign',
      bayId: winner.bayId,
      reason: 'Swap for testing',
    });
    await admin.post(`/admin/rounds/${round.id}/approve`, {});
    // One of the two checks in; the other is auto-released.
    const [first] = await ctx.db.select().from(bookings).all();
    await ctx.db
      .update(bookings)
      .set({ status: 'checked_in' })
      .where(eq(bookings.id, first!.id))
      .run();
    await run('2026-12-01T09:15');
    now = ist('2026-12-15T10:00');
    const res = await admin.get('/admin/reports/monthly?month=2026-12');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activeBays: 2,
      metrics: {
        noShowRate: 0.5,
        overrideRate: 0.667, // 2 of 3 decisions overridden
        overrides: 2,
        fairness: { employees: 3, belowTarget: 1, minShare: 0 },
        requests: 3,
      },
    });
    expect(await ctx.db.select().from(overrides).all()).toHaveLength(2);
    const tue = res.body.days.find((d: { date: string }) => d.date === '2026-12-01');
    expect(tue).toMatchObject({ peak: true, checkedIn: 1, autoReleased: 1, utilisation: 0.5 });
    const csv = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/reports/export?month=2026-12',
      headers: { cookie: admin.cookie },
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('"No-show rate","50%"');
    expect(csv.body).toContain('"2026-12-01","yes","3","2","1","1","50%"');
    expect((await c.divya!.get('/admin/reports/monthly?month=2026-12')).status).toBe(403);
  });
});
