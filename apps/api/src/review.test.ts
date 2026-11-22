/** M5: reasons, round review and overrides, AI rewrites, cancellation, audit, live stream. */
import {
  aiLogs,
  allocations,
  auditLog,
  bays,
  bookings,
  eq,
  notInArray,
  overrides,
  requests,
  rounds,
  sites,
  users,
} from '@parksmart/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiClient, ReasonRewriteInput } from './ai/client';
import { acceptable, keepsFacts, rewriteRoundReasons } from './ai/reasons';
import { roundJobs } from './jobs/round-jobs';
import { MAX_REASON_WORDS, wordCount } from './services/reasons';
import { clientFor, createTestApp, findAsync } from './test-utils';

const ist = (local: string) => new Date(`${local}:00+05:30`);
type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Client = Awaited<ReturnType<typeof clientFor>>;
let ctx: Ctx;
let now: Date;
let admin: Client;
const c: Record<string, Client> = {};
const NAMES = ['divya', 'arjun', 'priya', 'karthik'];

async function setup(ai: AiClient | null = null) {
  now = ist('2026-11-25T10:00');
  ctx = await createTestApp({}, { clock: () => now, ai });
  await ctx.db
    .update(sites)
    .set({ settingsJson: { sameDayPoolPercent: 0 } })
    .run();
  await ctx.db
    .update(bays)
    .set({ active: false })
    .where(notInArray(bays.code, ['B1-001', 'B1-002', 'B1-EV-001']))
    .run();
  admin = await clientFor(ctx.app, 'admin@parksmart.test');
  for (const n of NAMES) c[n] = await clientFor(ctx.app, `${n}@parksmart.test`);
}
afterEach(async () => await ctx.app.close());

const run = async (at: string) => {
  now = ist(at);
  return await roundJobs(ctx.db, now);
};
async function weeklyRoundForTuesday() {
  for (const n of NAMES) {
    await c[n]!.post('/requests', {
      dates: ['2026-12-01'],
      bayType: 'car',
      arrivalWindow: 'before_9',
      reasonCategory: 'medical_appointment',
    });
  }
  await run('2026-11-27T12:00');
  return (await ctx.db.select().from(rounds).get())!;
}
const userId = async (n: string) =>
  (await ctx.db
    .select()
    .from(users)
    .where(eq(users.email, `${n}@parksmart.test`))
    .get())!.id;
const mine = async (n: string) =>
  ((await c[n]!.get('/requests')).body.items as Record<string, unknown>[]).find(
    (r) => r.date === '2026-12-01',
  )!;

describe('plain-language reasons (FR-15)', () => {
  beforeEach(async () => await setup());

  it('every decision gets a template reason under 40 words, with the bay or waitlist place', async () => {
    const round = await weeklyRoundForTuesday();
    const rows = await ctx.db
      .select()
      .from(allocations)
      .where(eq(allocations.roundId, round.id))
      .all();
    for (const a of rows) {
      expect(wordCount(a.reasonText!)).toBeLessThan(MAX_REASON_WORDS);
      if (a.outcome === 'confirmed')
        expect(a.reasonText).toMatch(/You have bay B1-00[12] on Tue 1 Dec/);
      else expect(a.reasonText).toMatch(/so you are on the waitlist\. Your score ranked [34] of 4/);
    }
  });

  it('employees see the reason and their bay once the round is published', async () => {
    await weeklyRoundForTuesday();
    expect((await mine('divya')).reason).toBeNull(); // not published yet
    await run('2026-11-30T07:00');
    const confirmed = [];
    for (const n of NAMES) {
      const r = await mine(n);
      expect(r.reason).toEqual(expect.any(String));
      if (r.status === 'allocated') confirmed.push(r);
    }
    expect(confirmed).toHaveLength(2);
    expect(confirmed[0]!.booking).toMatchObject({
      bayCode: expect.stringMatching(/^B1-00[12]$/),
      zoneName: 'Basement 1',
    });
  });
});

