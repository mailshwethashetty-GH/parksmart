/** M4: rounds, publishing, offers and collation, driven through the real job runner. */
import {
  and,
  auditLog,
  bays,
  bookings,
  eq,
  inArray,
  jobRuns,
  notInArray,
  requests,
  rounds,
  sites,
  users,
  vehicles,
  waitlist,
} from '@parksmart/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { roundJobs } from './jobs/round-jobs';
import { clientFor, createTestApp } from './test-utils';

const ist = (local: string) => new Date(`${local}:00+05:30`);

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Client = Awaited<ReturnType<typeof clientFor>>;
let ctx: Ctx;
let now: Date;
const clients: Record<string, Client> = {};
const EMPLOYEES = ['divya', 'arjun', 'priya', 'karthik', 'ananya', 'rahul'];

beforeEach(async () => {
  now = ist('2026-11-25T10:00'); // Wed; weekly round for week of 30 Nov runs Fri 27 Nov 12:00
  ctx = await createTestApp({}, { clock: () => now });
  // A small car park makes contention easy to see: 2 car bays, 1 EV bay, no same-day pool.
  ctx.db
    .update(sites)
    .set({ settingsJson: { sameDayPoolPercent: 0 } })
    .run();
  ctx.db
    .update(bays)
    .set({ active: false })
    .where(notInArray(bays.code, ['B1-001', 'B1-002', 'B1-EV-001']))
    .run();
  for (const name of EMPLOYEES) clients[name] = await clientFor(ctx.app, `${name}@parksmart.test`);
});
afterEach(async () => ctx.app.close());

const run = (at: string) => {
  now = ist(at);
  return roundJobs(ctx.db, now);
};
const request = (name: string, dates: string[], extra: Record<string, unknown> = {}) =>
  clients[name]!.post('/requests', { dates, bayType: 'car', arrivalWindow: 'before_9', ...extra });
const userId = (name: string) =>
  ctx.db
    .select()
    .from(users)
    .where(eq(users.email, `${name}@parksmart.test`))
    .get()!.id;
const requestOf = (name: string, date: string) =>
  ctx.db
    .select()
    .from(requests)
    .where(and(eq(requests.userId, userId(name)), eq(requests.date, date)))
    .all()
    .at(-1)!;
const heldOn = (date: string) =>
  ctx.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.date, date), inArray(bookings.status, ['confirmed', 'checked_in'])))
    .all();
const myRequest = async (name: string, date: string) =>
  ((await clients[name]!.get('/requests')).body.items as { date: string }[]).find(
    (r) => r.date === date,
  ) as Record<string, unknown> | undefined;

describe('weekly round (FR-5)', () => {
  it('runs once at Friday 12:00 for next Mon–Fri and waits for review', async () => {
    await request('divya', ['2026-12-01']);
    expect(run('2026-11-27T11:59').filter((e) => e.job === 'weekly-round')).toEqual([]);
    const events = run('2026-11-27T12:00').filter((e) => e.job === 'weekly-round');
    expect(events).toEqual([
      expect.objectContaining({ key: expect.stringContaining('2026-11-30') }),
    ]);
    const round = ctx.db.select().from(rounds).get()!;
    expect(round).toMatchObject({
      roundType: 'weekly',
      targetDateFrom: '2026-11-30',
      targetDateTo: '2026-12-04',
      status: 'pending_review',
    });
    expect(round.approvalDeadline?.toISOString()).toBe(ist('2026-11-27T14:00').toISOString());
    expect(run('2026-11-27T12:01').filter((e) => e.job === 'weekly-round')).toEqual([]); // idempotent
    expect(ctx.db.select().from(rounds).all()).toHaveLength(1);
  });

  it('locks requests in review, and says when results are delayed (ADR-008)', async () => {
    await request('divya', ['2026-12-01']);
    run('2026-11-27T12:00');
    const mine = await myRequest('divya', '2026-12-01');
    expect(mine).toMatchObject({
      editable: false,
      decidedBy: null,
      awaitingResults: { delayed: false },
    });
    expect(
      (await clients.divya!.patch(`/requests/${mine!.id}`, { arrivalWindow: '9_to_11' })).status,
    ).toBe(409);
    expect((await clients.divya!.delete(`/requests/${mine!.id}`)).status).toBe(409);
    expect((await request('divya', ['2026-12-01'])).body.error.code).toBe('ROUND_IN_REVIEW');
    now = ist('2026-11-27T14:30');
    expect((await myRequest('divya', '2026-12-01'))!.awaitingResults).toMatchObject({
      delayed: true,
    });
    const listed = (await (await clientFor(ctx.app, 'admin@parksmart.test')).get('/admin/rounds'))
      .body.items[0];
    expect(listed).toMatchObject({
      status: 'pending_review',
      delayed: true,
      counts: { confirmed: 1 },
    });
  });

  it('auto-publishes at 07:00 on its first day; never over-books', async () => {
    for (const name of ['divya', 'arjun', 'priya', 'karthik']) await request(name, ['2026-12-01']);
    run('2026-11-27T12:00');
    // The daily round for Monday waits while the weekly round is still pending.
    expect(run('2026-11-27T18:00').filter((e) => e.job === 'daily-round')).toEqual([]);
    const events = run('2026-11-30T07:00');
    expect(events[0]).toMatchObject({ job: 'round-deadlines', detail: { mode: 'auto_timeout' } });
    const held = heldOn('2026-12-01');
    expect(held).toHaveLength(2);
    expect(new Set(held.map((b) => b.bayId)).size).toBe(2);
    const statuses = ['divya', 'arjun', 'priya', 'karthik']
      .map((n) => requestOf(n, '2026-12-01').status)
      .sort();
    expect(statuses).toEqual(['allocated', 'allocated', 'waitlisted', 'waitlisted']);
    expect(
      ctx.db
        .select()
        .from(waitlist)
        .all()
        .map((w) => w.position)
        .sort(),
    ).toEqual([1, 2]);
    const publish = ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'round.publish'))
      .get()!;
    expect(publish.reason).toContain('safety valve');
    expect(ctx.db.select().from(rounds).get()).toMatchObject({
      status: 'published',
      publishMode: 'auto_timeout',
    });
  });

  it('expires requests that fail eligibility at run time', async () => {
    await request('divya', ['2026-12-01'], { bayType: 'ev' });
    ctx.db
      .update(vehicles)
      .set({ isEv: false })
      .where(eq(vehicles.userId, userId('divya')))
      .run();
    run('2026-11-27T12:00');
    run('2026-11-30T07:00');
    expect(requestOf('divya', '2026-12-01').status).toBe('expired');
  });
});

