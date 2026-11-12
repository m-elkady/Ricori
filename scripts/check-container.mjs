import assert from 'node:assert/strict';
import { access, constants, stat } from 'node:fs/promises';

assert.equal(process.getuid?.(), 1000, 'Run the container checks as the image node user');
for (const path of ['/app', '/app/dist', '/app/node_modules', '/app/src', '/home/node']) {
  await access(path, constants.R_OK | constants.W_OK);
  assert.equal((await stat(path)).uid, 1000, path + ' must belong to node');
}
console.log('Container ownership and rebuild permissions verified for uid 1000');
