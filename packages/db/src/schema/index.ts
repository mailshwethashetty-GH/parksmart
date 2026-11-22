export * from './sites';
export * from './people';
export * from './policy';
export * from './allocation';
export * from './system';

import type { bookings, requests } from './allocation';
export type BookingInsert = typeof bookings.$inferInsert;
export type RequestInsert = typeof requests.$inferInsert;
