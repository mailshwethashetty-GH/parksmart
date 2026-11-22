/**
 * Accessible-bay approvals (FR-13). Only a flag and an expiry are stored — never
 * medical details (non-negotiable #7). `expiresOn` is the last valid site-local day.
 */
import { approvals, users, type Db } from '@parksmart/db';
import {
  addDays,
  siteLocalDate,
  siteLocalToUtc,
  type Approval,
  type Role,
} from '@parksmart/shared';
import { and, asc, desc, eq, like, or } from 'drizzle-orm';
import { businessRule, conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { assertInSite, iso } from './_scope';
import { writeAudit } from './audit';
import { loadSite } from './site';

export function listUsers(db: Db, siteId: string, q?: string, role?: Role) {
  const conditions = [eq(users.siteId, siteId), eq(users.active, true)];
  if (role) conditions.push(eq(users.role, role));
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, '')}%`;
    conditions.push(or(like(users.name, pattern), like(users.email, pattern))!);
  }
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(...conditions))
    .orderBy(asc(users.name))
    .limit(50)
    .all();
}

export function listApprovals(db: Db, siteId: string, now: Date): Approval[] {
  const { timezone } = loadSite(db, siteId);
  return db
    .select({ approval: approvals, userName: users.name })
    .from(approvals)
    .innerJoin(users, eq(users.id, approvals.userId))
    .where(eq(users.siteId, siteId))
    .orderBy(desc(approvals.createdAt))
    .all()
    .map(({ approval: a, userName }) => ({
      id: a.id,
      userId: a.userId,
      userName,
      kind: a.kind,
      expiresOn: siteLocalDate(new Date(a.expiresAt.getTime() - 1), timezone),
      approvedBy: a.approvedBy,
      createdAt: iso(a.createdAt),
      revokedAt: a.revokedAt ? iso(a.revokedAt) : null,
      active: !a.revokedAt && a.expiresAt.getTime() > now.getTime(),
    }));
}

export function createApproval(
  db: Db,
  actor: Actor,
  input: { userId: string; expiresOn: string },
  now: Date,
): Approval {
  const { timezone } = loadSite(db, actor.siteId);
  const user = assertInSite(
    db.select().from(users).where(eq(users.id, input.userId)).get(),
    actor.siteId,
    'User',
  );
  if (user.role !== 'employee' || !user.active) {
    throw businessRule('APPROVAL_NOT_EMPLOYEE', 'Approvals are for active employees only.');
  }
  if (input.expiresOn < siteLocalDate(now, timezone)) {
    throw businessRule('APPROVAL_EXPIRY_PAST', 'The expiry date must be today or later.');
  }
  const activeExisting = listApprovals(db, actor.siteId, now).find(
    (a) => a.userId === user.id && a.active,
  );
  if (activeExisting) {
    throw conflict(
      `${user.name} already has an active approval until ${activeExisting.expiresOn}.`,
    );
  }
  // Valid through the end of `expiresOn` in the site's time zone.
  const expiresAt = siteLocalToUtc(addDays(input.expiresOn, 1), '00:00', timezone);
  const id = db.transaction((tx) => {
    const row = tx
      .insert(approvals)
      .values({
        userId: user.id,
        kind: 'accessible',
        approvedBy: actor.id,
        expiresAt,
        createdAt: now,
      })
      .returning({ id: approvals.id })
      .get();
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'approval.create',
        entity: 'approval',
        entityId: row.id,
        after: { userId: user.id, kind: 'accessible', expiresOn: input.expiresOn },
      },
      now,
    );
    return row.id;
  });
  return listApprovals(db, actor.siteId, now).find((a) => a.id === id)!;
}

export function revokeApproval(db: Db, actor: Actor, approvalId: string, now: Date): Approval {
  const row = db
    .select({ approval: approvals, siteId: users.siteId })
    .from(approvals)
    .innerJoin(users, eq(users.id, approvals.userId))
    .where(eq(approvals.id, approvalId))
    .get();
  if (!row) throw notFound('Approval');
  assertInSite({ siteId: row.siteId }, actor.siteId, 'Approval');
  if (row.approval.revokedAt) throw conflict('This approval is already revoked.');
  db.transaction((tx) => {
    tx.update(approvals).set({ revokedAt: now }).where(eq(approvals.id, approvalId)).run();
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'approval.revoke',
        entity: 'approval',
        entityId: approvalId,
      },
      now,
    );
  });
  return listApprovals(db, actor.siteId, now).find((a) => a.id === approvalId)!;
}
