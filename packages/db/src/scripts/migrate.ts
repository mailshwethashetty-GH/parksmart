import { createDb, runMigrations } from '../client';
import { dbConfigFromEnv } from './env';

const config = dbConfigFromEnv();
const db = await createDb(config);
await runMigrations(db);
db.$client.close();
console.log(`Migrations applied to ${config.label}`);
