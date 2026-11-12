ALTER TABLE documents ADD COLUMN processing_version integer NOT NULL DEFAULT 0 CHECK (processing_version >= 0);
ALTER TABLE jobs RENAME COLUMN base_revision TO source_version;
UPDATE jobs SET source_version=0;
ALTER TABLE processing_results ADD COLUMN receipt_key uuid;
UPDATE processing_results SET receipt_key=id;
ALTER TABLE processing_results ALTER COLUMN receipt_key SET NOT NULL;
CREATE UNIQUE INDEX results_receipt ON processing_results(receipt_key);

CREATE TABLE document_listing (
  document_id uuid PRIMARY KEY REFERENCES documents(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_tenant ON document_listing(tenant_id,created_at);
INSERT INTO document_listing(document_id,tenant_id,snapshot,created_at)
SELECT id,tenant_id,to_jsonb(documents),created_at FROM documents WHERE deleted_at IS NULL;
