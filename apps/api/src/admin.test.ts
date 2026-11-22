/** M2: site setup, approvals, policy versions and feasibility (FR-8, 9, 11, 12, 13, 26). */
import {
  and,
  auditLog,
  bays,
  eq,
  orgs,
  policyVersions,
  rules,
  sites,
  users,
  zones,
} from '@parksmart/db';
import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_SITE_SETTINGS, type RuleInput } from '@parksmart/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientFor, createTestApp } from './test-utils';

// Wed 25 Nov 2026, 10:00 IST. Next weekly round: Fri 27 Nov, allocating the week of 30 Nov.
const WED_MORNING = new Date('2026-11-25T04:30:00Z');

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;
let now: Date;
let admin: Awaited<ReturnType<typeof clientFor>>;
let employee: Awaited<ReturnType<typeof clientFor>>;

beforeEach(async () => {
  now = WED_MORNING;
  ctx = await createTestApp({}, { clock: () => now });
  admin = await clientFor(ctx.app, 'admin@parksmart.test');
  employee = await clientFor(ctx.app, 'divya@parksmart.test');
});
afterEach(async () => await ctx.app.close());

const auditActions = async () => (await ctx.db.select().from(auditLog).all()).map((a) => a.action);

describe('admin routes are admin-only and site-scoped', () => {
  it('employees get 403 on every admin area', async () => {
    for (const url of [
      '/admin/site',
      '/admin/zones',
      '/admin/bays',
      '/admin/approvals',
      '/admin/policy',
    ]) {
      expect((await employee.get(url)).status).toBe(403);
    }
  });

  it("an admin cannot change another site's bay", async () => {
    const orgId = createId();
    const siteId = createId();
    const zoneId = createId();
    const bayId = createId();
    await ctx.db.insert(orgs).values({ id: orgId, name: 'Other', emailDomain: 'other.test' }).run();
    await ctx.db
      .insert(sites)
      .values({ id: siteId, orgId, name: 'Other site', settingsJson: {} })
      .run();
    await ctx.db
      .insert(zones)
      .values({ id: zoneId, orgId, siteId, name: 'Z', kind: 'surface' })
      .run();
    await ctx.db
      .insert(bays)
      .values({ id: bayId, orgId, siteId, zoneId, code: 'X-1', bayType: 'car' })
      .run();
    const res = await admin.patch(`/admin/bays/${bayId}`, { active: false });
    expect(res.status).toBe(403);
    expect(
      (await admin.get('/admin/bays')).body.items.some((b: { id: string }) => b.id === bayId),
    ).toBe(false);
  });
});

describe('site settings (FR-26)', () => {
  it('returns settings with defaults and the next weekly round', async () => {
    const res = await admin.get('/admin/site');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Bengaluru HQ',
      timezone: 'Asia/Kolkata',
      settings: { graceMinutes: 15, sameDayPoolPercent: 10 },
      nextWeeklyRound: { targetWeek: '2026-11-30', runAt: '2026-11-27T06:30:00.000Z' },
    });
  });

  it('validates and audits changes', async () => {
    const bad = await admin.put('/admin/site/settings', {
      ...DEFAULT_SITE_SETTINGS,
      graceMinutes: 45,
    });
    expect(bad.status).toBe(400);
    const ok = await admin.put('/admin/site/settings', {
      ...DEFAULT_SITE_SETTINGS,
      sameDayPoolPercent: 15,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.sameDayPoolPercent).toBe(15);
    expect(await auditActions()).toContain('site.settings.update');
  });

  it('backup admins must be admins of this site', async () => {
    const divya = (await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, 'divya@parksmart.test'))
      .get())!;
    const res = await admin.put('/admin/site/settings', {
      ...DEFAULT_SITE_SETTINGS,
      backupAdminIds: [divya.id],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_BACKUP_ADMIN');
  });
});

