/**
 * recurring-expand (docs/06): create requests from recurring patterns for the week the
 * next weekly round will allocate. Runs on a schedule; keyed per site and week, so each
 * week is expanded once. Pattern changes in between expand themselves straight away.
 */
import { sites, type Db } from '@parksmart/db';
import { nextWeeklyRound, parseSiteSettings } from '@parksmart/shared';
import { expandPatterns } from '../services/recurring';
import { runOnce } from './runner';

export async function recurringExpandJob(db: Db, now: Date) {
  const results = [];
  for (const site of await db.select().from(sites).all()) {
    const settings = parseSiteSettings(site.settingsJson);
    const { targetWeek } = nextWeeklyRound(now, site.timezone, settings.rounds.weekly);
    const outcome = await runOnce(
      db,
      `recurring-expand:${site.id}:${targetWeek}`,
      now,
      async () => await expandPatterns(db, { siteId: site.id, week: targetWeek, now }),
    );
    results.push({
      siteId: site.id,
      week: targetWeek,
      created: outcome.ran ? outcome.result : null,
    });
  }
  return results;
}
