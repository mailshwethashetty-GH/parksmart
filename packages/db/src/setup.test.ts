import { describe, expect, it } from 'vitest';
import { auditLog, orgs, policyVersions, rules, sites } from './schema';
import { seed } from './seed';
import { setupOrganisation } from './setup';
import { createTestDb } from './testing';

const opts = { orgName: 'Acme GCC', emailDomain: 'Acme.com', siteName: 'Bengaluru HQ' };

describe('first-run setup', () => {
  it('creates the org, its site and the default policy once', async () => {
    const db = await createTestDb();
    const now = new Date('2026-12-07T04:30:00Z');
    const out = await setupOrganisation(db, opts, now);
    expect(out.created).toBe(true);
    expect(await db.select().from(orgs).all()).toMatchObject([
      { name: 'Acme GCC', emailDomain: 'acme.com' },
    ]);
    expect(await db.select().from(sites).all()).toMatchObject([
      { name: 'Bengaluru HQ', timezone: 'Asia/Kolkata' },
    ]);
    expect(await db.select().from(policyVersions).all()).toMatchObject([
      { version: 1, effectiveFromWeek: '2026-12-07', publishedBy: null },
    ]);
    expect((await db.select().from(rules).all()).length).toBeGreaterThan(5);
    expect((await db.select().from(auditLog).all()).map((a) => a.action)).toEqual(['setup']);

    // Every later start is a no-op.
    expect(await setupOrganisation(db, { ...opts, orgName: 'Other' }, now)).toEqual({
      created: false,
    });
    expect(await db.select().from(orgs).all()).toHaveLength(1);
  });

  it('never touches a database that already has data', async () => {
    const db = await createTestDb();
    await seed(db);
    expect(await setupOrganisation(db, opts)).toEqual({ created: false });
  });
});
