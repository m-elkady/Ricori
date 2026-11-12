import type { PoolClient } from 'pg';
import type { Database } from './db.js';
import type { Document } from './domain.js';

type ListingSnapshot = Omit<Document, 'created_at' | 'updated_at' | 'deleted_at'> & {
  created_at: string; updated_at: string; deleted_at: string | null;
};

// The overview stores a snapshot so it can be read without assembling processing history.
export async function publishDocument(db: Database | PoolClient, document: Document) {
  await db.query(
    `INSERT INTO document_listing(document_id,tenant_id,snapshot,created_at)
     VALUES($1,$2,$3,$4) ON CONFLICT (document_id) DO UPDATE
     SET snapshot=EXCLUDED.snapshot,refreshed_at=now()`,
    [document.id, document.tenant_id, document, document.created_at]
  );
}

export async function readListing(db: Database, tenant: string) {
  const result = await db.query<{ snapshot: ListingSnapshot }>(
    'SELECT snapshot FROM document_listing WHERE tenant_id=$1 ORDER BY created_at DESC,document_id LIMIT 100', [tenant]
  );
  return result.rows.map(row => row.snapshot);
}
