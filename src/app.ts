import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Database } from './db.js';
import { authenticate } from './auth.js';
import { createSchema, HttpError, idSchema, reviewSchema } from './domain.js';
import { createDocument, deleteDocument, getDocument, listDocuments, reprocessDocument, reviewDocument } from './documents.js';
import { createHistoryReader } from './results.js';

export function buildApp(db: Database) {
  const app = Fastify({ logger: false, bodyLimit: 32_768 });
  const readHistory = createHistoryReader(db);
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid input', issues: error.issues });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: 'Invalid request' });
    console.error(JSON.stringify({ event: 'request_error', message: error.message }));
    return reply.code(500).send({ error: 'Internal error' });
  });
  app.get('/health', async () => { await db.query('SELECT 1'); return { status: 'ok' }; });
  app.register(async routes => {
    routes.decorateRequest('tenantId', '');
    routes.addHook('preHandler', async request => {
      request.tenantId = await authenticate(db, request.headers.authorization);
    });
    routes.get('/documents', async request => ({ documents: await listDocuments(db, request.tenantId) }));
    routes.post('/documents', async (request, reply) => {
      const result = await createDocument(db, request.tenantId, createSchema.parse(request.body));
      return reply.code(201).send(result);
    });
    routes.get<{ Params: { id: string } }>('/documents/:id', async request =>
      getDocument(db, request.tenantId, idSchema.parse(request.params.id)));
    routes.patch<{ Params: { id: string } }>('/documents/:id', async request =>
      reviewDocument(db, request.tenantId, idSchema.parse(request.params.id), reviewSchema.parse(request.body)));
    routes.post<{ Params: { id: string } }>('/documents/:id/process', async (request, reply) =>
      reply.code(202).send(await reprocessDocument(db, request.tenantId, idSchema.parse(request.params.id))));
    routes.delete<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
      await deleteDocument(db, request.tenantId, idSchema.parse(request.params.id));
      return reply.code(204).send();
    });
    routes.get<{ Params: { id: string } }>('/documents/:id/results', async request => ({
      results: await readHistory(request.tenantId, idSchema.parse(request.params.id))
    }));
  });
  return app;
}
declare module 'fastify' {
  interface FastifyRequest { tenantId: string }
}
