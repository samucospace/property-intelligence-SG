import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const TOTAL_TRIALS = 20;

console.log(`Starting ${TOTAL_TRIALS} consecutive fresh-disk database startup trials...`);

for (let i = 0; i < TOTAL_TRIALS; i++) {
  const dbFile = path.join(dir, `startup-trial-${Date.now()}-${i}.db`);
  const env = {
    ...process.env,
    DB_PATH: dbFile,
    PORT: '0',
    NODE_ENV: 'test',
    ADMIN_API_KEY: 'a'.repeat(48),
    UNSUBSCRIBE_SECRET: 'b'.repeat(48),
    RESEND_API_KEY: '',
    URA_ACCESS_KEY: '',
    BASE_URL: 'http://127.0.0.1'
  };

  const code = "const {startServer}=await import('./server/index.js'); const s=await startServer(); await new Promise(r=>s.close(r)); const {closeDb}=await import('./server/db.js'); await closeDb();";
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: path.resolve(dir, '../..'),
    env,
    encoding: 'utf8',
    timeout: 20000
  });

  const passed = run.status === 0 && !run.stderr.includes('SQLITE_BUSY');
  results.push({
    attempt: i + 1,
    exit: run.status,
    passed,
    sqliteBusy: run.stderr.includes('SQLITE_BUSY'),
    error: run.error?.message ?? null
  });

  // Clean up temporary database files
  try {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    if (fs.existsSync(`${dbFile}-wal`)) fs.unlinkSync(`${dbFile}-wal`);
    if (fs.existsSync(`${dbFile}-shm`)) fs.unlinkSync(`${dbFile}-shm`);
  } catch {}

  process.stdout.write(passed ? '.' : 'F');
}

console.log('\nCompleted trials.');
const allPassed = results.every(r => r.passed);
console.log(`Results: ${results.filter(r => r.passed).length}/${TOTAL_TRIALS} passed. (All passed: ${allPassed})`);

fs.writeFileSync(path.join(dir, 'startup-results.json'), JSON.stringify(results, null, 2));
if (!allPassed) {
  process.exit(1);
}
