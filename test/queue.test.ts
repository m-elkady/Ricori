// Tests for src/queue.ts: acknowledgeJob and retryJob.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { transaction } from '../src/db.js';
import { acknowledgeJob, claimJob, retryJob } from '../src/queue.js';
import { createDocument, makeTestContext } from './helpers.js';

const ctx = makeTestContext('queue_test');
const { db, app } = ctx;

before(ctx.setup);
after(ctx.teardown);

async function jobRow(jobId: string) {
  return (await db.query('SELECT status, attempts, lease_until, last_error FROM jobs WHERE id=$1', [jobId])).rows[0]!;
}

test('acknowledgeJob: can run on the same connection as a transaction (a PoolClient, not just the pool)', async () => {
  const { jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  await transaction(db, client => acknowledgeJob(client, job));
  assert.equal((await jobRow(jobId)).status, 'completed');
});

test('retryJob: requeues a running job that failed, until the attempt budget is spent', async () => {
  const { jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  await retryJob(db, job, new Error('boom'));
  const row = await jobRow(jobId);
  assert.equal(row.status, 'queued');
  assert.equal(row.lease_until, null);
  assert.equal(row.last_error, 'boom');
});

test('retryJob: a job whose attempts are exhausted is marked failed, not requeued', async () => {
  const { jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  await db.query('UPDATE jobs SET attempts=5 WHERE id=$1', [jobId]); // the budget check reads the stored count
  await retryJob(db, job, new Error('out of budget'));
  assert.equal((await jobRow(jobId)).status, 'failed');
});

test('retryJob: does not revive a job that was cancelled (e.g. by a delete)', async () => {
  const { jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [jobId]);
  await retryJob(db, job, new Error('late failure'));
  assert.equal((await jobRow(jobId)).status, 'cancelled');
});

test('retryJob: a stale claim_token (another worker already took the job) cannot touch it', async () => {
  const { jobId } = await createDocument(app);
  const job = await claimJob(db, jobId);
  assert.ok(job);
  await db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [jobId]);
  const second = await claimJob(db, jobId);
  assert.ok(second);
  assert.notEqual(second.claim_token, job.claim_token);
  await retryJob(db, job, new Error('stale worker'));
  assert.equal((await jobRow(jobId)).status, 'running');
});
