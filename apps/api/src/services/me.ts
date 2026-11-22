import { type Db, eq, orgs, sites, users } from '@parksmart/db';
import type { MeResponse } from '@parksmart/shared';
import { notFound } from '../lib/errors';

export function getMe(db: Db, userId: string): MeResponse {
  const row = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      orgId: orgs.id,
      orgName: orgs.name,
      siteId: sites.id,
      siteName: sites.name,
      timezone: sites.timezone,
    })
    .from(users)
    .innerJoin(orgs, eq(orgs.id, users.orgId))
    .innerJoin(sites, eq(sites.id, users.siteId))
    .where(eq(users.id, userId))
    .get();
  if (!row) throw notFound('User');
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    org: { id: row.orgId, name: row.orgName },
    site: { id: row.siteId, name: row.siteName, timezone: row.timezone },
  };
}
