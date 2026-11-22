import type { Db } from '@parksmart/db';

export async function checkHealth(db: Db): Promise<{ status: 'ok'; db: 'ok'; time: string }> {
  await db.$client.execute('select 1');
  return { status: 'ok', db: 'ok', time: new Date().toISOString() };
}