describe('daily round', () => {
  it('runs the evening before with new requests plus everyone still waitlisted', async () => {
    for (const name of ['divya', 'arjun', 'priya']) await request(name, ['2026-12-01']);
    run('2026-11-27T12:00');
    run('2026-11-30T07:00'); // weekly publishes: 2 allocated, 1 waitlisted
    now = ist('2026-11-30T10:00');
    await request('karthik', ['2026-12-01']); // made after the weekly round: decided by the daily round
    const events = run('2026-11-30T18:00');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ job: 'daily-round', key: expect.stringContaining('2026-12-01') }),
      ]),
    );
    const daily = ctx.db.select().from(rounds).where(eq(rounds.roundType, 'daily')).get()!;
    expect(daily.status).toBe('pending_review');
    expect(daily.approvalDeadline?.toISOString()).toBe(ist('2026-11-30T19:00').toISOString());
    run('2026-12-01T07:00'); // safety valve publishes it
    expect(heldOn('2026-12-01')).toHaveLength(2);
    const positions = ctx.db.select().from(waitlist).where(eq(waitlist.date, '2026-12-01')).all();
    expect(positions.map((p) => p.position).sort()).toEqual([1, 2]);
  });
});

describe('same-day rounds and offers (FR-6, FR-20)', () => {
  async function setupWaitlistForTuesday() {
    for (const name of ['divya', 'arjun', 'priya', 'karthik']) await request(name, ['2026-12-01']);
    run('2026-11-27T12:00');
    run('2026-11-30T07:00'); // 2 allocated, 2 waitlisted for Tue
    // Someone cancels (booking cancellation arrives in M5): the bay is free for the same-day round.
    const freed = heldOn('2026-12-01')[0]!;
    ctx.db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, freed.id)).run();
    const waiting = ctx.db.select().from(waitlist).where(eq(waitlist.date, '2026-12-01')).all();
    const first = waiting.find((w) => w.position === 1)!;
    const second = waiting.find((w) => w.position === 2)!;
    const nameOf = (requestId: string) =>
      ['divya', 'arjun', 'priya', 'karthik'].find(
        (n) => requestOf(n, '2026-12-01').id === requestId,
      )!;
    return { first: nameOf(first.requestId), second: nameOf(second.requestId) };
  }

  it('offers a freed bay to the top of the waitlist; accepting confirms it', async () => {
    const { first } = await setupWaitlistForTuesday();
    const events = run('2026-12-01T07:00');
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ job: 'same-day-round' })]),
    );
    expect(
      ctx.db.select().from(rounds).where(eq(rounds.roundType, 'same_day')).get(),
    ).toMatchObject({
      status: 'published',
      publishMode: 'auto_same_day',
    });
    const mine = await myRequest(first, '2026-12-01');
    expect(mine).toMatchObject({ status: 'waitlisted', offer: { bayCode: expect.any(String) } });
    const offer = mine!.offer as { id: string; expiresAt: string };
    expect(offer.expiresAt).toBe(ist('2026-12-01T07:10').toISOString());
    expect((await clients[first]!.post(`/offers/${offer.id}/accept`)).status).toBe(200);
    expect(requestOf(first, '2026-12-01').status).toBe('allocated');
    expect(heldOn('2026-12-01')).toHaveLength(2);
    // Each slot runs once.
    expect(run('2026-12-01T07:05').filter((e) => e.job === 'same-day-round')).toEqual([]);
  });

  it('an expired offer passes straight to the next person', async () => {
    const { first, second } = await setupWaitlistForTuesday();
    run('2026-12-01T07:00');
    const events = run('2026-12-01T07:11');
    expect(events.map((e) => e.job)).toEqual(
      expect.arrayContaining(['offer-expiry', 'same-day-round']),
    );
    expect(requestOf(first, '2026-12-01').status).toBe('expired');
    expect((await myRequest(second, '2026-12-01'))!.offer).toMatchObject({
      bayCode: expect.any(String),
    });
    const late = await clients[first]!.get('/requests');
    // Still listed, so the employee can see the offer lapsed.
    expect(late.body.items.find((r: { date: string }) => r.date === '2026-12-01')).toMatchObject({
      status: 'expired',
      offer: null,
    });
  });

  it('declining passes the bay on at once', async () => {
    const { first, second } = await setupWaitlistForTuesday();
    run('2026-12-01T07:00');
    const offer = (await myRequest(first, '2026-12-01'))!.offer as { id: string };
    expect((await clients[first]!.post(`/offers/${offer.id}/decline`)).status).toBe(200);
    expect(requestOf(first, '2026-12-01').status).toBe('withdrawn');
    expect((await myRequest(second, '2026-12-01'))!.offer).not.toBeNull();
    // Someone else cannot accept your offer.
    const theirs = (await myRequest(second, '2026-12-01'))!.offer as { id: string };
    expect((await clients.rahul!.post(`/offers/${theirs.id}/accept`)).status).toBe(404);
  });

  it('a same-day request made on the day is picked up by the next slot', async () => {
    now = ist('2026-11-30T08:10');
    await request('rahul', ['2026-11-30']);
    const events = run('2026-11-30T08:30');
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ job: 'same-day-round' })]),
    );
    expect((await myRequest('rahul', '2026-11-30'))!.offer).not.toBeNull();
    // Nothing to do in later slots: no empty rounds are stored.
    run('2026-11-30T09:00');
    expect(ctx.db.select().from(rounds).all()).toHaveLength(1);
    expect(ctx.db.select().from(jobRuns).all().length).toBeGreaterThan(1);
  });
});

