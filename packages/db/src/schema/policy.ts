import { RULE_TYPES } from '@parksmart/shared';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, isoDate, timestamp } from './_helpers';
import { orgs, sites } from './sites';
import { users } from './people';

export const policies = sqliteTable('policies', {
  id: id(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  siteId: text('site_id')
    .notNull()
    .references(() => sites.id),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/** Immutable once published (enforced in the policy service). */
export const policyVersions = sqliteTable(
  'policy_versions',
  {
    id: id(),
    policyId: text('policy_id')
      .notNull()
      .references(() => policies.id),
    version: integer('version').notNull(),
    /** Site-local Monday of the first week this version applies to. Null while draft. */
    effectiveFromWeek: isoDate('effective_from_week'),
    publishedAt: timestamp('published_at'),
    publishedBy: text('published_by').references(() => users.id),
    plainLanguage: text('plain_language'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('policy_versions_policy_version_uq').on(t.policyId, t.version),
    index('policy_versions_effective_idx').on(t.policyId, t.effectiveFromWeek),
  ],
);

export const rules = sqliteTable(
  'rules',
  {
    id: id(),
    policyVersionId: text('policy_version_id')
      .notNull()
      .references(() => policyVersions.id),
    ruleType: text('rule_type', { enum: RULE_TYPES }).notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    configJson: text('config_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Percent; weighted rules only. Weights per version total 100. */
    weight: real('weight'),
    order: integer('order').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('rules_version_key_uq').on(t.policyVersionId, t.key)],
);
