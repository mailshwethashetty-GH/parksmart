/**
 * Guards against drift between our Drizzle auth tables and what Better Auth (and its
 * SSO plugin) expect. Fails on a Better Auth upgrade that adds a field we don't have.
 */
import { getTableColumns, schema } from '@parksmart/db';
import { createTestDb } from '@parksmart/db/testing';
import { getSchema } from 'better-auth/db';
import type { SQLiteTable } from '@parksmart/db';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { TEST_ENV } from '../test-utils';
import { createAuth } from './auth';

const DRIZZLE_TABLES: Record<string, SQLiteTable> = {
  users: schema.users,
  sessions: schema.sessions,
  accounts: schema.accounts,
  verifications: schema.verifications,
  ssoProviders: schema.ssoProviders,
};

describe('Better Auth schema compatibility', async () => {
  const auth = createAuth(await createTestDb(), loadEnv({ ...TEST_ENV }));
  const expected = getSchema(auth.options);

  it('every Better Auth model maps to one of our tables', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(DRIZZLE_TABLES).sort());
  });

  it.each(Object.keys(DRIZZLE_TABLES))('%s has every field Better Auth uses', (model) => {
    const columns = Object.keys(getTableColumns(DRIZZLE_TABLES[model]!));
    const fields = Object.keys(expected[model]?.fields ?? {});
    expect(fields.filter((f) => !columns.includes(f))).toEqual([]);
  });
});
