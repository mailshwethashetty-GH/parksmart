/** Zones and bays (FR-26). Bays are deactivated, never deleted, so history stays intact. */
import { bays, zones, type Db } from '@parksmart/db';
import type { Bay, BayType, Zone, ZoneKind } from '@parksmart/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { conflict } from '../lib/errors';
import type { Actor } from '../types';
import { assertInSite, withUniqueConflict } from './_scope';
import { writeAudit } from './audit';

// --- zones -------------------------------------------------------------------
export function listZones(db: Db, siteId: string): Zone[] {
  const counts = new Map(
    db
      .select({ zoneId: bays.zoneId, n: count() })
      .from(bays)
      .where(and(eq(bays.siteId, siteId), eq(bays.active, true)))
      .groupBy(bays.zoneId)
      .all()
      .map((r) => [r.zoneId, r.n]),
  );
  return db
    .select()
    .from(zones)
    .where(eq(zones.siteId, siteId))
    .orderBy(asc(zones.name))
    .all()
    .map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.kind,
      capacity: z.capacity,
      bayCount: counts.get(z.id) ?? 0,
    }));
}

const zoneById = (db: Db, siteId: string, zoneId: string) =>
  assertInSite(db.select().from(zones).where(eq(zones.id, zoneId)).get(), siteId, 'Zone');

export function createZone(
  db: Db,
  actor: Actor,
  input: { name: string; kind: ZoneKind; capacity: number | null },
  now: Date,
): Zone {
  const zone = withUniqueConflict(
    () =>
      db.transaction((tx) => {
        const row = tx
          .insert(zones)
          .values({ orgId: actor.orgId, siteId: actor.siteId, ...input })
          .returning()
          .get();
        writeAudit(
          tx,
          {
            siteId: actor.siteId,
            actorId: actor.id,
            action: 'zone.create',
            entity: 'zone',
            entityId: row.id,
            after: input,
          },
          now,
        );
        return row;
      }),
    `A zone called "${input.name}" already exists.`,
  );
  return { id: zone.id, name: zone.name, kind: zone.kind, capacity: zone.capacity, bayCount: 0 };
}

export function updateZone(
  db: Db,
  actor: Actor,
  zoneId: string,
  input: Partial<{ name: string; kind: ZoneKind; capacity: number | null }>,
  now: Date,
): Zone {
  const before = zoneById(db, actor.siteId, zoneId);
  withUniqueConflict(
    () =>
      db.transaction((tx) => {
        tx.update(zones).set(input).where(eq(zones.id, zoneId)).run();
        writeAudit(
          tx,
          {
            siteId: actor.siteId,
            actorId: actor.id,
            action: 'zone.update',
            entity: 'zone',
            entityId: zoneId,
            before,
            after: input,
          },
          now,
        );
      }),
    `A zone called "${input.name}" already exists.`,
  );
  return listZones(db, actor.siteId).find((z) => z.id === zoneId)!;
}

// --- bays --------------------------------------------------------------------
const toBay = (b: typeof bays.$inferSelect): Bay => ({
  id: b.id,
  zoneId: b.zoneId,
  code: b.code,
  bayType: b.bayType,
  hasCharger: b.hasCharger,
  active: b.active,
});

export function listBays(db: Db, siteId: string, zoneId?: string): Bay[] {
  return db
    .select()
    .from(bays)
    .where(zoneId ? and(eq(bays.siteId, siteId), eq(bays.zoneId, zoneId)) : eq(bays.siteId, siteId))
    .orderBy(asc(bays.code))
    .all()
    .map(toBay);
}

type NewBay = { zoneId: string; code: string; bayType: BayType; hasCharger?: boolean };

function insertBays(db: Db, actor: Actor, items: NewBay[], action: string, now: Date): Bay[] {
  for (const zoneId of new Set(items.map((i) => i.zoneId))) zoneById(db, actor.siteId, zoneId);
  const codes = items.map((i) => i.code);
  if (new Set(codes).size !== codes.length) throw conflict('Bay codes must be unique.');
  const existing = db
    .select({ code: bays.code })
    .from(bays)
    .where(and(eq(bays.siteId, actor.siteId), inArray(bays.code, codes)))
    .all();
  if (existing.length > 0) {
    throw conflict(`Bay code already in use: ${existing.map((e) => e.code).join(', ')}.`, {
      codes: existing.map((e) => e.code),
    });
  }
  return db.transaction((tx) => {
    const rows = tx
      .insert(bays)
      .values(
        items.map((i) => ({
          orgId: actor.orgId,
          siteId: actor.siteId,
          zoneId: i.zoneId,
          code: i.code,
          bayType: i.bayType,
          // EV bays have chargers unless told otherwise.
          hasCharger: i.hasCharger ?? i.bayType === 'ev',
        })),
      )
      .returning()
      .all();
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action,
        entity: 'bay',
        entityId: rows.length === 1 ? rows[0]!.id : null,
        after: { count: rows.length, codes },
      },
      now,
    );
    return rows.map(toBay);
  });
}

export function createBay(db: Db, actor: Actor, input: NewBay, now: Date): Bay {
  return insertBays(db, actor, [input], 'bay.create', now)[0]!;
}

export function bulkCreateBays(
  db: Db,
  actor: Actor,
  input: {
    zoneId: string;
    prefix: string;
    start: number;
    count: number;
    bayType: BayType;
    hasCharger?: boolean;
  },
  now: Date,
): Bay[] {
  const width = Math.max(3, String(input.start + input.count - 1).length);
  const items = Array.from({ length: input.count }, (_, i) => ({
    zoneId: input.zoneId,
    code: `${input.prefix}-${String(input.start + i).padStart(width, '0')}`,
    bayType: input.bayType,
    hasCharger: input.hasCharger,
  }));
  return insertBays(db, actor, items, 'bay.bulk_create', now);
}

export function updateBay(
  db: Db,
  actor: Actor,
  bayId: string,
  input: Partial<{ zoneId: string; bayType: BayType; hasCharger: boolean; active: boolean }>,
  now: Date,
): Bay {
  const before = assertInSite(
    db.select().from(bays).where(eq(bays.id, bayId)).get(),
    actor.siteId,
    'Bay',
  );
  if (input.zoneId) zoneById(db, actor.siteId, input.zoneId);
  return db.transaction((tx) => {
    const row = tx.update(bays).set(input).where(eq(bays.id, bayId)).returning().get();
    writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'bay.update',
        entity: 'bay',
        entityId: bayId,
        before: toBay(before),
        after: input,
      },
      now,
    );
    return toBay(row);
  });
}
