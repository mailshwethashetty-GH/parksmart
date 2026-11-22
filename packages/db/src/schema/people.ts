/**
 * People and auth. `users`, `sessions`, `accounts`, `verifications` and `sso_providers`
 * are the Better Auth models (renamed to our plural table names). Better Auth owns their
 * core columns; we add org/site/role/active to `users`.
 */
import {
  APPROVAL_KINDS,
  CONSENT_PURPOSES,
  DISTANCE_BANDS,
  ROLES,
  VEHICLE_TYPES,
} from '@parksmart/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, id, isoDate, timestamp, updatedAt } from './_helpers';
import { orgs, sites } from './sites';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    /** Home site; the API scopes every request to it. */
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    role: text('role', { enum: ROLES }).notNull().default('employee'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('users_site_idx').on(t.siteId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    /** Required by the Better Auth model. Always null: local passwords are disabled (SSO only). */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/** Better Auth SSO plugin: one row per configured OIDC/SAML identity provider. */
export const ssoProviders = sqliteTable('sso_providers', {
  id: text('id').primaryKey(),
  issuer: text('issuer').notNull(),
  oidcConfig: text('oidc_config'),
  samlConfig: text('saml_config'),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull().unique(),
  organizationId: text('organization_id'),
  domain: text('domain').notNull(),
  domainVerified: integer('domain_verified', { mode: 'boolean' }),
});

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Optional; null scores neutral. */
  distanceBand: text('distance_band', { enum: DISTANCE_BANDS }),
  roleTagsJson: text('role_tags_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  joinDate: isoDate('join_date'),
  clientFacing: integer('client_facing', { mode: 'boolean' }),
  updatedAt: updatedAt(),
});

export const vehicles = sqliteTable(
  'vehicles',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: VEHICLE_TYPES }).notNull(),
    isEv: integer('is_ev', { mode: 'boolean' }).notNull().default(false),
    /** Optional unless the site requires it. Never sent to the Claude API. */
    plate: text('plate'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vehicles_user_idx').on(t.userId)],
);

/** Flag only. Never store medical details (non-negotiable #7). */
export const approvals = sqliteTable(
  'approvals',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: APPROVAL_KINDS }).notNull(),
    approvedBy: text('approved_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [index('approvals_user_idx').on(t.userId)],
);

export const consents = sqliteTable(
  'consents',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: CONSENT_PURPOSES }).notNull(),
    grantedAt: timestamp('granted_at').notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [index('consents_user_idx').on(t.userId)],
);
