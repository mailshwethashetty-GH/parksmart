import { auditLog, type Db } from '@parksmart/db';

export type AuditEntry = {
  siteId: string | null;
  /** Null for system actors such as the scheduler. */
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/**
 * The single way to write to `audit_log` (non-negotiable #5). Call it inside the same
 * transaction as the change it records. Pass a transaction handle as `db` when in one.
 */
export async function writeAudit(
  db: Pick<Db, 'insert'>,
  entry: AuditEntry,
  at = new Date(),
): Promise<void> {
  await db
    .insert(auditLog)
    .values({
      siteId: entry.siteId,
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      beforeJson: entry.before ?? null,
      afterJson: entry.after ?? null,
      reason: entry.reason ?? null,
      at,
    })
    .run();
}
