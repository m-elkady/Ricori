import { buildApp } from './app.js';
import { createPool } from './db.js';

const db = createPool(process.env.APP_NAME ?? 'ricori-api');
const app = buildApp(db);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.close();
  await db.end();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try {
  await app.listen({ port: Number(process.env.PORT ?? 3100), host: process.env.HOST ?? '0.0.0.0' });
  console.log(JSON.stringify({ event: 'listening', address: app.server.address() }));
} catch (error) {
  console.error(error);
  await shutdown();
  process.exitCode = 1;
}
