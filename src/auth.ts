import { createHash } from 'node:crypto';
import type { Database } from './db.js';
import { HttpError } from './domain.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function authenticate(db: Database, authorization: string | undefined): Promise<string> {
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');
  const result = await db.query<{ tenant_id: string }>(
    'SELECT tenant_id FROM api_keys WHERE token_hash = $1', [tokenHash(authorization.slice(7))]
  );
  const key = result.rows[0];
  if (!key) throw new HttpError(401, 'Invalid credentials');
  return key.tenant_id;
}
