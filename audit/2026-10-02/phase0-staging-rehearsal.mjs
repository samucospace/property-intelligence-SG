import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.NODE_ENV = 'staging';
process.env.DB_PATH = path.join(root, 'server/staging-phase0-20261002.db');
process.env.PORT = '3002';
process.env.RELEASE_SCOPE = 'analytics-readonly';
process.env.RESEND_API_KEY = 're_mock_staging';
process.env.URA_ACCESS_KEY = 'mock_staging';
process.env.ENABLE_OUTBOUND_EMAIL = 'false';
process.env.ENABLE_DATA_SYNC = 'false';
process.env.ENABLE_LEAD_CLEANUP = 'false';
process.env.ENABLE_STARTUP_LEAD_CLEANUP = 'false';
const { startServer } = await import('../../server/index.js');
const { dbGet, closeDb } = await import('../../server/db.js');
const server = await startServer();
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(base + '/api/health')).json();
  const features = await (await fetch(base + '/api/features')).json();
  const routes = {};
  for (const [method, endpoint] of [['POST', '/api/leads/submit'], ['GET', '/api/admin/leads'], ['GET', '/api/newsletter/confirm'], ['POST', '/api/ingest/ura']]) {
    routes[`${method} ${endpoint}`] = (await fetch(base + endpoint, { method })).status;
  }
  if (health.status !== 'ok' || features.leadCapture || Object.values(routes).some(status => status !== 403)) throw new Error('Staging containment verification failed');
  const leadCount = (await dbGet('SELECT COUNT(*) AS n FROM leads')).n;
  if (leadCount !== 2) throw new Error('Synthetic staging lead state changed');
  const result = { verifiedAt: new Date().toISOString(), runtime: process.version, health, features, routes, syntheticLeads: leadCount };
  fs.writeFileSync(path.join(root, 'audit/2026-10-02/phase0-staging-rehearsal.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); await closeDb(); }
