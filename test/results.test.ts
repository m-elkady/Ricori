// Tests for src/results.ts: applyResult and createHistoryReader.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Document, Job } from '../src/domain.js';
import { claimJob, retryJob } from '../src/queue.js';
import { extract } from '../src/processor.js';
import { applyResult } from '../src/results.js';
import { alice, bob, createDocument, detail, makeTestContext } from './helpers.js';

const ctx = makeTestContext('results_test');
const { db, app } = ctx;

before(ctx.setup);
after(ctx.teardown);

function deliver(job: Job) {
  return extract(job).then(fields => applyResult(db, { job, fields, receiptKey: job.id }));
}
async function expireLease(jobId: string) {
  await db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [jobId]);
}
async function jobStatus(jobId: string) {
  return (await db.query<{ status: string }>('SELECT status FROM jobs WHERE id=$1', [jobId])).rows[0]!.status;
}
async function resultRows(documentId: string) {
  return (await db.query('SELECT job_id, receipt_key FROM processing_results WHERE document_id=$1', [documentId])).rows;
}

test('applyResult: the same job delivered twice is accepted once', async () => {
  const { document, jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  assert.ok(await deliver(job));
  assert.equal(await deliver(job), undefined);
  assert.equal((await detail(app, document.id)).json<Document>().result_count, 1);
  assert.equal((await resultRows(document.id)).length, 1);
});

test('applyResult: a lease that expires lets a second worker finish; the late first worker is rejected', async () => {
  const { document, jobId } = await createDocument(app);
  const first = await claimJob(db, jobId);
  assert.ok(first);
  await expireLease(jobId);
  const second = await claimJob(db, jobId);
  assert.ok(second);
  assert.ok(await deliver(second));
  assert.equal(await deliver(first), undefined);
  assert.equal((await detail(app, document.id)).json<Document>().result_count, 1);
  assert.equal((await resultRows(document.id)).length, 1);
  assert.equal(await jobStatus(jobId), 'completed');
});

test('applyResult: a worker that no longer owns the job (lease expired, re-claimed) cannot write', async () => {
  const { jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  await expireLease(jobId);
  await retryJob(db, job, new Error('simulated timeout'));
  assert.equal(await deliver(job), undefined, 'a job no longer running must reject the stale worker');
});

test('applyResult: a correction made while processing is in flight is not overwritten', async () => {
  const { document, jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  const review = await app.inject({ method: 'PATCH', url: '/documents/' + document.id, headers: alice,
    payload: { expectedRevision: document.revision, fields: { amountCents: 4300 } } });
  assert.equal(review.statusCode, 200, review.body);
  assert.equal(await deliver(job), undefined);
  const stored = (await detail(app, document.id)).json<Document>();
  assert.equal(stored.fields.amountCents, 4300);
  assert.equal(stored.status, 'reviewed');
  assert.equal(stored.result_count, 0);
  assert.equal(await jobStatus(jobId), 'completed');
});

test('applyResult: an explicit reprocess after a correction still applies', async () => {
  const { document, jobId } = await createDocument(app);
  assert.ok(await deliver((await claimJob(db, jobId))!));
  const ready = (await detail(app, document.id)).json<Document>();
  await app.inject({ method: 'PATCH', url: '/documents/' + document.id, headers: alice,
    payload: { expectedRevision: ready.revision, fields: { amountCents: 4300 } } });
  const request = await app.inject({ method: 'POST', url: '/documents/' + document.id + '/process', headers: alice });
  assert.equal(request.statusCode, 202);
  const secondJob = await claimJob(db, request.json<{ jobId: string }>().jobId);
  assert.ok(secondJob);
  assert.ok(await deliver(secondJob));
  const stored = (await detail(app, document.id)).json<Document>();
  assert.equal(stored.status, 'ready');
  assert.equal(stored.result_count, 2);
});

test('createHistoryReader: history is never served to another tenant, even when cached', async () => {
  const { document, jobId } = await createDocument(app);
  assert.ok(await deliver((await claimJob(db, jobId))!));
  const own = await app.inject({ url: '/documents/' + document.id + '/results', headers: alice });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json<{ results: unknown[] }>().results.length, 1);
  assert.equal((await app.inject({ url: '/documents/' + document.id + '/results', headers: bob })).statusCode, 404);
  assert.equal((await detail(app, document.id, bob)).statusCode, 404);
});

test('createHistoryReader: history of a deleted document is not served from the cache', async () => {
  const { document, jobId } = await createDocument(app);
  assert.ok(await deliver((await claimJob(db, jobId))!));
  assert.equal((await app.inject({ url: '/documents/' + document.id + '/results', headers: alice })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: '/documents/' + document.id, headers: alice })).statusCode, 204);
  assert.equal((await app.inject({ url: '/documents/' + document.id + '/results', headers: alice })).statusCode, 404);
});
