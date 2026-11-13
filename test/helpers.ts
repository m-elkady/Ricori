import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import type { Document } from '../src/domain.js';

const execute = promisify(execFile);

export const alice = { authorization: 'Bearer alice-local-token' };
export const bob = { authorization: 'Bearer bob-local-token' };
export const source = { issuer: 'Example Utilities', amountCents: 4200, currency: 'EUR', dueDate: '2027-01-15' } as const;

// Each test file gets its own Postgres schema and its own app instance, so the
// files can run independently and never see each other's data.
export function makeTestContext(label: string) {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL to a local PostgreSQL database');
  const admin = new pg.Pool({ connectionString });
  const schema = label + '_' + randomUUID().replaceAll('-', '');
  const isolatedUrl = new URL(connectionString);
  isolatedUrl.searchParams.set('options', '-c search_path=' + schema);
  const appName = 'ricori-' + label;
  const db = new pg.Pool({ connectionString: isolatedUrl.href, application_name: appName });
  const app = buildApp(db);

  async function setup() {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const env = { ...process.env, DATABASE_URL: isolatedUrl.href };
    await execute(process.execPath, ['dist/src/migrate.js'], { env });
    await execute(process.execPath, ['dist/src/seed.js'], { env });
    await app.ready();
  }
  async function teardown() {
    await app.close();
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
  return { db, app, admin, schema, appName, setup, teardown };
}

export async function createDocument(app: ReturnType<typeof buildApp>, headers: Record<string, string> = alice) {
  const response = await app.inject({ method: 'POST', url: '/documents', headers, payload: { title: 'Synthetic invoice', source } });
  if (response.statusCode !== 201) throw new Error('create failed: ' + response.body);
  return response.json<{ document: Document; jobId: string }>();
}

export async function detail(app: ReturnType<typeof buildApp>, id: string, headers: Record<string, string> = alice) {
  return app.inject({ url: '/documents/' + id, headers });
}

export async function overviewIds(app: ReturnType<typeof buildApp>, headers: Record<string, string> = alice) {
  const response = await app.inject({ url: '/documents', headers });
  return response.json<{ documents: Document[] }>().documents.map(item => item.id);
}

// Waits until `count` connections with this application name are stuck behind a row lock.
// Used to make a race deterministic instead of depending on timing.
export async function waitForBlockedQueries(admin: pg.Pool, appName: string, count: number) {
  for (let i = 0; i < 250; i++) {
    const waiting = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [appName]
    );
    if (waiting.rows[0]!.n >= count) return;
    await delay(20);
  }
  throw new Error('queries did not reach the row lock');
}
