import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction, type Database } from './db.js';
import type { Document, Job } from './domain.js';

export async function enqueue(client: PoolClient, document: Document) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO jobs(id,document_id,tenant_id,payload,source_version) VALUES($1,$2,$3,$4,$5)',
    [id, document.id, document.tenant_id, { title: document.title, source: document.source }, document.processing_version]
  );
  return id;
}

export async function claimJob(db: Database, jobId?: string): Promise<Job | undefined> {
  return transaction(db, async client => {
    await client.query(
      "UPDATE jobs SET status='failed',last_error='Retry budget exhausted' WHERE status='running' AND lease_until<now() AND attempts>=5"
    );
    const result = await client.query<Job>(
      `WITH next AS (
         SELECT id FROM jobs
         WHERE (status='queued' AND available_at<=now() OR status='running' AND lease_until<now())
           AND attempts<5 AND ($1::uuid IS NULL OR id=$1)
         ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE jobs SET status='running',attempts=attempts+1,claim_token=$2,
         lease_until=now()+interval '30 seconds'
       FROM next WHERE jobs.id=next.id RETURNING jobs.*`,
      [jobId ?? null, randomUUID()]
    );
    const job = result.rows[0];
    if (job) await client.query(
      `UPDATE documents SET status='processing',updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL AND status='queued' AND processing_version=$2`, [job.document_id, job.source_version]
    );
    return job;
  });
}
export async function acknowledgeJob(db: Database | PoolClient, job: Job) {
  await db.query(
    "UPDATE jobs SET status='completed',lease_until=NULL,last_error=NULL WHERE id=$1 AND claim_token=$2",
    [job.id, job.claim_token]
  );
}
export async function retryJob(db: Database, job: Job, error: unknown) {
  await db.query(
    `UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,
      lease_until=NULL,available_at=now(),last_error=$3 WHERE id=$1 AND claim_token=$2`,
    [job.id, job.claim_token, error instanceof Error ? error.message.slice(0,300) : 'Processing failed']
  );
}
