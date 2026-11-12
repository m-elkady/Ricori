import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { runOnce } from '../src/worker.js';
import type { Document } from '../src/domain.js';

const execute = promisify(execFile);
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL to a local PostgreSQL database');
const admin = new pg.Pool({ connectionString });
const schema = 'public_test_' + randomUUID().replaceAll('-', '');
const isolatedUrl = new URL(connectionString);
isolatedUrl.searchParams.set('options', '-c search_path=' + schema);
const db = new pg.Pool({ connectionString: isolatedUrl.href, application_name: 'ricori-public-test' });
const app = buildApp(db);
const alice = { authorization: 'Bearer alice-local-token' };
const bob = { authorization: 'Bearer bob-local-token' };
const source = { issuer: 'Example Utilities', amountCents: 4200, currency: 'EUR', dueDate: '2027-01-15' };

before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const env = { ...process.env, DATABASE_URL: isolatedUrl.href };
  for (let i = 0; i < 2; i++) {
    await execute(process.execPath, ['dist/src/migrate.js'], { env });
    await execute(process.execPath, ['dist/src/seed.js'], { env });
  }
  await app.ready();
});
after(async () => {
  await app.close();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

async function create() {
  const response = await app.inject({ method: 'POST', url: '/documents', headers: alice, payload: { title: 'Synthetic invoice', source } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ document: Document; jobId: string }>();
}

test('health and authentication', async () => {
  assert.equal((await app.inject('/health')).statusCode, 200);
  assert.equal((await app.inject('/documents')).statusCode, 401);
  assert.equal((await app.inject({ url: '/documents', headers: { authorization: 'Bearer unknown' } })).statusCode, 401);
});

test('validation rejects invalid metadata and identifiers', async () => {
  for (const invalid of [{ ...source, amountCents: -1 }, { ...source, dueDate: '2027-02-31' }, { ...source, currency: 'XXX' }]) {
    const response = await app.inject({ method: 'POST', url: '/documents', headers: alice, payload: { title: 'Invalid', source: invalid } });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await app.inject({ url: '/documents/not-a-uuid', headers: alice })).statusCode, 400);
});

test('seed and migration reruns are idempotent; document list and detail are tenant scoped', async () => {
  const migrations = (await readdir('migrations')).filter(name => name.endsWith('.sql'));
  assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount, migrations.length);
  assert.equal((await db.query('SELECT * FROM tenants')).rowCount, 2);
  const sample = '33333333-3333-4333-8333-333333333333';
  assert.equal((await app.inject({ url: '/documents/' + sample, headers: alice })).statusCode, 200);
  assert.equal((await app.inject({ url: '/documents/' + sample, headers: bob })).statusCode, 404);
  assert.deepEqual((await app.inject({ url: '/documents', headers: bob })).json(), { documents: [] });
});

test('create, process, inspect, correct and delete a document', async () => {
  const { document, jobId } = await create();
  assert.equal(document.status, 'queued');
  assert.equal(await runOnce(db, jobId), true);
  const ready = (await app.inject({ url: '/documents/' + document.id, headers: alice })).json<Document>();
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.fields, source);
  assert.equal(ready.result_count, 1);
  const history = (await app.inject({ url: '/documents/' + document.id + '/results', headers: alice })).json<{ results: unknown[] }>();
  assert.equal(history.results.length, 1);
  const review = await app.inject({ method: 'PATCH', url: '/documents/' + document.id, headers: alice,
    payload: { expectedRevision: ready.revision, fields: { amountCents: 4300 } } });
  assert.equal(review.statusCode, 200, review.body);
  assert.equal(review.json<Document>().status, 'reviewed');
  assert.deepEqual(review.json<Document>().fields, { ...source, amountCents: 4300 });
  const overview = (await app.inject({ url: '/documents', headers: alice })).json<{ documents: Document[] }>();
  assert.equal(overview.documents.find(item => item.id === document.id)?.fields.amountCents, 4300);
  assert.equal(await runOnce(db, jobId), false);
  assert.equal((await app.inject({ method: 'DELETE', url: '/documents/' + document.id, headers: alice })).statusCode, 204);
  assert.equal((await app.inject({ url: '/documents/' + document.id, headers: alice })).statusCode, 404);
  const deletedList = (await app.inject({ url: '/documents', headers: alice })).json<{ documents: Document[] }>();
  assert.ok(!deletedList.documents.some(item => item.id === document.id));
});

test('sequential stale corrections report a revision conflict', async () => {
  const { document } = await create();
  const request = { method: 'PATCH' as const, url: '/documents/' + document.id, headers: alice,
    payload: { expectedRevision: document.revision, fields: { issuer: 'Corrected Example' } } };
  assert.equal((await app.inject(request)).statusCode, 200);
  assert.equal((await app.inject(request)).statusCode, 409);
});

test('an explicit second processing request creates a new job', async () => {
  const { document, jobId } = await create();
  await runOnce(db, jobId);
  const request = await app.inject({ method: 'POST', url: '/documents/' + document.id + '/process', headers: alice });
  assert.equal(request.statusCode, 202);
  const secondJobId = request.json<{ jobId: string }>().jobId;
  assert.notEqual(secondJobId, jobId);
  await runOnce(db, secondJobId);
  const ready = (await app.inject({ url: '/documents/' + document.id, headers: alice })).json<Document>();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.result_count, 2);
});
