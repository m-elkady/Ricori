import { z } from 'zod';

export const fieldsSchema = z.object({
  issuer: z.string().min(1).max(160),
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z.enum(['EUR', 'USD', 'GBP']),
  dueDate: z.iso.date()
}).strict();
export const createSchema = z.object({
  title: z.string().min(1).max(160),
  source: fieldsSchema
}).strict();
export const reviewSchema = z.object({
  expectedRevision: z.number().int().min(0),
  fields: fieldsSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one field')
}).strict();
export const idSchema = z.uuid();
export type Fields = z.infer<typeof fieldsSchema>;
export type CreateDocument = z.infer<typeof createSchema>;
export type ReviewDocument = z.infer<typeof reviewSchema>;
export interface Document {
  id: string;
  tenant_id: string;
  title: string;
  source: Fields;
  fields: Partial<Fields>;
  status: 'queued' | 'processing' | 'ready' | 'reviewed' | 'deleted';
  revision: number;
  processing_version: number;
  result_count: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export interface Job {
  id: string;
  document_id: string;
  tenant_id: string;
  payload: CreateDocument;
  source_version: number;
  claim_token: string;
  attempts: number;
}
export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export interface ProcessingDelivery {
  job: Job;
  receiptKey: string;
  fields: Fields;
}