describe('zones and bays (FR-26)', () => {
  it('creates zones and rejects duplicate names', async () => {
    const created = await admin.post('/admin/zones', { name: 'Basement 3', kind: 'basement' });
    expect(created.status).toBe(201);
    expect(
      (await admin.post('/admin/zones', { name: 'Basement 3', kind: 'basement' })).status,
    ).toBe(409);
  });

  it('bulk-creates bays with padded codes and rejects codes in use', async () => {
    const zone = (await admin.post('/admin/zones', { name: 'Basement 3', kind: 'basement' })).body;
    const res = await admin.post('/admin/bays/bulk', {
      zoneId: zone.id,
      prefix: 'B3',
      count: 3,
      bayType: 'ev',
    });
    expect(res.status).toBe(201);
    expect(res.body.items.map((b: { code: string }) => b.code)).toEqual([
      'B3-001',
      'B3-002',
      'B3-003',
    ]);
    expect(res.body.items.every((b: { hasCharger: boolean }) => b.hasCharger)).toBe(true);
    const again = await admin.post('/admin/bays/bulk', {
      zoneId: zone.id,
      prefix: 'B3',
      count: 2,
      bayType: 'car',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.details.codes).toEqual(['B3-001', 'B3-002']);
  });

  it('deactivating a bay removes it from the zone count, without deleting it', async () => {
    const before = (await admin.get('/admin/zones')).body.items.find(
      (z: { name: string }) => z.name === 'Basement 2',
    );
    const bay = (await admin.get(`/admin/bays?zoneId=${before.id}`)).body.items[0];
    expect((await admin.patch(`/admin/bays/${bay.id}`, { active: false })).body.active).toBe(false);
    const after = (await admin.get('/admin/zones')).body.items.find(
      (z: { name: string }) => z.name === 'Basement 2',
    );
    expect(after.bayCount).toBe(before.bayCount - 1);
    expect((await admin.get('/admin/bays')).body.items).toHaveLength(150);
  });
});

describe('bay blocks (FR-26)', () => {
  it('blocks bays for an event with a reason, then soft-deletes the block', async () => {
    const [b1, b2] = (await admin.get('/admin/bays')).body.items;
    const bad = await admin.post('/admin/bay-blocks', {
      bayIds: [b1.id],
      dateFrom: '2026-12-03',
      dateTo: '2026-12-02',
      reason: 'Townhall',
    });
    expect(bad.status).toBe(400);
    const created = await admin.post('/admin/bay-blocks', {
      bayIds: [b1.id, b2.id],
      dateFrom: '2026-12-03',
      dateTo: '2026-12-03',
      reason: 'Townhall: visitor parking',
    });
    expect(created.status).toBe(201);
    expect(created.body.items).toHaveLength(2);
    const listed = await admin.get('/admin/bay-blocks?from=2026-12-01&to=2026-12-05');
    expect(listed.body.items.map((b: { bayCode: string }) => b.bayCode).sort()).toEqual(
      [b1.code, b2.code].sort(),
    );
    expect((await admin.delete(`/admin/bay-blocks/${created.body.items[0].id}`)).status).toBe(200);
    expect((await admin.get('/admin/bay-blocks')).body.items).toHaveLength(1);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['bay_block.create', 'bay_block.delete']),
    );
  });

  it('a block targets either bays or a zone, not both', async () => {
    const zone = (await admin.get('/admin/zones')).body.items[0];
    const bay = (await admin.get('/admin/bays')).body.items[0];
    const res = await admin.post('/admin/bay-blocks', {
      bayIds: [bay.id],
      zoneId: zone.id,
      dateFrom: '2026-12-03',
      dateTo: '2026-12-03',
      reason: 'Event',
    });
    expect(res.status).toBe(400);
  });
});

describe('roles (FR-29)', () => {
  const userId = async (email: string) =>
    (await ctx.db.select().from(users).where(eq(users.email, email)).get())!.id;

  it('makes someone security staff, with a reason in the audit log', async () => {
    const vikram = await userId('vikram@parksmart.test');
    const res = await admin.patch(`/admin/users/${vikram}/role`, {
      role: 'security',
      reason: 'Joins the gate team',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'security' });
    const gate = await clientFor(ctx.app, 'vikram@parksmart.test');
    expect((await gate.get('/gate/today')).status).toBe(200);
    const entry = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'user.role'))
      .get();
    expect(entry).toMatchObject({
      entityId: vikram,
      beforeJson: { role: 'employee' },
      afterJson: { role: 'security' },
      reason: 'Joins the gate team',
    });
  });

  it('needs a reason, an admin, and never the admin themself', async () => {
    const vikram = await userId('vikram@parksmart.test');
    expect((await admin.patch(`/admin/users/${vikram}/role`, { role: 'admin' })).status).toBe(400);
    expect(
      (await employee.patch(`/admin/users/${vikram}/role`, { role: 'admin', reason: 'Promote me' }))
        .status,
    ).toBe(403);
    const self = await admin.patch(`/admin/users/${await userId('admin@parksmart.test')}/role`, {
      role: 'employee',
      reason: 'Stepping down',
    });
    expect(self.body.error.code).toBe('OWN_ROLE');
  });
});

