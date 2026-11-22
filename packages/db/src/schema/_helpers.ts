import { createId } from '@paralleldrive/cuid2';
import { integer, text } from 'drizzle-orm/sqlite-core';

/** Text primary key (cuid2). */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());

/** UTC instant stored as integer epoch milliseconds (docs/08 convention). */
export const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Site-local calendar day, `YYYY-MM-DD`. */
export const isoDate = (name: string) => text(name);
