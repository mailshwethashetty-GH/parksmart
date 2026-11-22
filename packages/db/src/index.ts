export * from './client';
export * as schema from './schema';
export * from './schema';
export { seed, isSeeded, SEED_EMAIL_DOMAIN } from './seed';
export { setupOrganisation, type SetupOptions } from './setup';

/**
 * Query helpers, re-exported so every package uses this one copy of drizzle-orm.
 * (Two copies with different peer sets make columns and operators incompatible.)
 */
export {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
export type { SQLiteTable } from 'drizzle-orm/sqlite-core';