describe('round review, overrides and approval (FR-16)', () => {
  beforeEach(async () => await setup());

  it('shows every decision with names, factors, reasons and free bays', async () => {
    const round = await weeklyRoundForTuesday();
    const res = await admin.get(`/admin/rounds/${round.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'pending_review',
      policyVersion: 1,
      seed: round.seed,
    });
    expect(res.body.decisions).toHaveLength(4);
    expect(res.body.decisions[0]).toMatchObject({
      rank: 1,
      outcome: 'confirmed',
      employee: { name: expect.any(String) },
      factors: expect.arrayContaining([
        expect.objectContaining({ key: 'rolling_fairness', weight: 35 }),
      ]),
    });
    // Both car bays are taken in this round; only the EV bay is free.
    expect(res.body.freeBays).toEqual([
      { date: '2026-12-01', bays: [expect.objectContaining({ code: 'B1-EV-001' })] },
    ]);
  });

  it('overrides need a reason, never over-book, and are audited; approval publishes them', async () => {
    const round = await weeklyRoundForTuesday();
    const detail = (await admin.get(`/admin/rounds/${round.id}`)).body;
    const winner = detail.decisions.find((d: { outcome: string }) => d.outcome === 'confirmed');
    const loser = detail.decisions.find((d: { outcome: string }) => d.outcome === 'waitlisted');

    expect(
      (
        await admin.post(`/admin/allocations/${loser.allocationId}/override`, {
          action: 'waitlist',
          reason: 'x',
        })
      ).status,
    ).toBe(400);
    // Assigning a bay someone else holds in this round is refused.
    const taken = await admin.post(`/admin/allocations/${loser.allocationId}/override`, {
      action: 'assign',
      bayId: winner.bayId,
      reason: 'Client visit confirmed by manager',
    });
    expect(taken.body.error.code).toBe('BAY_NOT_FREE');

    // Free a bay, then give it to the person on the waitlist.
    expect(
      (
        await admin.post(`/admin/allocations/${winner.allocationId}/override`, {
          action: 'waitlist',
          reason: 'Asked to give up the bay',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.post(`/admin/allocations/${loser.allocationId}/override`, {
          action: 'assign',
          bayId: winner.bayId,
          reason: 'Client visit confirmed by manager',
        })
      ).status,
    ).toBe(200);
    const after = (await admin.get(`/admin/rounds/${round.id}`)).body.decisions;
    expect(
      after.find((d: { allocationId: string }) => d.allocationId === loser.allocationId),
    ).toMatchObject({
      outcome: 'confirmed',
      overridden: true,
      reasonText: expect.stringContaining('Your parking admin assigned you bay'),
    });
    expect(await ctx.db.select().from(overrides).all()).toHaveLength(2);
    expect(
      (
        await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'allocation.override')).all()
      ).map((a) => a.reason),
    ).toEqual(
      expect.arrayContaining(['Client visit confirmed by manager', 'Asked to give up the bay']),
    );

    const approved = await admin.post(`/admin/rounds/${round.id}/approve`, { note: 'Looks right' });
    expect(approved.body).toMatchObject({ status: 'published', publishMode: 'admin' });
    expect((await ctx.db.select().from(rounds).get())!.approvedBy).toBe(await userId('admin'));
    const held = await ctx.db.select().from(bookings).where(eq(bookings.date, '2026-12-01')).all();
    expect(held.map((b) => b.userId)).toContain(
      (await ctx.db.select().from(requests).where(eq(requests.id, loser.requestId)).get())!.userId,
    );
    expect(new Set(held.map((b) => b.bayId)).size).toBe(held.length);

    // Published rounds can't be overridden or approved again.
    expect(
      (
        await admin.post(`/admin/allocations/${loser.allocationId}/override`, {
          action: 'waitlist',
          reason: 'Too late now',
        })
      ).status,
    ).toBe(409);
    expect((await admin.post(`/admin/rounds/${round.id}/approve`, {})).status).toBe(409);
  });

  it('employees cannot see or approve rounds', async () => {
    const round = await weeklyRoundForTuesday();
    expect((await c.divya!.get(`/admin/rounds/${round.id}`)).status).toBe(403);
    expect((await c.divya!.post(`/admin/rounds/${round.id}/approve`, {})).status).toBe(403);
  });
});

describe('AI-written reasons (FR-15, stage 1)', () => {
  const calls: ReasonRewriteInput[] = [];
  const fake = (respond: (i: ReasonRewriteInput) => string | Error): AiClient => ({
    model: 'fake-model',
    async rewriteReason(input) {
      calls.push(input);
      const out = respond(input);
      if (out instanceof Error) throw out;
      return { text: out, stopReason: 'end_turn' };
    },
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it('rewrites reasons that keep every fact, logs every call, and sends no personal data', async () => {
    await setup(fake((i) => `Good news: ${i.template.replace('You have', 'you have')}`));
    const round = await weeklyRoundForTuesday();
    const summary = await rewriteRoundReasons(ctx.db, ctx.app.ai, round.id);
    expect(summary).toMatchObject({ status: 'done', attempted: 4, rewritten: 4, failed: 0 });
    const a = await ctx.db
      .select()
      .from(allocations)
      .where(eq(allocations.roundId, round.id))
      .all();
    expect(a.every((x) => x.reasonText!.startsWith('Good news:'))).toBe(true);
    expect(await ctx.db.select().from(aiLogs).all()).toHaveLength(4);
    // Non-negotiable #7: no names, ids, emails or medical signals leave the server.
    const sent = JSON.stringify(calls);
    for (const n of NAMES) expect(sent.toLowerCase()).not.toContain(n);
    expect(sent).not.toContain(await userId('divya'));
    expect(sent).not.toMatch(/medical|parksmart\.test/);
  });

  it('keeps the template when a rewrite is too long, drops a fact, or the call fails', async () => {
    let i = 0;
    await setup(
      fake((input) => {
        i++;
        if (i === 1) return 'word '.repeat(45);
        if (i === 2) return 'You have a bay on Tuesday.'; // lost the bay code and numbers
        if (i === 3) return new Error('connection reset');
        return input.template;
      }),
    );
    const round = await weeklyRoundForTuesday();
    const before = await ctx.db
      .select()
      .from(allocations)
      .where(eq(allocations.roundId, round.id))
      .all();
    const summary = await rewriteRoundReasons(ctx.db, ctx.app.ai, round.id, { concurrency: 1 });
    expect(summary).toMatchObject({ rewritten: 1, failed: 1 });
    const after = await ctx.db
      .select()
      .from(allocations)
      .where(eq(allocations.roundId, round.id))
      .all();
    expect(after.map((x) => x.reasonText).sort()).toEqual(before.map((x) => x.reasonText).sort());
    const logs = await ctx.db.select().from(aiLogs).all();
    expect(logs).toHaveLength(4);
    expect(logs.filter((l) => l.error)).toHaveLength(1);
  });

  it('is skipped without a key, when the AI stage is off, and for sensitive reasons', async () => {
    await setup(null);
    expect(await rewriteRoundReasons(ctx.db, null, 'x')).toEqual({
      status: 'skipped',
      reason: 'NO_AI',
    });
    await ctx.app.close();
    await setup(fake((input) => input.template));
    const round = await weeklyRoundForTuesday();
    await ctx.db.update(sites).set({ aiStage: 0 }).run();
    expect(await rewriteRoundReasons(ctx.db, ctx.app.ai, round.id)).toEqual({
      status: 'skipped',
      reason: 'AI_STAGE',
    });
    await ctx.db.update(sites).set({ aiStage: 1 }).run();
    await ctx.db
      .update(allocations)
      .set({
        scoreBreakdownJson: {
          date: '2026-12-01',
          reasonCode: 'accessible_not_approved',
          factors: [],
        },
      })
      .where(eq(allocations.roundId, round.id))
      .run();
    expect(await rewriteRoundReasons(ctx.db, ctx.app.ai, round.id)).toMatchObject({ attempted: 0 });
  });

  it('fact checks catch dropped bay codes and numbers', () => {
    const t = 'You have bay B1-EV-001 on Tue 1 Dec. Your score ranked 2 of 14.';
    expect(keepsFacts(t, 'Bay B1-EV-001 is yours on Tuesday 1 Dec — you ranked 2 of 14.')).toBe(
      true,
    );
    expect(keepsFacts(t, 'Bay B1-EV-001 is yours on Tuesday — you ranked 2 of 14.')).toBe(false);
    expect(acceptable(t, null)).toBe(false);
  });
});

describe('cancelling a booking (FR-4)', () => {
  beforeEach(async () => await setup());

  it('frees the bay, ends the request, is audited, and re-offers it at once on the day', async () => {
    await weeklyRoundForTuesday();
    await run('2026-11-30T07:00');
    const holder = (await findAsync(
      NAMES,
      async (n) =>
        await ctx.db
          .select()
          .from(bookings)
          .where(eq(bookings.userId, await userId(n)))
          .get(),
    ))!;
    const bookingId = ((await mine(holder)).booking as { id: string }).id;
    const other = NAMES.find((n) => n !== holder)!;
    expect((await c[other]!.post(`/bookings/${bookingId}/cancel`, {})).status).toBe(404);

    now = ist('2026-12-01T08:05'); // the day itself, during same-day rounds
    expect((await c[holder]!.post(`/bookings/${bookingId}/cancel`, {})).status).toBe(200);
    expect(
      (await ctx.db.select().from(bookings).where(eq(bookings.id, bookingId)).get())!.status,
    ).toBe('cancelled');
    expect(
      await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'booking.cancel')).all(),
    ).toHaveLength(1);
    const offered = await Promise.all(
      NAMES.filter((n) => n !== holder).map(async (n) => (await mine(n))?.offer),
    );
    expect(offered.filter(Boolean)).toHaveLength(1);
    expect((await c[holder]!.post(`/bookings/${bookingId}/cancel`, {})).status).toBe(409);
  });
});

describe('audit log (FR-16)', () => {
  beforeEach(async () => await setup());

  it('filters by action, pages with a cursor, and exports safe CSV', async () => {
    const draft = await admin.post('/admin/policy/versions');
    expect(draft.status).toBe(201);
    await admin.post('/admin/bay-blocks', {
      bayIds: [(await ctx.db.select().from(bays).get())!.id],
      dateFrom: '2026-12-03',
      dateTo: '2026-12-03',
      reason: '=HYPERLINK("http://evil")',
    });
    const all = await admin.get('/admin/audit?limit=2');
    expect(all.body.items).toHaveLength(2);
    expect(all.body.nextCursor).toEqual(expect.any(String));
    const next = await admin.get(`/admin/audit?limit=2&cursor=${all.body.nextCursor}`);
    expect(next.body.items[0].id).not.toBe(all.body.items[0].id);
    const policy = await admin.get('/admin/audit?action=policy');
    expect(policy.body.items.map((e: { action: string }) => e.action)).toEqual([
      'policy.draft.create',
    ]);
    expect(policy.body.items[0].actor).toMatchObject({ name: 'Meera Admin' });

    const csv = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit/export?action=bay_block',
      headers: { cookie: admin.cookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const [header, row] = csv.body.trim().split('\n');
    expect(header).toBe('at,actor,action,entity,entity_id,reason,before,after');
    // Spreadsheet formula injection is neutralised.
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/audit/export' })).statusCode,
    ).toBe(401);
    expect((await c.divya!.get('/admin/audit')).status).toBe(403);
  });
});

describe('live updates (FR-20)', () => {
  beforeEach(async () => await setup());

  it('streams a "requests" event to the affected employee', async () => {
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const login = await fetch(`${address}/api/v1/auth/dev/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ email: 'divya@parksmart.test' }),
    });
    const cookie = login.headers
      .getSetCookie()
      .map((x) => x.split(';')[0])
      .join('; ');
    const abort = new AbortController();
    const res = await fetch(`${address}/api/v1/stream/me`, {
      headers: { cookie },
      signal: abort.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };
    await readUntil('event: ready');
    ctx.app.events.notifyUsers([await userId('arjun')]); // someone else: nothing for Divya
    ctx.app.events.notifyUsers([await userId('divya')]);
    await readUntil('event: requests');
    expect(text.match(/event: requests/g)).toHaveLength(1);
    abort.abort();
  });
});
