// Tests for src/documents.ts: reviewDocument and deleteDocument.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Document } from '../src/domain.js';
import { createDocument, detail, makeTestContext, overviewIds, waitForBlockedQueries } from './helpers.js';

const ctx = makeTestContext('documents_test');
const { db, app, admin, appName } = ctx;

before(ctx.setup);
after(ctx.teardown);

async function save(id: string, expectedRevision: number, amountCents: number) {
  return app.inject({ method: 'PATCH', url: '/documents/' + id, headers: { authorization: 'Bearer alice-local-token' },
    payload: { expectedRevision, fields: { amountCents } } });
}
async function jobStatus(jobId: string) {
  return (await db.query<{ status: string }>('SELECT status FROM jobs WHERE id=$1', [jobId])).rows[0]!.status;
}
async function listingRowCount(documentId: string) {
  return (await db.query('SELECT 1 FROM document_listing WHERE document_id=$1', [documentId])).rowCount ?? 0;
}

test('reviewDocument: two saves with the same revision race, exactly one wins and the other gets 409', async () => {
  const { document } = await createDocument(app);
  const blocker = await db.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT 1 FROM documents WHERE id=$1 FOR UPDATE', [document.id]);
  const pending = Promise.all([save(document.id, document.revision, 1111), save(document.id, document.revision, 2222)]);
  await waitForBlockedQueries(admin, appName, 2);
  await blocker.query('COMMIT');
  blocker.release();
  const responses = await pending;
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  const winner = responses.find(response => response.statusCode === 200)!.json<Document>();
  const stored = (await detail(app, document.id)).json<Document>();
  assert.equal(stored.fields.amountCents, winner.fields.amountCents);
  assert.equal(stored.revision, document.revision + 1);
});

test('reviewDocument: a stale revision on an existing document is a 409, not a 404', async () => {
  const { document } = await createDocument(app);
  const first = await save(document.id, document.revision, 4300);
  assert.equal(first.statusCode, 200, first.body);
  const second = await save(document.id, document.revision, 4400);
  assert.equal(second.statusCode, 409, second.body);
});

test('reviewDocument: a missing document is a 404, even with a plausible revision', async () => {
  const response = await save('00000000-0000-4000-8000-000000000000', 0, 4300);
  assert.equal(response.statusCode, 404);
});

test('deleteDocument: cancels a still-queued job', async () => {
  const { document, jobId } = await createDocument(app);
  assert.equal((await app.inject({ method: 'DELETE', url: '/documents/' + document.id, headers: { authorization: 'Bearer alice-local-token' } })).statusCode, 204);
  assert.equal(await jobStatus(jobId), 'cancelled');
});

test('deleteDocument: cancels a running job so a late result does not revive the document', async () => {
  const { document, jobId } = await createDocument(app);
  const { claimJob } = await import('../src/queue.js');
  const job = await claimJob(db, jobId);
  assert.ok(job, 'job should be claimable');
  assert.equal((await app.inject({ method: 'DELETE', url: '/documents/' + document.id, headers: { authorization: 'Bearer alice-local-token' } })).statusCode, 204);
  assert.equal(await jobStatus(jobId), 'cancelled');
  const { extract } = await import('../src/processor.js');
  const { applyResult } = await import('../src/results.js');
  const fields = await extract(job);
  assert.equal(await applyResult(db, { job, fields, receiptKey: job.id }), undefined);
  assert.equal(await jobStatus(jobId), 'cancelled');
  assert.equal((await detail(app, document.id)).statusCode, 404);
  assert.ok(!(await overviewIds(app)).includes(document.id));
  assert.equal(await listingRowCount(document.id), 0);
});

test('deleteDocument: racing with a finishing job never leaves a deleted document published (also exercises the lock order)', async () => {
  const { claimJob } = await import('../src/queue.js');
  const { extract } = await import('../src/processor.js');
  const { applyResult } = await import('../src/results.js');
  for (let i = 0; i < 8; i++) {
    const { document, jobId } = await createDocument(app);
    const job = await claimJob(db, jobId);
    assert.ok(job);
    const [, removed] = await Promise.all([
      extract(job).then(fields => applyResult(db, { job, fields, receiptKey: job.id })),
      app.inject({ method: 'DELETE', url: '/documents/' + document.id, headers: { authorization: 'Bearer alice-local-token' } })
    ]);
    assert.equal(removed.statusCode, 204);
    assert.ok(!(await overviewIds(app)).includes(document.id));
    assert.equal(await listingRowCount(document.id), 0);
  }
});

test('reviewDocument: a normal correction still works and is published in the overview', async () => {
  const { document } = await createDocument(app);
  const response = await save(document.id, document.revision, 4300);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<Document>().fields.amountCents, 4300);
  const overview = (await app.inject({ url: '/documents', headers: { authorization: 'Bearer alice-local-token' } })).json<{ documents: Document[] }>();
  assert.equal(overview.documents.find(item => item.id === document.id)?.fields.amountCents, 4300);
});