describe('accessible approvals (FR-13)', () => {
  const userId = async (email: string) =>
    (await ctx.db.select().from(users).where(eq(users.email, email)).get())!.id;

  it('approves with an expiry, refuses duplicates and non-employees, and revokes', async () => {
    const priya = await userId('priya@parksmart.test');
    const created = await admin.post('/admin/approvals', {
      userId: priya,
      expiresOn: '2026-12-31',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      expiresOn: '2026-12-31',
      active: true,
      kind: 'accessible',
    });
    expect(
      (await admin.post('/admin/approvals', { userId: priya, expiresOn: '2027-01-31' })).status,
    ).toBe(409);
    const forAdmin = await admin.post('/admin/approvals', {
      userId: await userId('admin@parksmart.test'),
      expiresOn: '2026-12-31',
    });
    expect(forAdmin.body.error.code).toBe('APPROVAL_NOT_EMPLOYEE');
    const revoked = await admin.post(`/admin/approvals/${created.body.id}/revoke`);
    expect(revoked.body.active).toBe(false);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['approval.create', 'approval.revoke']),
    );
  });

  it('refuses an expiry in the past', async () => {
    const res = await admin.post('/admin/approvals', {
      userId: await userId('priya@parksmart.test'),
      expiresOn: '2026-11-24',
    });
    expect(res.body.error.code).toBe('APPROVAL_EXPIRY_PAST');
  });
});

describe('policy versions (FR-8, FR-9, FR-12)', () => {
  async function draftWith(edit: (rules: RuleInput[]) => RuleInput[]) {
    const draft = (await admin.post('/admin/policy/versions')).body;
    const res = await admin.put(`/admin/policy/versions/${draft.version}/rules`, {
      rules: edit(draft.rules),
    });
    expect(res.status).toBe(200);
    return res.body;
  }
  const setRule = (key: string, patch: Partial<RuleInput>) => (rules: RuleInput[]) =>
    rules.map((r) => (r.key === key ? { ...r, ...patch } : r));

  it('v1 from the seed is active and employees can read it in plain language', async () => {
    const policy = await admin.get('/admin/policy');
    expect(policy.body.versions).toEqual([
      expect.objectContaining({ version: 1, status: 'active' }),
    ]);
    const current = await employee.get('/policy/current');
    expect(current.status).toBe(200);
    expect(current.body.version).toBe(1);
    expect(current.body.plainLanguage).toContain('Booking early gives no advantage');
  });

  it('creates one draft at a time, copying the latest rules', async () => {
    const draft = await admin.post('/admin/policy/versions');
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ version: 2, status: 'draft', issues: [] });
    expect(draft.body.rules).toHaveLength(11);
    expect((await admin.post('/admin/policy/versions')).status).toBe(409);
  });

  it('rejects invalid rule config at the edge (400)', async () => {
    const draft = (await admin.post('/admin/policy/versions')).body;
    const rules = setRule('rolling_fairness', { config: { lookbackWeeks: 99 } })(draft.rules);
    expect((await admin.put('/admin/policy/versions/2/rules', { rules })).status).toBe(400);
  });

  it('weights not totalling 100% are shown as issues and block publishing', async () => {
    const draft = await draftWith(setRule('seniority', { weight: 15 }));
    expect(draft.issues.map((i: { code: string }) => i.code)).toContain('POLICY_WEIGHTS_INVALID');
    const res = await admin.post('/admin/policy/versions/2/publish', { reason: 'Try it' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('POLICY_WEIGHTS_INVALID');
  });

  it('publishing needs a reason', async () => {
    await admin.post('/admin/policy/versions');
    expect((await admin.post('/admin/policy/versions/2/publish', {})).status).toBe(400);
  });

  it('publishes from the next weekly round, never mid-round (non-negotiable #8)', async () => {
    await draftWith(setRule('rolling_fairness', { weight: 40 }));
    await admin.put('/admin/policy/versions/2/rules', {
      rules: setRule('seniority', { weight: 0 })(
        (await admin.get('/admin/policy/versions/2')).body.rules,
      ),
    });
    const published = await admin.post('/admin/policy/versions/2/publish', {
      reason: 'More weight on fairness',
    });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: 'scheduled', effectiveFromWeek: '2026-11-30' });
    expect(published.body.plainLanguage).toContain('in force from the week of 30 Nov 2026');

    // Still v1 this week.
    expect((await employee.get('/policy/current')).body.version).toBe(1);
    // Published versions are immutable.
    expect(
      (await admin.put('/admin/policy/versions/2/rules', { rules: published.body.rules })).status,
    ).toBe(409);
    const audit = (await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'policy.publish'))
      .get())!;
    expect(audit.reason).toBe('More weight on fairness');

    // Next Monday, v2 is in force and v1 is superseded.
    now = new Date('2026-11-30T03:00:00Z');
    expect((await employee.get('/policy/current')).body.version).toBe(2);
    const statuses = (await admin.get('/admin/policy')).body.versions.map(
      (v: { version: number; status: string }) => [v.version, v.status],
    );
    expect(statuses).toEqual([
      [2, 'active'],
      [1, 'superseded'],
    ]);
  });

  it('once the Friday weekly round has run, a policy waits for the week after next', async () => {
    now = new Date('2026-11-27T07:00:00Z'); // Fri 12:30 IST
    await admin.post('/admin/policy/versions');
    const published = await admin.post('/admin/policy/versions/2/publish', { reason: 'No change' });
    expect(published.body.effectiveFromWeek).toBe('2026-12-07');
  });

  it('discards a draft', async () => {
    await admin.post('/admin/policy/versions');
    expect((await admin.delete('/admin/policy/versions/2')).status).toBe(200);
    expect((await admin.get('/admin/policy')).body.versions).toHaveLength(1);
    expect((await admin.delete('/admin/policy/versions/1')).status).toBe(409);
  });
});

