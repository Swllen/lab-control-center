const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('bulk deletion bounds requests, handles stale records, and preserves failed IDs', async () => {
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  let active = 0;
  let peak = 0;
  const calls = [];
  const api = async (url, options) => {
    assert.equal(options.method, 'DELETE');
    calls.push(url);
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (url.endsWith('/2')) throw new ApiError(404, 'Already removed');
    if (url.endsWith('/3')) throw new ApiError(409, 'Job is still active');
    if (url.endsWith('/5')) throw new Error('Network error');
  };
  const source = fs.readFileSync(path.join(__dirname, '../lib/api/index.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    Error,
    require: name => { assert.equal(name, './client'); return { api, ApiError }; },
  });
  const result = JSON.parse(JSON.stringify(await exports.jobsApi.removeMany([1, 2, 3, 4, 5, 6, 1])));
  assert.deepEqual(result.deleted, [1, 2, 4, 6]);
  assert.deepEqual(result.failed, [{ id: 3, message: 'Job is still active' }, { id: 5, message: 'Network error' }]);
  assert.equal(calls.length, 6);
  assert.equal(peak, 4);
  const before = calls.length;
  assert.deepEqual(JSON.parse(JSON.stringify(await exports.jobsApi.removeMany([]))), { deleted: [], failed: [] });
  assert.equal(calls.length, before);
});
