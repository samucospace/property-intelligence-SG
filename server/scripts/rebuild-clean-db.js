export { rebuildCleanDb, recoverInterruptedRebuild } from '../utils/rebuildEngine.js';
import { rebuildCleanDb } from '../utils/rebuildEngine.js';
import path from 'node:path';
import http from 'node:http';
// Diagnostic only: a listening port cannot establish database-wide quiescence.
export function checkIsServerRunning(port = process.env.PORT || 3001) {
  return new Promise(resolve => {
    const request = http.get(`http://localhost:${port}/api/health`, { timeout: 1000 }, response => { response.resume(); resolve(true); });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}
import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { rebuildCleanDb().catch(error => { console.error(error.message); process.exitCode = 1; }); }
