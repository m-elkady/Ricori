import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createPool, type Database } from './db.js';
import { claimJob, retryJob } from './queue.js';
import { extract } from './processor.js';
import { applyResult } from './results.js';
import { publishDocument } from './listing.js';

export async function runOnce(db: Database, jobId?: string): Promise<boolean> {
  const job = await claimJob(db, jobId);
  if (!job) return false;
  try {
    const fields = await extract(job);
    const document = await applyResult(db, { job, fields, receiptKey: job.id });
    if (document) await publishDocument(db, document);
    return true;
  } catch (error) {
    await retryJob(db, job, error);
    throw error;
  }
}
async function main() {
  const db = createPool(process.env.APP_NAME ?? 'ricori-worker');
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  const once = process.argv.includes('--once');
  const jobId = process.argv.find(arg => arg.startsWith('--job='))?.slice(6);
  try {
    do {
      try {
        const worked = await runOnce(db, jobId);
        if (!worked && !once) await delay(250);
      } catch (error) {
        console.error(JSON.stringify({ event: 'job_error', message: error instanceof Error ? error.message : 'Unknown error' }));
        if (once) throw error;
        await delay(250);
      }
    } while (!once && !stopping);
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.exitCode = 1; });
}