describe('feasibility checks (FR-11)', () => {
  const rulesOfV1 = async () =>
    (await admin.get('/admin/policy/versions/1')).body.rules as RuleInput[];
  const feasibility = async (rules: RuleInput[]) =>
    (await admin.post('/admin/rules/feasibility', { rules })).body;
  const issuesFor = (body: { items: { key: string; issues: { code: string }[] }[] }, key: string) =>
    body.items.find((i) => i.key === key)!.issues.map((i) => i.code);

  it('reports coverage, privacy class and gaming risk for the default policy', async () => {
    const body = await feasibility(await rulesOfV1());
    expect(body.blocking).toBe(false);
    const distance = body.items.find((i: { key: string }) => i.key === 'commute_distance');
    // 5 of 10 seeded employees gave a distance band.
    expect(distance).toMatchObject({
      coverage: 0.5,
      employeesWithData: 5,
      activeEmployees: 10,
      privacyClass: 'personal',
    });
    expect(issuesFor(body, 'commute_distance')).toContain('COVERAGE_LOW');
    expect(issuesFor(body, 'business_need')).toContain('SELF_DECLARED');
    expect(
      body.items.find((i: { key: string }) => i.key === 'accessibility_reservation').privacyClass,
    ).toBe('sensitive');
  });

  it('blocks low coverage without a neutral value', async () => {
    const rules = (await rulesOfV1()).map((r) =>
      r.key === 'commute_distance'
        ? { ...r, config: { values: { lt_10: 0, '10_25': 0.5, gt_25: 1 } } }
        : r,
    );
    const body = await feasibility(rules);
    expect(body.blocking).toBe(true);
    expect(issuesFor(body, 'commute_distance')).toContain('COVERAGE_LOW_NO_NEUTRAL');

    await admin.post('/admin/policy/versions');
    await admin.put('/admin/policy/versions/2/rules', { rules });
    const res = await admin.post('/admin/policy/versions/2/publish', { reason: 'Try' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RULE_FEASIBILITY_BLOCKED');
  });

  it('self-declared business need needs a spot-check rate', async () => {
    const rules = (await rulesOfV1()).map((r) =>
      r.key === 'business_need' ? { ...r, config: { values: { client_visit: 1 }, missing: 0 } } : r,
    );
    expect(issuesFor(await feasibility(rules), 'business_need')).toContain('SPOT_CHECK_REQUIRED');
  });

  it('rules stored under an older schema still load, and show the problem instead of a 500', async () => {
    const v1 = (await ctx.db.select().from(policyVersions).get())!;
    await ctx.db
      .update(rules)
      .set({ configJson: { approvalKind: 'accessible' } }) // saved before `purpose` existed
      .where(and(eq(rules.policyVersionId, v1.id), eq(rules.key, 'accessibility_reservation')))
      .run();
    const res = await admin.get('/admin/policy/versions/1');
    expect(res.status).toBe(200);
    expect(issuesFor(await feasibility(res.body.rules), 'accessibility_reservation')).toContain(
      'PURPOSE_REQUIRED',
    );
  });

  it('sensitive data needs a stated purpose', async () => {
    const rules = (await rulesOfV1()).map((r) =>
      r.key === 'accessibility_reservation'
        ? { ...r, config: { approvalKind: 'accessible', purpose: ' ' } }
        : r,
    );
    expect(issuesFor(await feasibility(rules), 'accessibility_reservation')).toContain(
      'PURPOSE_REQUIRED',
    );
  });
});
