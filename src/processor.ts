import type { Fields, Job } from './domain.js';

// A local provider adapter: the uploaded JSON represents a synthetic document.
export async function extract(job: Job): Promise<Fields> {
  return { ...job.payload.source, issuer: job.payload.source.issuer.trim() };
}
