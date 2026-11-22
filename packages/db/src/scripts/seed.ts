import { createDb, runMigrations } from '../client';
import { isSeeded, seed } from '../seed';
import { databasePathFromEnv } from './env';

const path = databasePathFromEnv();
const db = createDb(path);
runMigrations(db);
if (isSeeded(db)) {
  console.log(`${path} already has data. Delete the file to reseed.`);
} else {
  const { siteId } = seed(db);
  console.log(`Seeded ${path} (site ${siteId}).`);
}
db.$client.close();
