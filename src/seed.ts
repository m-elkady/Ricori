import { createPool, transaction } from './db.js';
import { tokenHash } from './auth.js';

const db = createPool('ricori-seed');
try {
  await transaction(db, async client => {
    for (const [id, name, token] of [
      ['11111111-1111-4111-8111-111111111111','Alice Example','alice-local-token'],
      ['22222222-2222-4222-8222-222222222222','Bob Example','bob-local-token']
    ] as const) {
      await client.query('INSERT INTO tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [id,name]);
      await client.query('INSERT INTO api_keys(token_hash,tenant_id,label) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tokenHash(token),id,name]);
    }
    await client.query(
      `INSERT INTO documents(id,tenant_id,title,source,status,fields,revision)
       VALUES($1,$2,$3,$4,'reviewed',$4,1) ON CONFLICT DO NOTHING`,
      ['33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
       'Synthetic sample invoice',{ issuer:'Example Utilities',amountCents:4200,currency:'EUR',dueDate:'2027-01-15' }]
    );
  });
  await db.query(
    `INSERT INTO document_listing(document_id,tenant_id,snapshot,created_at)
     SELECT id,tenant_id,to_jsonb(documents),created_at FROM documents
     WHERE id='33333333-3333-4333-8333-333333333333' AND deleted_at IS NULL
     ON CONFLICT DO NOTHING`
  );
  console.log('Synthetic tenants and sample document ready');
} finally { await db.end(); }
