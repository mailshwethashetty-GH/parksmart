import { defineConfig } from 'drizzle-kit';

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