describe('collation view (FR-7)', () => {
  it('shows requests vs supply, the same-day hold-back and oversubscription per day and type', async () => {
    ctx.db
      .update(sites)
      .set({ settingsJson: { sameDayPoolPercent: 50 } })
      .run();
    for (const name of ['divya', 'arjun', 'priya']) await request(name, ['2026-12-01']);
    const admin = await clientFor(ctx.app, 'admin@parksmart.test');
    const res = await admin.get('/admin/collation?from=2026-11-30&days=3');
    expect(res.status).toBe(200);
    expect(res.body.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
    const car = res.body.days[1].cells.find((c: { bayType: string }) => c.bayType === 'car');
    expect(car).toMatchObject({
      supply: 2,
      heldForSameDay: 1,
      requests: 3,
      oversubscription: 3,
      forecastRemaining: null,
    });
    expect((await clients.divya!.get('/admin/collation')).status).toBe(403);
  });

  it('forecasts only from finished days, never from future ones', async () => {
    for (const name of ['divya', 'arjun']) await request(name, ['2026-12-01']);
    const admin = await clientFor(ctx.app, 'admin@parksmart.test');
    // Tue 8 Dec's history would include Tue 1 Dec, which hasn't happened yet (today is 25 Nov).
    const ahead = await admin.get('/admin/collation?from=2026-12-08&days=1');
    expect(
      ahead.body.days[0].cells.find((c: { bayType: string }) => c.bayType === 'car')
        .forecastRemaining,
    ).toBeNull();
    // Once Tue 1 Dec is in the past, it counts.
    now = ist('2026-12-02T09:00');
    const later = await admin.get('/admin/collation?from=2026-12-08&days=1');
    expect(
      later.body.days[0].cells.find((c: { bayType: string }) => c.bayType === 'car')
        .forecastRemaining,
    ).toBe(2);
  });
});
