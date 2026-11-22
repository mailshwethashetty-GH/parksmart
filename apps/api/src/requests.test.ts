/** M3: requests, calendar, recurring patterns and the recurring-expand job (FR-1, FR-3, FR-4). */
import { jobRuns, requests, users } from '@parksmart/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recurringExpandJob } from './jobs/recurring-expand';
import { clientFor, createTestApp } from './test-utils';

// Wed 25 Nov 2026, 10:00 IST. Weekly round for the week of Mon 30 Nov: Fri 27 Nov 12:00 IST.
const ist = (local: string) => new Date(`${local}:00+05:30`);
const WED_MORNING = ist('2026-11-25T10:00');

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;
let now: Date;
let divya: Awaited<ReturnType<typeof clientFor>>; // EV owner
let arjun: Awaited<ReturnType<typeof clientFor>>; // no EV

beforeEach(async () => {
  now = WED_MORNING;
  ctx = await createTestApp({}, { clock: () => now });
  divya = await clientFor(ctx.app, 'divya@parksmart.test');
  arjun = await clientFor(ctx.app, 'arjun@parksmart.test');
});
afterEach(async () => ctx.app.close());

const car = (dates: string[], extra: Record<string, unknown> = {}) => ({
  dates,
  bayType: 'car',
  arrivalWindow: 'before_9',
  ...extra,
});
const activeFor = (email: string) => {
  const user = ctx.db.select().from(users).where(eq(users.email, email)).get()!;
  return ctx.db
    .select()
    .from(requests)
    .where(eq(requests.userId, user.id))
    .all()
    .filter((r) => ['requested', 'allocated', 'waitlisted'].includes(r.status));
};

describe('making requests (FR-1)', () => {
  it('shows which round decides it and when the answer comes', async () => {
    const res = await divya.post('/requests', car(['2026-12-02']));
    expect(res.status).toBe(201);
    expect(res.body.items[0]).toMatchObject({
      date: '2026-12-02',
      status: 'requested',
      editable: true,
      decidedBy: {
        round: 'weekly',
        runAt: ist('2026-11-27T12:00').toISOString(),
        resultsBy: ist('2026-11-27T14:00').toISOString(),
      },
    });
  });

  it('requests several days at once', async () => {
    const res = await divya.post('/requests', car(['2026-11-30', '2026-12-01']));
    expect(res.body.items.map((r: { date: string }) => r.date)).toEqual([
      '2026-11-30',
      '2026-12-01',
    ]);
  });

  it('a request for today goes to the next same-day round', async () => {
    const res = await divya.post('/requests', car(['2026-11-25']));
    expect(res.body.items[0].decidedBy).toMatchObject({
      round: 'same_day',
      runAt: ist('2026-11-25T10:30').toISOString(),
    });
  });

  it('a new request for the same day replaces the old one', async () => {
    const first = await divya.post('/requests', car(['2026-12-02']));
    const second = await divya.post('/requests', {
      ...car(['2026-12-02']),
      bayType: 'ev',
      allowFallback: false,
    });
    expect(second.body.items[0].id).toBe(first.body.items[0].id);
    expect(second.body.items[0]).toMatchObject({ bayType: 'ev', allowFallback: false });
    expect(activeFor('divya@parksmart.test')).toHaveLength(1);
  });

  it('is all-or-nothing: one closed date rejects the whole request', async () => {
    const res = await divya.post('/requests', car(['2026-12-02', '2026-11-28', '2026-11-24']));
    expect(res.status).toBe(422);
    expect(res.body.error.details.problems).toEqual([
      expect.objectContaining({ date: '2026-11-28', code: 'NOT_WORKING_DAY' }),
      expect.objectContaining({ date: '2026-11-24', code: 'PAST_DATE' }),
    ]);
    expect(activeFor('divya@parksmart.test')).toHaveLength(0);
  });

  it('rejects dates beyond the booking horizon and after the last same-day round', async () => {
    expect((await divya.post('/requests', car(['2026-12-24']))).body.error.code).toBe(
      'BEYOND_HORIZON',
    );
    now = ist('2026-11-25T17:30');
    expect((await divya.post('/requests', car(['2026-11-25']))).body.error.code).toBe(
      'SAME_DAY_CLOSED',
    );
  });
});

