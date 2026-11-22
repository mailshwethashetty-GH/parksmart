import { createDb, runMigrations } from '../client';
import { databasePathFromEnv } from './env';

const path = databasePathFromEnv();
const db = createDb(path);
runMigrations(db);
db.$client.close();
console.log(`Migrations applied to ${path}`);
