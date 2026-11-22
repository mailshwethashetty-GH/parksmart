/**
 * Sample data for development: one org, one Bengaluru site with 150 car bays
 * (135 car, 10 EV, 5 accessible), a two-wheeler zone, users for every role and
 * the default policy (v1, published, effective from the current week).
 */
import { createId } from '@paralleldrive/cuid2';
import {
  DEFAULT_RULE_CATALOGUE,
  DEFAULT_TIMEZONE,
  describePolicy,
  siteLocalDate,
  weekStart,
  type BayType,
  type DistanceBand,
  type Role,
} from '@parksmart/shared';
import type { Db } from './client';
import * as s from './schema';

export const SEED_EMAIL_DOMAIN = 'parksmart.test';

type SeedUser = {
  name: string;
  local: string;
  role: Role;
  ev?: boolean;
  distance?: DistanceBand;
  clientFacing?: boolean;
  joinDate?: string;
};

const SEED_USERS: SeedUser[] = [
  { name: 'Meera Admin', local: 'admin', role: 'admin' },
  { name: 'Gate Security', local: 'security', role: 'security' },
  { name: 'Divya Employee', local: 'divya', role: 'employee', ev: true, distance: '10_25' },
  { name: 'Arjun Rao', local: 'arjun', role: 'employee', distance: 'gt_25', clientFacing: true },
  { name: 'Priya Iyer', local: 'priya', role: 'employee', joinDate: '2016-04-01' },
  { name: 'Karthik Menon', local: 'karthik', role: 'employee', ev: true },
  { name: 'Ananya Das', local: 'ananya', role: 'employee', distance: 'lt_10' },
  { name: 'Rahul Shetty', local: 'rahul', role: 'employee', clientFacing: true },
  { name: 'Sneha Kulkarni', local: 'sneha', role: 'employee', distance: '10_25' },
  { name: 'Vikram Singh', local: 'vikram', role: 'employee', joinDate: '2021-09-15' },
  { name: 'Lakshmi Narayan', local: 'lakshmi', role: 'employee', distance: 'gt_25' },
  { name: 'Farhan Ali', local: 'farhan', role: 'employee' },
];

export function isSeeded(db: Db): boolean {
  return db.select({ id: s.orgs.id }).from(s.orgs).limit(1).all().length > 0;
}

export function seed(db: Db, now = new Date()): { orgId: string; siteId: string } {
  return db.transaction((tx) => {
    const orgId = createId();
    const siteId = createId();

    tx.insert(s.orgs).values({ id: orgId, name: 'Demo GCC', emailDomain: SEED_EMAIL_DOMAIN }).run();
    tx.insert(s.sites)
      .values({
        id: siteId,
        orgId,
        name: 'Bengaluru HQ',
        timezone: DEFAULT_TIMEZONE,
        aiStage: 1,
        settingsJson: {},
      })
      .run();

    const zoneIds = { b1: createId(), b2: createId(), tw: createId() };
    tx.insert(s.zones)
      .values([
        { id: zoneIds.b1, orgId, siteId, name: 'Basement 1', kind: 'basement' },
        { id: zoneIds.b2, orgId, siteId, name: 'Basement 2', kind: 'basement' },
        { id: zoneIds.tw, orgId, siteId, name: 'Two-wheeler', kind: 'two_wheeler', capacity: 120 },
      ])
      .run();

    const bays: (typeof s.bays.$inferInsert)[] = [];
    const add = (zoneId: string, prefix: string, count: number, bayType: BayType) => {
      for (let i = 1; i <= count; i++) {
        bays.push({
          orgId,
          siteId,
          zoneId,
          code: `${prefix}-${String(i).padStart(3, '0')}`,
          bayType,
          hasCharger: bayType === 'ev',
        });
      }
    };
    add(zoneIds.b1, 'B1', 75, 'car');
    add(zoneIds.b1, 'B1-EV', 10, 'ev');
    add(zoneIds.b1, 'B1-AX', 5, 'accessible');
    add(zoneIds.b2, 'B2', 60, 'car');
    tx.insert(s.bays).values(bays).run();

    const userIds = new Map<string, string>();
    for (const u of SEED_USERS) {
      const userId = createId();
      userIds.set(u.local, userId);
      tx.insert(s.users)
        .values({
          id: userId,
          name: u.name,
          email: `${u.local}@${SEED_EMAIL_DOMAIN}`,
          emailVerified: true,
          orgId,
          siteId,
          role: u.role,
        })
        .run();
      if (u.role !== 'employee') continue;
      tx.insert(s.userProfiles)
        .values({
          userId,
          distanceBand: u.distance ?? null,
          clientFacing: u.clientFacing ?? null,
          joinDate: u.joinDate ?? null,
        })
        .run();
      tx.insert(s.vehicles)
        .values({ userId, type: 'car', isEv: u.ev ?? false })
        .run();
      tx.insert(s.consents).values({ userId, purpose: 'parking_allocation', grantedAt: now }).run();
    }

    const adminId = userIds.get('admin')!;
    const policyId = createId();
    const versionId = createId();
    tx.insert(s.policies).values({ id: policyId, orgId, siteId, name: 'Default policy' }).run();
    tx.insert(s.policyVersions)
      .values({
        id: versionId,
        policyId,
        version: 1,
        effectiveFromWeek: weekStart(siteLocalDate(now, DEFAULT_TIMEZONE)),
        publishedAt: now,
        publishedBy: adminId,
        plainLanguage: describePolicy(DEFAULT_RULE_CATALOGUE, {
          version: 1,
          effectiveFromWeek: weekStart(siteLocalDate(now, DEFAULT_TIMEZONE)),
        }),
      })
      .run();
    tx.insert(s.rules)
      .values(
        DEFAULT_RULE_CATALOGUE.map((r, order) => ({
          policyVersionId: versionId,
          ruleType: r.ruleType,
          key: r.key,
          label: r.label,
          configJson: r.config,
          weight: r.weight,
          order,
          enabled: r.enabled,
        })),
      )
      .run();

    tx.insert(s.auditLog)
      .values({
        siteId,
        actorId: null,
        action: 'seed',
        entity: 'site',
        entityId: siteId,
        afterJson: { bays: bays.length, users: SEED_USERS.length, policyVersion: 1 },
        reason: 'Development seed data',
        at: now,
      })
      .run();

    return { orgId, siteId };
  });
}
