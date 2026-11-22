import { createDb, runMigrations } from '../client';
import { isSeeded, seed } from '../seed';
import { dbConfigFromEnv } from './env';

const config = dbConfigFromEnv();
const db = await createDb(config);
await runMigrations(db);
if (await isSeeded(db)) {
  console.log(`${config.label} already has data. Delete it to reseed.`);
} else {
  const { siteId } = await seed(db);
  console.log(`Seeded ${config.label} (site ${siteId}).`);
}
db.$client.close();
