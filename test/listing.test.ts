// Tests for src/listing.ts: publishDocument and readListing.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Document } from '../src/domain.js';
import { publishDocument, readListing } from '../src/listing.js';
import { alice, createDocument, makeTestContext, overviewIds } from './helpers.js';

const ctx = makeTestContext('listing_test');
const { db, app } = ctx;

before(ctx.setup);
after(ctx.teardown);

async function listingRow(documentId: string) {
  return (await db.query('SELECT snapshot FROM document_listing WHERE document_id=$1', [documentId])).rows[0] as
    { snapshot: Document } | undefined;
}

test('publishDocument: never writes a document that is already marked deleted', async () => {
  const { document } = await createDocument(app);
  await db.query('DELETE FROM document_listing WHERE document_id=$1', [document.id]);
  await publishDocument(db, { ...document, deleted_at: new Date() });
  assert.equal(await listingRow(document.id), undefined);
});

test('publishDocument: never lets an older revision replace a newer one already in the overview', async () => {
  const { document: stale } = await createDocument(app);
  const review = await app.inject({ method: 'PATCH', url: '/documents/' + stale.id, headers: alice,
    payload: { expectedRevision: stale.revision, fields: { amountCents: 4300 } } });
  assert.equal(review.statusCode, 200, review.body);

  await publishDocument(db, stale); // the pre-correction copy, revision 0, amount 4200

  const row = await listingRow(stale.id);
  assert.equal(row?.snapshot.revision, review.json<Document>().revision);
  assert.equal(row?.snapshot.fields.amountCents, 4300);
});

test('readListing: hides a document once it is deleted, even if its listing row was left behind', async () => {
  const { document } = await createDocument(app);
  await db.query("UPDATE documents SET deleted_at=now(), status='deleted' WHERE id=$1", [document.id]);
  // The listing row itself is untouched, to prove the filtering comes from the join, not from the row's absence.
  assert.ok(await listingRow(document.id));
  assert.ok(!(await readListing(db, document.tenant_id)).some(item => item.id === document.id));
  assert.ok(!(await overviewIds(app)).includes(document.id));
});

test('readListing: an ordinary document is visible and scoped to its tenant', async () => {
  const { document } = await createDocument(app);
  assert.ok((await overviewIds(app)).includes(document.id));
  assert.ok(!(await overviewIds(app, { authorization: 'Bearer bob-local-token' })).includes(document.id));
});
