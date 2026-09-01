#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = process.env.DEV_ZERO_HOME || path.join(os.homedir(), '.dev-zero');
const token = fs.readFileSync(path.join(home, 'LOCAL_AUTH_TOKEN'), 'utf8').trim();
const base = process.env.DEV_ZERO_URL || 'http://127.0.0.1:7330';
const [command, ...args] = process.argv.slice(2);

async function request(method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'x-dev-zero-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${payload.message || payload.error}`);
  console.log(JSON.stringify(payload, null, 2));
}

if (command === 'status') await request('GET', '/v1/status');
else if (command === 'attach') await request('POST', '/v1/repositories', { rootPath: args[0] });
else if (command === 'worker-create') await request('POST', '/v1/workers', { name: args[0], role: args[1] || 'builder' });
else if (command === 'task-show') await request('GET', `/v1/tasks/${encodeURIComponent(args[0])}`);
else if (command === 'task-evidence') await request('GET', `/v1/tasks/${encodeURIComponent(args[0])}/evidence`);
else if (command === 'task-rollback') await request('POST', `/v1/tasks/${encodeURIComponent(args[0])}/rollback`, {});
else {
  console.error('Usage: dev-zero status | attach <repo> | worker-create <name> [role] | task-show <id> | task-evidence <id> | task-rollback <id>');
  process.exit(2);
}
