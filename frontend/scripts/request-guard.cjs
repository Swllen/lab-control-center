const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const logDir = process.env.LCC_ACCESS_LOG_DIR || path.join(__dirname, '..', 'logs');
const maxBytes = 10 * 1024 * 1024;
let pending = Promise.resolve();
let queued = 0;
let warned = false;

function pathname(url) {
  // Do not log query strings: file paths, tokens and other private data may appear there.
  return String(url || '/').split(/[?#]/, 1)[0].slice(0, 2048);
}

function blockedReason(req) {
  let p = pathname(req.url);
  try { p = decodeURIComponent(p); } catch { return 'invalid-path'; }
  if (p.includes('\0') || p.includes('\\') || p.split('/').includes('..')) return 'path-traversal';
  // API requests and Next assets keep their normal handling. Never inspect file contents/paths
  // carried in an API query or request body.
  if (p.startsWith('/api/') || p.startsWith('/_next/')) return null;
  if (/\.(?:php\d*|jsp|jspx|aspx?|cgi|cfm|cfc|dll|axd|do|action)(?:[;/]|$)/i.test(p)) return 'scanner-path';
  if (/^\/(?:cgi-bin|CFIDE|messagebroker|flex2gateway|blazeds|owa|ecp|wordpress|joomla|drupal)(?:\/|$)/i.test(p)) return 'scanner-path';
  // This application uses REST, not Server Actions. Reject action probes before Next decodes them.
  if (req.headers['next-action']) return 'unsupported-server-action';
  return null;
}

function record(entry) {
  const line = JSON.stringify(entry) + '\n';
  console.log('[access] ' + line.trimEnd());
  // Bound pending writes if storage is slow. A full daily file stops growing until the next day.
  if (queued >= 1000) return;
  queued++;
  pending = pending.then(async () => {
    await fs.mkdir(logDir, { recursive: true });
    const file = path.join(logDir, `access-${entry.time.slice(0, 10)}.jsonl`);
    const size = await fs.stat(file).then(s => s.size, e => { if (e.code === 'ENOENT') return 0; throw e; });
    if (size + Buffer.byteLength(line) <= maxBytes) await fs.appendFile(file, line);
    else if (!warned) { warned = true; console.warn('[access] Daily log size limit reached; console logging continues.'); }
  }).catch(error => {
    if (!warned) { warned = true; console.warn('[access] Cannot write access log:', error.code || 'write-failed'); }
  }).finally(() => { queued--; });
}

function install() {
  const original = http.Server.prototype.emit;
  http.Server.prototype.emit = function(event, req, res, ...rest) {
    // Next also creates internal HTTP servers; only inspect the public listening port.
    if (event !== 'request' || req.socket.localPort !== Number(process.env.LCC_HTTP_PORT || 3000)) {
      return original.call(this, event, req, res, ...rest);
    }
    const start = performance.now();
    const time = new Date().toISOString();
    const peer = req.socket.remoteAddress || 'unknown';
    const peerPort = req.socket.remotePort;
    const requestPath = pathname(req.url);
    const reason = blockedReason(req);
    res.once('finish', () => record({
      time,
      peer,
      peerPort,
      method: req.method,
      path: requestPath,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 512),
      // Diagnostic only; headers are client-controlled and are NOT trusted as the source IP.
      forwardedFor: String(req.headers['x-forwarded-for'] || '').slice(0, 256),
      ...(reason ? { blocked: reason } : {}),
    }));
    if (reason) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
      req.resume();
      return true;
    }
    return original.call(this, event, req, res, ...rest);
  };
}

if (process.env.LCC_REQUEST_GUARD === '1') install();
module.exports = { blockedReason, pathname };
