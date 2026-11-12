CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE api_keys (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  label text NOT NULL
);
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  source jsonb NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued','processing','ready','reviewed','deleted')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX documents_tenant ON documents(tenant_id, created_at) WHERE deleted_at IS NULL;
CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  payload jsonb NOT NULL,
  base_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  claim_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, tenant_id) REFERENCES documents(id, tenant_id)
);
CREATE INDEX jobs_poll ON jobs(status, available_at, created_at);
CREATE TABLE processing_results (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  fields jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX results_document ON processing_results(document_id, created_at);