describe('eligibility at request time', () => {
  it('EV bays need a registered EV', async () => {
    const res = await arjun.post('/requests', { ...car(['2026-12-02']), bayType: 'ev' });
    expect(res.body.error.code).toBe('NOT_EV');
    expect((await divya.post('/requests', { ...car(['2026-12-02']), bayType: 'ev' })).status).toBe(
      201,
    );
  });

  it('accessible bays need an approval valid on the day', async () => {
    const priya = await clientFor(ctx.app, 'priya@parksmart.test');
    expect(
      (await priya.post('/requests', { ...car(['2026-11-30']), bayType: 'accessible' })).body.error
        .code,
    ).toBe('ACCESSIBLE_NOT_APPROVED');
    const admin = await clientFor(ctx.app, 'admin@parksmart.test');
    const priyaId = ctx.db
      .select()
      .from(users)
      .where(eq(users.email, 'priya@parksmart.test'))
      .get()!.id;
    await admin.post('/admin/approvals', { userId: priyaId, expiresOn: '2026-12-01' });
    expect(
      (await priya.post('/requests', { ...car(['2026-11-30']), bayType: 'accessible' })).status,
    ).toBe(201);
    const late = await priya.post('/requests', { ...car(['2026-12-02']), bayType: 'accessible' });
    expect(late.body.error.code).toBe('ACCESSIBLE_NOT_APPROVED');
  });

  it('carpool (P2) and types the site has no bays for are refused', async () => {
    expect(
      (await divya.post('/requests', { ...car(['2026-12-02']), bayType: 'carpool' })).body.error
        .code,
    ).toBe('CARPOOL_NOT_AVAILABLE');
    expect(
      (await divya.post('/requests', { ...car(['2026-12-02']), bayType: 'two_wheeler' })).body.error
        .code,
    ).toBe('NO_BAYS_OF_TYPE');
  });

  it('security staff cannot make requests', async () => {
    const security = await clientFor(ctx.app, 'security@parksmart.test');
    expect((await security.get('/requests')).status).toBe(403);
  });
});

describe('changing and withdrawing (FR-4)', () => {
  it('changes a request while its round has not run', async () => {
    const { id } = (await divya.post('/requests', car(['2026-12-02']))).body.items[0];
    const res = await divya.patch(`/requests/${id}`, {
      arrivalWindow: '9_to_11',
      reasonCategory: 'client_visit',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ arrivalWindow: '9_to_11', reasonCategory: 'client_visit' });
  });

  it('refuses changes once no round is left to decide it', async () => {
    const { id } = (await divya.post('/requests', car(['2026-11-25']))).body.items[0];
    now = ist('2026-11-25T17:30');
    const res = await divya.patch(`/requests/${id}`, { arrivalWindow: '9_to_11' });
    expect(res.status).toBe(409);
  });

  it('withdraws, and hides other people’s requests', async () => {
    const { id } = (await divya.post('/requests', car(['2026-12-02']))).body.items[0];
    expect((await arjun.delete(`/requests/${id}`)).status).toBe(404);
    expect((await divya.delete(`/requests/${id}`)).body.status).toBe('withdrawn');
    expect((await divya.delete(`/requests/${id}`)).status).toBe(409);
    // A fresh request for that day is allowed after withdrawing.
    expect((await divya.post('/requests', car(['2026-12-02']))).status).toBe(201);
  });

  it('cannot replace a request that already has a bay', async () => {
    const { id } = (await divya.post('/requests', car(['2026-12-02']))).body.items[0];
    ctx.db.update(requests).set({ status: 'allocated' }).where(eq(requests.id, id)).run();
    const res = await divya.post('/requests', car(['2026-12-02']));
    expect(res.body.error.code).toBe('ALREADY_DECIDED');
    expect((await divya.delete(`/requests/${id}`)).status).toBe(409);
  });
});

describe('calendar', () => {
  it('shows open days, the deciding round, my requests, my bay types and block notices', async () => {
    await divya.post('/requests', car(['2026-12-02']));
    const admin = await clientFor(ctx.app, 'admin@parksmart.test');
    const bay = (await admin.get('/admin/bays')).body.items[0];
    await admin.post('/admin/bay-blocks', {
      bayIds: [bay.id],
      dateFrom: '2026-12-03',
      dateTo: '2026-12-03',
      reason: 'Townhall: visitor parking',
    });
    const res = await divya.get('/requests/calendar?days=14');
    expect(res.status).toBe(200);
    const day = (date: string) => res.body.days.find((d: { date: string }) => d.date === date);
    expect(res.body.days).toHaveLength(14);
    expect(day('2026-11-25')).toMatchObject({ open: true, decidedBy: { round: 'same_day' } });
    expect(day('2026-11-28')).toMatchObject({ open: false, closedReason: 'NOT_WORKING_DAY' });
    expect(day('2026-12-02').request).toMatchObject({ status: 'requested', bayType: 'car' });
    expect(res.body.bayTypes).toEqual(['car', 'ev']);
    expect(res.body.eligibility).toEqual({ ev: true, accessibleThrough: null });
    expect(res.body.notices).toEqual([
      { dateFrom: '2026-12-03', dateTo: '2026-12-03', reason: 'Townhall: visitor parking' },
    ]);
  });
});

