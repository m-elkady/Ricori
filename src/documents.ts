import { randomUUID } from 'node:crypto';
import { transaction, type Database } from './db.js';
import { HttpError, type CreateDocument, type Document, type ReviewDocument } from './domain.js';
import { publishDocument, readListing } from './listing.js';
import { enqueue } from './queue.js';

export async function createDocument(db: Database, tenant: string, input: CreateDocument) {
  return transaction(db, async client => {
    const result = await client.query<Document>(
      "INSERT INTO documents(id,tenant_id,title,source,status) VALUES($1,$2,$3,$4,'queued') RETURNING *",
      [randomUUID(), tenant, input.title, input.source]
    );
    const document = result.rows[0]!;
    const jobId = await enqueue(client, document);
    await publishDocument(client, document);
    return { document, jobId };
  });
}
export async function getDocument(db: Database, tenant: string, id: string): Promise<Document> {
  const result = await db.query<Document>(
    'SELECT * FROM documents WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [id, tenant]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Document not found');
  return result.rows[0];
}
export async function listDocuments(db: Database, tenant: string) {
  return readListing(db, tenant);
}
export async function reviewDocument(db: Database, tenant: string, id: string, input: ReviewDocument) {
  return transaction(db, async client => {
    const result = await client.query<Document>(
      `UPDATE documents SET fields=fields || $3::jsonb,status='reviewed',
      revision=revision+1, processing_version=processing_version+1, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND revision=$4 AND deleted_at IS NULL RETURNING *`,
      [id, tenant, input.fields, input.expectedRevision]
    );
    if (!result.rows[0]){
      const existing = await client.query<Document>(
        'SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [id, tenant]
      );
      if (existing.rowCount) throw new HttpError(409, 'Revision conflict');
      throw new HttpError(404, 'Document not found');
    }
    await publishDocument(client, result.rows[0]);
    return result.rows[0];
  });
}
export async function reprocessDocument(db: Database, tenant: string, id: string) {
  return transaction(db, async client => {
    const result = await client.query<Document>(
      "UPDATE documents SET status='queued',processing_version=processing_version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING *",
      [id, tenant]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Document not found');
    await publishDocument(client, result.rows[0]);
    return { jobId: await enqueue(client, result.rows[0]) };
  });
}
export async function deleteDocument(db: Database, tenant: string, id: string) {
  await transaction(db, async client => {
    const result = await client.query(
      `UPDATE documents SET deleted_at=now(),status='deleted',revision=revision+1,
       processing_version=processing_version+1,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenant]
    );
    if (!result.rowCount) throw new HttpError(404, 'Document not found');
    await client.query('DELETE FROM document_listing WHERE document_id=$1 AND tenant_id=$2', [id, tenant]);
    await client.query("UPDATE jobs SET status='cancelled' WHERE document_id=$1 AND status='queued'", [id]);
  });
}
