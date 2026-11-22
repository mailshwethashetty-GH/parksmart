import { BAY_TYPES, ZONE_KINDS, type SiteSettings } from '@parksmart/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, isoDate, updatedAt } from './_helpers';

export const orgs = sqliteTable('orgs', {
  id: id(),
  name: text('name').notNull(),
  /** SSO users whose email ends in this domain join this org. */
  emailDomain: text('email_domain').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sites = sqliteTable(
  'sites',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    aiStage: integer('ai_stage').notNull().default(1),
    settingsJson: text('settings_json', { mode: 'json' }).$type<Partial<SiteSettings>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sites_org_idx').on(t.orgId)],
);

export const zones = sqliteTable(
  'zones',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ZONE_KINDS }).notNull(),
    /** Capacity for capacity-managed zones (two-wheeler, FR-32). Null = counted by bays. */
    capacity: integer('capacity'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('zones_site_name_uq').on(t.siteId, t.name)],
);

export const bays = sqliteTable(
  'bays',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    zoneId: text('zone_id')
      .notNull()
      .references(() => zones.id),
    code: text('code').notNull(),
    bayType: text('bay_type', { enum: BAY_TYPES }).notNull(),
    hasCharger: integer('has_charger', { mode: 'boolean' }).notNull().default(false),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bays_site_code_uq').on(t.siteId, t.code),
    index('bays_site_type_idx').on(t.siteId, t.bayType),
  ],
);

export const bayBlocks = sqliteTable(
  'bay_blocks',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    bayId: text('bay_id').references(() => bays.id),
    zoneId: text('zone_id').references(() => zones.id),
    dateFrom: isoDate('date_from').notNull(),
    dateTo: isoDate('date_to').notNull(),
    /** Shown to employees. */
    reason: text('reason').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('bay_blocks_site_dates_idx').on(t.siteId, t.dateFrom, t.dateTo)],
);