describe('recurring patterns (FR-3)', () => {
  const pattern = { weekdays: [2, 4], bayType: 'car', arrivalWindow: 'before_9' };
  const statusOn = (date: string) =>
    activeFor('divya@parksmart.test').find((r) => r.date === date) ?? null;

  it('feeds the next weekly round: creates requests for that week', async () => {
    const res = await divya.post('/recurring-patterns', pattern);
    expect(res.status).toBe(201);
    expect(statusOn('2026-12-01')).toMatchObject({
      status: 'requested',
      recurringPatternId: res.body.id,
    });
    expect(statusOn('2026-12-03')).toMatchObject({ status: 'requested' });
    // This week's weekly round has already run, so nothing is created for it.
    expect(statusOn('2026-11-26')).toBeNull();
    expect(
      res.body.upcoming.find((u: { date: string }) => u.date === '2026-12-01').requestStatus,
    ).toBe('requested');
    // Upcoming days start at the week the pattern can still feed, not this week.
    expect(res.body.upcoming[0].date).toBe('2026-12-01');
    expect(res.body.upcoming).toHaveLength(6);
  });

  it('manual requests win over the pattern', async () => {
    const manual = (
      await divya.post('/requests', { ...car(['2026-12-01']), arrivalWindow: 'after_13' })
    ).body.items[0];
    await divya.post('/recurring-patterns', pattern);
    expect(statusOn('2026-12-01')).toMatchObject({ id: manual.id, recurringPatternId: null });
  });

  it('refuses overlapping patterns and non-working days', async () => {
    await divya.post('/recurring-patterns', pattern);
    expect((await divya.post('/recurring-patterns', { ...pattern, weekdays: [4, 5] })).status).toBe(
      409,
    );
    expect(
      (await divya.post('/recurring-patterns', { ...pattern, weekdays: [6] })).body.error.code,
    ).toBe('NOT_WORKING_DAY');
  });

  it('a skip withdraws that day at once; un-skipping brings it back', async () => {
    const { id } = (await divya.post('/recurring-patterns', pattern)).body;
    const skipped = await divya.post(`/recurring-patterns/${id}/skips`, { date: '2026-12-03' });
    expect(
      skipped.body.upcoming.find((u: { date: string }) => u.date === '2026-12-03'),
    ).toMatchObject({
      skipped: true,
      requestStatus: null,
    });
    expect(statusOn('2026-12-03')).toBeNull();
    await divya.delete(`/recurring-patterns/${id}/skips/2026-12-03`);
    expect(statusOn('2026-12-03')).toMatchObject({ status: 'requested' });
  });

  it('withdrawing a pattern request counts as a skip, so edits do not bring it back', async () => {
    const { id } = (await divya.post('/recurring-patterns', pattern)).body;
    await divya.delete(`/requests/${statusOn('2026-12-01')!.id}`);
    await divya.patch(`/recurring-patterns/${id}`, { arrivalWindow: '9_to_11' });
    expect(statusOn('2026-12-01')).toBeNull();
    expect(statusOn('2026-12-03')).toMatchObject({ arrivalWindow: '9_to_11' });
  });

  it('deactivating a pattern withdraws its undecided requests', async () => {
    const { id } = (await divya.post('/recurring-patterns', pattern)).body;
    await divya.patch(`/recurring-patterns/${id}`, { active: false });
    expect(activeFor('divya@parksmart.test')).toHaveLength(0);
  });
});

describe('recurring-expand job', () => {
  it('expands each week once per site (idempotent), then moves to the next week', async () => {
    await divya.post('/recurring-patterns', {
      weekdays: [1],
      bayType: 'car',
      arrivalWindow: 'before_9',
    });
    // Pattern creation already fed Mon 30 Nov; the job claims the week and adds nothing new.
    const first = recurringExpandJob(ctx.db, now);
    expect(first[0]).toMatchObject({ week: '2026-11-30', created: 0 });
    expect(recurringExpandJob(ctx.db, now)[0]).toMatchObject({ created: null }); // already ran

    now = ist('2026-11-27T12:15'); // after Friday's weekly round: next target week is 7 Dec
    expect(recurringExpandJob(ctx.db, now)[0]).toMatchObject({ week: '2026-12-07', created: 1 });
    const keys = ctx.db
      .select()
      .from(jobRuns)
      .all()
      .map((j) => [j.jobKey.split(':').at(-1), j.status]);
    expect(keys).toEqual([
      ['2026-11-30', 'succeeded'],
      ['2026-12-07', 'succeeded'],
    ]);
    const mondays = activeFor('divya@parksmart.test')
      .map((r) => r.date)
      .sort();
    expect(mondays).toEqual(['2026-11-30', '2026-12-07']);
  });

  it('refuses an EV pattern for an employee without an EV', async () => {
    const res = await arjun.post('/recurring-patterns', {
      weekdays: [1],
      bayType: 'ev',
      arrivalWindow: 'before_9',
    });
    expect(res.body.error.code).toBe('NOT_EV');
    expect(
      ctx.db
        .select()
        .from(requests)
        .where(and(eq(requests.bayType, 'ev')))
        .all(),
    ).toHaveLength(0);
  });
});
