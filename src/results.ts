import { randomUUID } from 'node:crypto';
import { transaction, type Database } from './db.js';
import { getDocument } from './documents.js';
import type { Document, Fields, ProcessingDelivery } from './domain.js';
import { createReadCache } from './read-cache.js';

export async function applyResult(db: Database, delivery: ProcessingDelivery): Promise<Document | undefined> {
  const { job, fields, receiptKey } = delivery;
  return transaction(db, async client => {
    const received = await client.query<{ id: string }>(
      `INSERT INTO processing_results(id,job_id,document_id,fields,receipt_key) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (receipt_key) DO NOTHING RETURNING id`,
      [randomUUID(), job.id, job.document_id, fields, receiptKey]
    );
    if (!received.rows[0]) return undefined;
    const updated = await client.query<Document>(
      `UPDATE documents SET fields=$3,status='ready',revision=revision+1,
       result_count=result_count+1,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND processing_version=$4 AND deleted_at IS NULL RETURNING *`,
      [job.document_id, job.tenant_id, fields, job.source_version]
    );
    if (!updated.rows[0]) {
      await client.query('DELETE FROM processing_results WHERE id=$1', [received.rows[0].id]);
    }
    return updated.rows[0];
  });
}

interface HistoryEntry { id: string; job_id: string; fields: Fields; created_at: Date }
export function createHistoryReader(db: Database) {
  const cache = createReadCache<HistoryEntry[]>(30_000, 100);
  return async (tenant: string, documentId: string) => cache.read(documentId, async () => {
    await getDocument(db, tenant, documentId);
    const result = await db.query<HistoryEntry>(
      `SELECT r.id,r.job_id,r.fields,r.created_at FROM processing_results r
       JOIN documents d ON d.id=r.document_id
       WHERE r.document_id=$1 AND d.tenant_id=$2 AND d.deleted_at IS NULL ORDER BY r.created_at,r.id`,
      [documentId, tenant]
    );
    return result.rows;
  });
}
