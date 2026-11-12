import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from './db.js';

const db = createPool('ricori-migrate');
const client = await db.connect();
try {
  await client.query('SELECT pg_advisory_lock(7419,1)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of (await readdir(resolve('migrations'))).filter(n => n.endsWith('.sql')).sort()) {
    const exists = await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name]);
    if (exists.rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(resolve('migrations', name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await client.query('COMMIT');
      console.log('Applied ' + name);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(7419,1)');
  client.release();
  await db.end();
}
