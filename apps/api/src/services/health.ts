import type { Db } from '@parksmart/db';

export function checkHealth(db: Db): { status: 'ok'; db: 'ok'; time: string } {
  db.$client.prepare('select 1').get();
  return { status: 'ok', db: 'ok', time: new Date().toISOString() };
}
