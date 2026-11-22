/** Site and site settings (FR-26). */
import { and, type Db, eq, inArray, sites, users } from '@parksmart/db';
import {
  nextWeeklyRound,
  parseSiteSettings,
  type SiteResponse,
  type SiteSettings,
} from '@parksmart/shared';
import { businessRule, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { writeAudit } from './audit';

export function loadSite(db: Db, siteId: string) {
  const site = db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site) throw notFound('Site');
  return { ...site, settings: parseSiteSettings(site.settingsJson) };
}

export function getSite(db: Db, siteId: string, now: Date): SiteResponse {
  const site = loadSite(db, siteId);
  const next = nextWeeklyRound(now, site.timezone, site.settings.rounds.weekly);
  return {
    id: site.id,
    name: site.name,
    timezone: site.timezone,
    aiStage: site.aiStage,
    settings: site.settings,
    nextWeeklyRound: { runAt: next.runAt.toISOString(), targetWeek: next.targetWeek },
  };
}

export function updateSiteSettings(
  db: Db,
  actor: Actor,
  settings: SiteSettings,
  now: Date,
): SiteResponse {
  const before = loadSite(db, actor.siteId);
  if (settings.backupAdminIds.length > 0) {
    const admins = db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.siteId, actor.siteId),
          eq(users.role, 'admin'),
          eq(users.active, true),
          inArray(users.id, settings.backupAdminIds),
        ),
      )
      .all();
    if (admins.length !== new Set(settings.backupAdminIds).size) {
      throw businessRule(
        'INVALID_BACKUP_ADMIN',
        'Backup admins must be active admins of this site.',
      );
    }
  }
  db.transaction((tx) => {
    tx.update(sites).set({ settingsJson: settings }).where(eq(sites.id, actor.siteId)).run();
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'site.settings.update',
        entity: 'site',
        entityId: actor.siteId,
        before: before.settings,
        after: settings,
      },
      now,
    );
  });
  return getSite(db, actor.siteId, now);
}
