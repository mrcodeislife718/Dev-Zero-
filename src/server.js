import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IntegratedDevZeroRuntime } from './integrations.js';
import { DurableCommandJournal } from './command-journal.js';

const runtime = new IntegratedDevZeroRuntime();
const journal = new DurableCommandJournal(runtime);
const tokenPath = path.join(runtime.home, 'LOCAL_AUTH_TOKEN');
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, `${crypto.randomBytes(48).toString('base64url')}\n`, { mode: 0o600 });
const token = fs.readFileSync(tokenPath, 'utf8').trim();

function probeNetworkIsolation() {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('bwrap', ['--die-with-parent','--new-session','--ro-bind','/','/','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--unshare-net','--','/usr/bin/true'], { encoding:'utf8', timeout:5000 });
  return result.status === 0;
}
function probeResourceLimits() {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('prlimit', ['--as=67108864','--cpu=1','--','/usr/bin/true'], { encoding:'utf8', timeout:5000 });
  return result.status === 0;
}
const enforceableNetworkIsolation = probeNetworkIsolation();
const enforceableResourceLimits = probeResourceLimits();
const capabilities = Object.freeze({
  protocolVersions: [1],
  idempotentDispatch: true,
  networkIsolation: enforceableNetworkIsolation,
  resourceLimits: enforceableResourceLimits,
  rollback: true,
});

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(payload);
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw Object.assign(new Error('request too large'), { statusCode: 413 }); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function authorized(req) { return safeEqual(req.headers['x-dev-zero-token'], token); }
function runtimeStatus() {
  return { ...runtime.status(), isolation: enforceableNetworkIsolation ? 'bubblewrap' : 'unavailable', capabilities };
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, status: runtimeStatus() });
    if (!authorized(req)) return send(res, 401, { error: 'authentication_required' });
    if (req.method === 'GET' && url.pathname === '/v1/status') return send(res, 200, runtimeStatus());
    if (req.method === 'POST' && url.pathname === '/v1/repositories') return send(res, 201, runtime.attachRepository((await readJson(req)).rootPath));
    if (req.method === 'POST' && url.pathname === '/v1/workers') return send(res, 201, runtime.createWorker(await readJson(req)));
    let match;
    if ((match = url.pathname.match(/^\/v1\/workers\/([^/]+)\/provider-sessions$/)) && req.method === 'POST') return send(res, 201, runtime.bindProviderSession(decodeURIComponent(match[1]), await readJson(req)));
    if (req.method === 'POST' && url.pathname === '/v1/tasks') return send(res, 201, await runtime.createTask(await readJson(req)));
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/)) && req.method === 'GET') {
      const task = runtime.getTask(decodeURIComponent(match[1]));
      return task ? send(res, 200, task) : send(res, 404, { error: 'not_found' });
    }
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/resume$/)) && req.method === 'POST') return send(res, 200, runtime.resumeTask(decodeURIComponent(match[1]), (await readJson(req)).providerSessionId || null));
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/commands$/)) && req.method === 'POST') {
      const body = await readJson(req);
      return send(res, 200, await journal.execute(decodeURIComponent(match[1]), body.intent, { approved: body.approved === true, idempotencyKey: body.idempotencyKey }));
    }
    if ((match = url.pathname.match(/^\/v1\/dispatches\/([^/]+)\/reconcile$/)) && req.method === 'POST') {
      const body = await readJson(req);
      return send(res, 200, journal.reconcile(decodeURIComponent(match[1]), body.resolution));
    }
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/checkpoint$/)) && req.method === 'POST') return send(res, 201, await runtime.checkpointWithLineage(decodeURIComponent(match[1])));
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/rollback$/)) && req.method === 'POST') return send(res, 200, await runtime.rollbackWithLineage(decodeURIComponent(match[1])));
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/complete$/)) && req.method === 'POST') return send(res, 200, await runtime.completeTask(decodeURIComponent(match[1])));
    if ((match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/evidence$/)) && req.method === 'GET') return send(res, 200, { evidence: runtime.evidence(decodeURIComponent(match[1])) });
    if ((match = url.pathname.match(/^\/v1\/commands\/([^/]+)\/cancel$/)) && req.method === 'POST') return send(res, runtime.cancelCommand(decodeURIComponent(match[1])) ? 200 : 404, { cancelled: true });
    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    return send(res, error.statusCode || 400, { error: 'request_failed', message: error.message || String(error) });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const host = process.env.DEV_ZERO_HOST || '127.0.0.1';
  const port = Number(process.env.DEV_ZERO_PORT || 7330);
  server.listen(port, host, () => console.log(`Dev-Zero listening on http://${host}:${port}`));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { runtime.close(); process.exit(0); }));
