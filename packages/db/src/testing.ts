import { createDb, runMigrations, type Db } from './client';

/** Fresh in-memory DB with all migrations applied. For tests only. */
export function createTestDb(): Db {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}
