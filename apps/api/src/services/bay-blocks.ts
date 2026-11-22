/** Bay blocks for events and documented reserved bays (FR-26). Soft-deleted, never removed. */
import {
  and,
  asc,
  bayBlocks,
  bays,
  type Db,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  zones,
} from '@parksmart/db';
import type { BayBlock } from '@parksmart/shared';
import { notFound } from '../lib/errors';
import type { Actor } from '../types';
import { assertInSite, iso } from './_scope';
import { writeAudit } from './audit';

export async function listBayBlocks(
  db: Db,
  siteId: string,
  from?: string,
  to?: string,
): Promise<BayBlock[]> {
  const conditions = [eq(bayBlocks.siteId, siteId), isNull(bayBlocks.deletedAt)];
  // Overlap with [from, to].
  if (from) conditions.push(gte(bayBlocks.dateTo, from));
  if (to) conditions.push(lte(bayBlocks.dateFrom, to));
  return (
    await db
      .select({ block: bayBlocks, bayCode: bays.code, zoneName: zones.name })
      .from(bayBlocks)
      .leftJoin(bays, eq(bays.id, bayBlocks.bayId))
      .leftJoin(zones, eq(zones.id, bayBlocks.zoneId))
      .where(and(...conditions))
      .orderBy(asc(bayBlocks.dateFrom), asc(bays.code))
      .all()
  ).map(({ block, bayCode, zoneName }) => ({
    id: block.id,
    bayId: block.bayId,
    bayCode: bayCode ?? null,
    zoneId: block.zoneId,
    zoneName: zoneName ?? null,
    dateFrom: block.dateFrom,
    dateTo: block.dateTo,
    reason: block.reason,
    createdAt: iso(block.createdAt),
  }));
}

export async function createBayBlocks(
  db: Db,
  actor: Actor,
  input: { bayIds?: string[]; zoneId?: string; dateFrom: string; dateTo: string; reason: string },
  now: Date,
): Promise<BayBlock[]> {
  if (input.zoneId) {
    assertInSite(
      await db.select().from(zones).where(eq(zones.id, input.zoneId)).get(),
      actor.siteId,
      'Zone',
    );
  }
  const bayIds = [...new Set(input.bayIds ?? [])];
  if (bayIds.length > 0) {
    const found = await db.select().from(bays).where(inArray(bays.id, bayIds)).all();
    if (found.length !== bayIds.length) throw notFound('Bay');
    for (const b of found) assertInSite(b, actor.siteId, 'Bay');
  }
  const targets =
    bayIds.length > 0
      ? bayIds.map((bayId) => ({ bayId, zoneId: null }))
      : [{ bayId: null, zoneId: input.zoneId! }];
  const ids = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(bayBlocks)
      .values(
        targets.map((t) => ({
          orgId: actor.orgId,
          siteId: actor.siteId,
          ...t,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          reason: input.reason,
          createdBy: actor.id,
          createdAt: now,
        })),
      )
      .returning({ id: bayBlocks.id })
      .all();
    await writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'bay_block.create',
        entity: 'bay_block',
        entityId: rows.length === 1 ? rows[0]!.id : null,
        after: { ...input, blockIds: rows.map((r) => r.id) },
        reason: input.reason,
      },
      now,
    );
    return new Set(rows.map((r) => r.id));
  });
  return (await listBayBlocks(db, actor.siteId)).filter((b) => ids.has(b.id));
}

export async function deleteBayBlock(
  db: Db,
  actor: Actor,
  blockId: string,
  now: Date,
): Promise<void> {
  const block = assertInSite(
    await db
      .select()
      .from(bayBlocks)
      .where(and(eq(bayBlocks.id, blockId), isNull(bayBlocks.deletedAt)))
      .get(),
    actor.siteId,
    'Bay block',
  );
  await db.transaction(async (tx) => {
    await tx.update(bayBlocks).set({ deletedAt: now }).where(eq(bayBlocks.id, blockId)).run();
    await writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'bay_block.delete',
        entity: 'bay_block',
        entityId: blockId,
        before: block,
      },
      now,
    );
  });
}
