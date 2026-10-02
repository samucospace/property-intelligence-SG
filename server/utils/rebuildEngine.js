import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createConnection, getDbPath, hasOpenConnections } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { seedAmenities } from '../livabilityEngine.js';
import { seedSoraRates } from '../ingestion.js';
import { openReadonly, databaseMetrics, fileHash } from './databaseArtifacts.js';

const marketTables = new Set(['projects', 'property_transactions', 'rental_transactions', 'project_benchmarks', 'amenities', 'sora_rates', 'seed_versions', 'schema_migrations', 'schema_lock']);
const quote = name => '"' + name.replaceAll('"', '""') + '"';

function isolated(target) {
  if (process.env.NODE_ENV !== 'test' || !target || path.resolve(target) === path.resolve(getDbPath()) || path.resolve(target) === path.resolve('server/property.db')) {
    throw new Error('Rebuild is quarantined pending Phase 1 verification. Only isolated injected test fixtures are permitted.');
  }
}

async function operationalState(file) {
  const conn = openReadonly(file);
  try {
    const result = {};
    for (const { name, sql } of await conn.all("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
      if (marketTables.has(name)) continue;
      // Preserve schemas and exact row multisets, including future suppression/job tables.
      result[name] = { sql, rows: (await conn.all('SELECT * FROM ' + quote(name))).map(row => JSON.stringify(row)).sort() };
    }
    return JSON.stringify(result);
  } finally { await conn.close(); }
}

function persist(file, record) {
  const temp = file + '.tmp';
  const descriptor = fs.openSync(temp, 'w');
  try { fs.writeFileSync(descriptor, JSON.stringify(record, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temp, file);
}

async function checkpoint(conn) {
  const row = await conn.get('PRAGMA wal_checkpoint(TRUNCATE)');
  if (!row || row.busy !== 0 || row.log > 0) throw new Error('Rebuild checkpoint busy or incomplete; refusing swap');
}

// Roll back any nonfinalized swap. Used explicitly after a terminated fixture
// worker; application startup rejects pending journals instead of guessing.
export async function recoverInterruptedRebuild(target) {
  isolated(target);
  target = path.resolve(target);
  const journal = target + '.swap.json';
  if (!fs.existsSync(journal)) return { recovered: false };
  const record = JSON.parse(fs.readFileSync(journal, 'utf8'));
  try { process.kill(record.pid, 0); throw new Error('Rebuild owner is still running'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (const file of [record.backup, record.candidate]) {
    if (path.dirname(file) !== path.dirname(target) || !file.startsWith(target + '.')) throw new Error('Invalid rebuild recovery path');
  }
  if (fs.existsSync(record.backup)) {
    if (fileHash(record.backup) !== record.originalHash) throw new Error('Rebuild rollback backup hash mismatch');
    await databaseMetrics(record.backup);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.renameSync(record.backup, target);
  } else if (!fs.existsSync(target) || fileHash(target) !== record.originalHash) {
    throw new Error('Original rebuild database unavailable; manual recovery required');
  }
  if (fs.existsSync(record.candidate)) fs.unlinkSync(record.candidate);
  fs.unlinkSync(journal);
  if (fs.existsSync(target + '.maintenance')) fs.unlinkSync(target + '.maintenance');
  return { recovered: true };
}

export async function rebuildCleanDb(options = {}) {
  isolated(options.targetLivePath);
  if (typeof options.dataProvider !== 'function') throw new Error('Rebuild is quarantined: injected fixture provider required');
  const target = path.resolve(options.targetLivePath);
  if (hasOpenConnections(target)) throw new Error('Open source handles; stop all database users before rebuild');
  const lock = target + '.maintenance';
  const journal = target + '.swap.json';
  if (fs.existsSync(journal)) throw new Error('Interrupted rebuild requires explicit recovery');
  const descriptor = fs.openSync(lock, 'wx');
  fs.writeFileSync(descriptor, String(process.pid));
  fs.closeSync(descriptor);
  const candidate = target + '.rebuild-' + crypto.randomUUID() + '.db';
  const backup = target + '.backup-' + crypto.randomUUID();
  let conn;
  let originalHash;
  let state;
  let oldMetrics;
  let moved = false;
  let installed = false;
  try {
    if (!fs.existsSync(target)) throw new Error('Rebuild requires an existing recoverable source');
    const source = createConnection(target, { maintenance: true });
    try {
      await checkpoint(source);
      await source.run('VACUUM INTO ?', [candidate]);
    } finally { await source.close(); }
    originalHash = fileHash(target);
    oldMetrics = await databaseMetrics(target);
    state = await operationalState(target);
    conn = createConnection(candidate);
    await runMigrations(conn);
    await conn.run('BEGIN IMMEDIATE');
    try {
      await conn.run('DELETE FROM property_transactions');
      await conn.run('DELETE FROM rental_transactions');
      await conn.run('DELETE FROM project_benchmarks');
      // Keep catalog IDs stable for operational references, including embedded
      // lead context and future FK-backed suppression tables. Catalog deletion
      // needs the separately adjudicated Phase 2 identity/reconciliation plan.
      await conn.run('COMMIT');
    } catch (error) { await conn.run('ROLLBACK'); throw error; }
    const result = await options.dataProvider(conn);
    if (!result || result.status !== 'success' || result.sourceCompleteness === 'unverified') throw new Error('Data ingestion failed or returned partial results; authoritative completeness required');
    await seedAmenities(true, conn);
    await seedSoraRates(conn);
    await checkpoint(conn);
    await conn.close();
    conn = null;
    const metrics = await databaseMetrics(candidate);
    const minimum = options.minimumCounts || { projects: 5500, sales: 130000, rentals: 440000 };
    for (const [key, table] of [['projects', 'projects'], ['sales', 'property_transactions'], ['rentals', 'rental_transactions']]) {
      if (!Number.isInteger(minimum[key]) || minimum[key] < 1 || metrics.counts[table] < Math.max(minimum[key], oldMetrics.counts[table] || 0)) throw new Error('Pre-swap Population Gate FAILED: ' + key);
    }
    if (await operationalState(candidate) !== state) throw new Error('Operational state preservation failed');
    // Read-only inspection may create zero-length WAL/SHM sidecars. A final
    // writable checkpoint/close cleans them only when no other handle remains.
    const finalSource = createConnection(target, { maintenance: true });
    try { await checkpoint(finalSource); } finally { await finalSource.close(); }
    if (fileHash(target) !== originalHash) throw new Error('Source changed while rebuild was prepared');
    if (fs.existsSync(target + '-wal') || fs.existsSync(target + '-shm')) throw new Error('Source WAL/SHM handles remain; refusing swap');
    persist(journal, { pid: process.pid, target, candidate, backup, originalHash });
    await options.onSwapStage?.('prepared');
    fs.renameSync(target, backup);
    moved = true;
    await options.onSwapStage?.('source-moved');
    fs.renameSync(candidate, target);
    installed = true;
    await options.onSwapStage?.('installed');
    await databaseMetrics(target);
    if (await operationalState(target) !== state) throw new Error('Post-swap operational state differs');
    persist(target + '.generation', { generation: crypto.randomUUID() });
    fs.unlinkSync(journal);
    return { success: true, targetPath: target, backupPath: backup };
  } catch (error) {
    if (conn) await conn.close();
    if (moved) {
      if (fileHash(backup) !== originalHash) throw new Error('Rollback backup damaged; preserve journal for recovery', { cause: error });
      if (installed && fs.existsSync(target)) fs.unlinkSync(target);
      fs.renameSync(backup, target);
      await databaseMetrics(target);
      if (await operationalState(target) !== state) throw new Error('Rollback verification failed', { cause: error });
    }
    if (fs.existsSync(journal)) fs.unlinkSync(journal);
    throw error;
  } finally {
    // Retain recovery artifacts/lock if rollback could not complete.
    if (!fs.existsSync(journal)) {
      for (const file of [candidate, candidate + '-wal', candidate + '-shm', lock]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}
