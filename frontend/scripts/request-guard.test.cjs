const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('filter scans without affecting application requests; log real peers without secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcc-access-test-'));
  process.env.LCC_ACCESS_LOG_DIR = dir;
  process.env.LCC_REQUEST_GUARD = '1';
  const { blockedReason } = require('./request-guard.cjs');
  const reason = (url, headers = {}) => blockedReason({ url, headers });
  assert.equal(reason('/Orion/Login.aspx'), 'scanner-path');
  assert.equal(reason('/cgi-bin/view-source?../../etc/passwd'), 'scanner-path');
  assert.equal(reason('/images/..%2fsecret'), 'path-traversal');
  assert.equal(reason('/bad%ZZ'), 'invalid-path');
  assert.equal(reason('/', { 'next-action': 'x' }), 'unsupported-server-action');
  for (const url of ['/dashboard', '/login', '/terminals', '/files', '/logs', '/settings', '/_next/static/app.js', '/api/servers/1/preview?path=/home/code.php']) {
    assert.equal(reason(url), null, url);
  }
  let handled = 0;
  const server = http.createServer((req, res) => { handled++; res.end('app'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.LCC_HTTP_PORT = String(server.address().port);
  const request = (url, headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: url, headers }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  try {
    assert.equal(await request('/Orion/Login.aspx', { 'user-agent': 'guard-test' }), 404);
    assert.equal(await request('/dashboard?token=private', { 'x-forwarded-for': '203.0.113.1', cookie: 'secret=value' }), 200);
    assert.equal(handled, 1, 'blocked request must never enter app handler');
    const file = path.join(dir, `access-${new Date().toISOString().slice(0, 10)}.jsonl`);
    let records = [];
    for (let i = 0; i < 100; i++) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      records = text.trim().split('\n').filter(Boolean).map(JSON.parse);
      if (records.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(records.length, 2);
    assert.equal(records[0].blocked, 'scanner-path');
    assert.equal(records[1].peer, '127.0.0.1');
    assert.equal(records[1].forwardedFor, '203.0.113.1');
    assert.equal(records[1].path, '/dashboard');
    assert.match(records[0].time, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(!JSON.stringify(records).includes('private'));
    assert.ok(!JSON.stringify(records).includes('secret=value'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
