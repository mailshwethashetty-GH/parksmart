/**
 * Roles (FR-29). Everyone signs in with SSO as an employee; an admin then makes security
 * staff and backup admins. Every change is audited with a reason (non-negotiable 5).
 */
import { and, type Db, eq, users } from '@parksmart/db';
import type { Role } from '@parksmart/shared';
import { businessRule, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { writeAudit } from './audit';

export function setUserRole(
  db: Db,
  actor: Actor,
  userId: string,
  body: { role: Role; reason: string },
  now: Date,
) {
  return db.transaction((tx) => {
    const user = tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.siteId, actor.siteId), eq(users.active, true)))
      .get();
    if (!user) throw notFound('User');
    if (user.id === actor.id) {
      throw businessRule('OWN_ROLE', 'Ask another admin to change your own role.');
    }
    if (user.role !== body.role) {
      tx.update(users).set({ role: body.role }).where(eq(users.id, user.id)).run();
      writeAudit(
        tx,
        {
          siteId: actor.siteId,
          actorId: actor.id,
          action: 'user.role',
          entity: 'user',
          entityId: user.id,
          before: { role: user.role },
          after: { role: body.role },
          reason: body.reason,
        },
        now,
      );
    }
    return { id: user.id, name: user.name, email: user.email, role: body.role };
  });
}
