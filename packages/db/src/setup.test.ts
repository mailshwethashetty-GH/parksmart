import { describe, expect, it } from 'vitest';
import { auditLog, orgs, policyVersions, rules, sites } from './schema';
import { seed } from './seed';
import { setupOrganisation } from './setup';
import { createTestDb } from './testing';

const opts = { orgName: 'Acme GCC', emailDomain: 'Acme.com', siteName: 'Bengaluru HQ' };

describe('first-run setup', () => {
  it('creates the org, its site and the default policy once', () => {
    const db = createTestDb();
    const now = new Date('2026-12-07T04:30:00Z');
    const out = setupOrganisation(db, opts, now);
    expect(out.created).toBe(true);
    expect(db.select().from(orgs).all()).toMatchObject([
      { name: 'Acme GCC', emailDomain: 'acme.com' },
    ]);
    expect(db.select().from(sites).all()).toMatchObject([
      { name: 'Bengaluru HQ', timezone: 'Asia/Kolkata' },
    ]);
    expect(db.select().from(policyVersions).all()).toMatchObject([
      { version: 1, effectiveFromWeek: '2026-12-07', publishedBy: null },
    ]);
    expect(db.select().from(rules).all().length).toBeGreaterThan(5);
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .map((a) => a.action),
    ).toEqual(['setup']);

    // Every later start is a no-op.
    expect(setupOrganisation(db, { ...opts, orgName: 'Other' }, now)).toEqual({ created: false });
    expect(db.select().from(orgs).all()).toHaveLength(1);
  });

  it('never touches a database that already has data', () => {
    const db = createTestDb();
    seed(db);
    expect(setupOrganisation(db, opts)).toEqual({ created: false });
  });
});
