import { defineConfig } from 'drizzle-kit';

// Generates migrations from the schema; `pnpm db:migrate` applies them (local file or Turso).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? '../../data/parksmart.db',
  },
  strict: true,
  verbose: true,
});
