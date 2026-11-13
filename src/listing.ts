import type { PoolClient } from 'pg';
import type { Database } from './db.js';
import type { Document } from './domain.js';

type ListingSnapshot = Omit<Document, 'created_at' | 'updated_at' | 'deleted_at'> & {
  created_at: string; updated_at: string; deleted_at: string | null;
};

// The overview stores a snapshot so it can be read without assembling processing history.
export async function publishDocument(db: Database | PoolClient, document: Document) {
  if (document.deleted_at) return;
  await db.query(
    `INSERT INTO document_listing(document_id,tenant_id,snapshot,created_at)
     VALUES($1,$2,$3,$4) ON CONFLICT (document_id) DO UPDATE
     SET snapshot=EXCLUDED.snapshot,refreshed_at=now()
     WHERE (document_listing.snapshot->>'revision')::bigint <= (EXCLUDED.snapshot->>'revision')::bigint`,
    [document.id, document.tenant_id, document, document.created_at]
  );
}

export async function readListing(db: Database, tenant: string) {
  const result = await db.query<{ snapshot: ListingSnapshot }>(
    `SELECT l.snapshot FROM document_listing l JOIN documents d ON d.id=l.document_id
     WHERE l.tenant_id=$1 AND d.tenant_id=$1 AND d.deleted_at IS NULL
     ORDER BY l.created_at DESC,l.document_id LIMIT 100`, [tenant]
  );
  return result.rows.map(row => row.snapshot);
}
