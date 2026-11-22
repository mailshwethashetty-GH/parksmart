/**
 * First-run setup for a real deployment (M8). `db:seed` is sample data only; production
 * starts empty and needs one org (matched to SSO users by email domain), its pilot site
 * and the default policy. Runs only when the database has no org, so it is safe to call
 * on every start. Bays are added by the admin afterwards (Site setup).
 */
import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_TIMEZONE } from '@parksmart/shared';
import type { Db } from './client';
import * as s from './schema';
import { insertDefaultPolicy, isSeeded } from './seed';

export type SetupOptions = {
  orgName: string;
  emailDomain: string;
  siteName: string;
  timezone?: string;
};

export function setupOrganisation(
  db: Db,
  opts: SetupOptions,
  now = new Date(),
): { created: false } | { created: true; orgId: string; siteId: string } {
  if (isSeeded(db)) return { created: false };
  return db.transaction((tx) => {
    const orgId = createId();
    const siteId = createId();
    const timezone = opts.timezone ?? DEFAULT_TIMEZONE;
    tx.insert(s.orgs)
      .values({ id: orgId, name: opts.orgName, emailDomain: opts.emailDomain.toLowerCase() })
      .run();
    tx.insert(s.sites)
      .values({ id: siteId, orgId, name: opts.siteName, timezone, aiStage: 1, settingsJson: {} })
      .run();
    const versionId = insertDefaultPolicy(tx, { orgId, siteId, publishedBy: null, now, timezone });
    tx.insert(s.auditLog)
      .values({
        siteId,
        actorId: null,
        action: 'setup',
        entity: 'site',
        entityId: siteId,
        afterJson: { org: opts.orgName, emailDomain: opts.emailDomain, policyVersionId: versionId },
        reason: 'First-run setup from the environment',
        at: now,
      })
      .run();
    return { created: true as const, orgId, siteId };
  });
}
