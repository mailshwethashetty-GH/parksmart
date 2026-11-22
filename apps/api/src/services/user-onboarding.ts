import { orgs, sites, type Db } from '@parksmart/db';
import { asc, eq } from 'drizzle-orm';

/**
 * Org and home site for a new SSO user, by email domain. Returns null for unknown
 * domains so sign-up is refused. v1 pilot: one site per org, so the first site is home.
 */
export function resolveHomeForEmail(
  db: Db,
  email: string,
): { orgId: string; siteId: string } | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const org = db.select().from(orgs).where(eq(orgs.emailDomain, domain)).get();
  if (!org) return null;
  const site = db
    .select()
    .from(sites)
    .where(eq(sites.orgId, org.id))
    .orderBy(asc(sites.createdAt))
    .get();
  return site ? { orgId: org.id, siteId: site.id } : null;
}
