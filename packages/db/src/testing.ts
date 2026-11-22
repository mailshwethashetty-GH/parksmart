import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, type Db } from './client';

let template: Promise<string> | undefined;

/** A migrated, empty database file, built once per test worker and copied per test. */
function migratedTemplate(): Promise<string> {
  template ??= (async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'parksmart-tpl-')), 'template.db');
    const db = await createDb(`file:${path}`);
    await runMigrations(db);
    await db.$client.execute('PRAGMA journal_mode = DELETE');
    db.$client.close();
    return path;
  })();
  return template;
}

/**
 * Fresh database with all migrations applied. For tests only. A temporary file, not
 * `:memory:`: libSQL opens a new connection after a transaction, which would lose an
 * in-memory database.
 */
export async function createTestDb(): Promise<Db> {
  const path = join(mkdtempSync(join(tmpdir(), 'parksmart-test-')), 'test.db');
  copyFileSync(await migratedTemplate(), path);
  return await createDb(`file:${path}`);
}
