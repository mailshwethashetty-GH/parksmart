import { asc, type Db, eq, orgs, sites } from '@parksmart/db';

/**
 * Org and home site for a new SSO user, by email domain. Returns null for unknown
 * domains so sign-up is refused. v1 pilot: one site per org, so the first site is home.
 * `allowedEmails` (ALLOWED_EMAILS) are let in from any domain and join the first org.
 */
export async function resolveHomeForEmail(
  db: Db,
  email: string,
  allowedEmails: readonly string[] = [],
): Promise<{ orgId: string; siteId: string } | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const org =
    (await db.select().from(orgs).where(eq(orgs.emailDomain, domain)).get()) ??
    (allowedEmails.includes(email.toLowerCase())
      ? await db.select().from(orgs).orderBy(asc(orgs.createdAt)).get()
      : undefined);
  if (!org) return null;
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.orgId, org.id))
    .orderBy(asc(sites.createdAt))
    .get();
  return site ? { orgId: org.id, siteId: site.id } : null;
}
