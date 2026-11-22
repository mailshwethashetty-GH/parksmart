/**
 * Audit log reader and export (FR-16). Read-only: the log itself is append-only.
 * Dates in filters are site-local days; stored instants are UTC.
 */
import { and, auditLog, desc, eq, gte, lt, or, users, type Db } from '@parksmart/db';
import { addDays, siteLocalToUtc, type AuditEntry } from '@parksmart/shared';
import { loadSite } from './site';

export type AuditFilter = {
  from?: string;
  to?: string;
  action?: string;
  cursor?: string;
  limit: number;
};

/** Cursor = `<epoch ms>_<id>` of the last row on the previous page (newest first). */
function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [ms, id] = cursor.split('_');
  const at = Number(ms);
  return Number.isFinite(at) && id ? { at: new Date(at), id } : null;
}

async function whereFor(db: Db, siteId: string, f: AuditFilter) {
  const { timezone } = await loadSite(db, siteId);
  const conditions = [eq(auditLog.siteId, siteId)];
  if (f.from) conditions.push(gte(auditLog.at, siteLocalToUtc(f.from, '00:00', timezone)));
  if (f.to) conditions.push(lt(auditLog.at, siteLocalToUtc(addDays(f.to, 1), '00:00', timezone)));
  // Prefix match ("policy" → policy.publish, policy.draft.update, …) as a range, so
  // characters like '_' are literal (no LIKE wildcards).
  if (f.action) {
    conditions.push(gte(auditLog.action, f.action), lt(auditLog.action, `${f.action}\uffff`));
  }
  const c = decodeCursor(f.cursor);
  if (c)
    conditions.push(or(lt(auditLog.at, c.at), and(eq(auditLog.at, c.at), lt(auditLog.id, c.id)))!);
  return and(...conditions);
}

export async function listAudit(
  db: Db,
  siteId: string,
  f: AuditFilter,
): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  const rows = await db
    .select({ entry: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(await whereFor(db, siteId, f))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(f.limit + 1)
    .all();
  const page = rows.slice(0, f.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ entry: e, actorName }) => ({
      id: e.id,
      at: e.at.toISOString(),
      actor: e.actorId ? { id: e.actorId, name: actorName ?? 'Unknown' } : null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      reason: e.reason,
      before: e.beforeJson ?? null,
      after: e.afterJson ?? null,
    })),
    nextCursor:
      rows.length > f.limit && last ? `${last.entry.at.getTime()}_${last.entry.id}` : null,
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Quote everything; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const AUDIT_EXPORT_LIMIT = 50_000;

export async function exportAuditCsv(
  db: Db,
  siteId: string,
  f: Omit<AuditFilter, 'cursor' | 'limit'>,
): Promise<string> {
  const { items } = await listAudit(db, siteId, { ...f, limit: AUDIT_EXPORT_LIMIT });
  const header = ['at', 'actor', 'action', 'entity', 'entity_id', 'reason', 'before', 'after'];
  const lines = items.map((e) =>
    [e.at, e.actor?.name ?? 'system', e.action, e.entity, e.entityId, e.reason, e.before, e.after]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
