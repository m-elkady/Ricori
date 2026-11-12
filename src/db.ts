import pg, { type PoolClient } from 'pg';

export function createPool(applicationName = 'ricori') {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString, max: 8, application_name: applicationName });
}
export type Database = pg.Pool;
export async function transaction<T>(db: Database, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await action(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
