import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.API_URL ?? 'http://127.0.0.1:3100';
async function api(method, path, body) {
  const response = await fetch(base + path, {
    method, headers: { authorization: 'Bearer alice-local-token', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
  });
  const value = response.status === 204 ? undefined : await response.json();
  assert.ok(response.ok, JSON.stringify({ status: response.status, value }));
  return value;
}
assert.equal((await api('GET', '/health')).status, 'ok');
const { document } = await api('POST', '/documents', { title: 'Smoke test',
  source: { issuer: 'Example Smoke Co', amountCents: 1500, currency: 'EUR', dueDate: '2027-02-01' } });
try {
  const deadline = Date.now() + 15000;
  let current;
  do {
    current = await api('GET', '/documents/' + document.id);
    if (current.status === 'ready') break;
    assert.ok(Date.now() < deadline, 'Worker did not finish within 15 seconds');
    await delay(50);
  } while (true);
  assert.equal(current.fields.amountCents, 1500);
  assert.equal((await api('GET', '/documents/' + document.id + '/results')).results.length, 1);
  const reviewed = await api('PATCH', '/documents/' + document.id, { expectedRevision: current.revision, fields: { amountCents: 1600 } });
  assert.equal(reviewed.fields.amountCents, 1600);
} finally {
  await api('DELETE', '/documents/' + document.id);
}
const deleted = await fetch(base + '/documents/' + document.id, { headers: { authorization: 'Bearer alice-local-token' } });
assert.equal(deleted.status, 404);
console.log('Smoke passed: HTTP create -> worker -> history -> review -> delete');
