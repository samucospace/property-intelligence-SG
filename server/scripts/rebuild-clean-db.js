import '../config.js';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { fetchUraData, seedSoraRates } from '../ingestion.js';
import { seedAmenities } from '../livabilityEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const liveDbPath = process.env.DB_PATH || path.join(__dirname, '../property.db');

export function checkIsServerRunning(port = process.env.PORT || 3001) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/api/health`, { timeout: 1000 }, () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Dynamically preserves all rows and columns from an existing table.
 */
async function preserveTableRows(conn, tableName) {
  try {
    const tableExists = await conn.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    if (!tableExists) return null;

    const cols = await conn.all(`PRAGMA table_info(${tableName})`);
    const colNames = cols.map(c => c.name);
    const rows = await conn.all(`SELECT * FROM ${tableName}`);
    return { tableName, colNames, rows };
  } catch (err) {
    console.warn(`[Rebuild] Warning: Could not preserve table '${tableName}':`, err.message);
    return null;
  }
}

/**
 * Restores dynamically preserved rows into target connection.
 */
async function restoreTableRows(conn, tableBackup) {
  if (!tableBackup || !Array.isArray(tableBackup.rows) || tableBackup.rows.length === 0) {
    return 0;
  }
  const { tableName, colNames, rows } = tableBackup;
  const placeholders = colNames.map(() => '?').join(',');
  const colSql = colNames.join(',');

  let count = 0;
  for (const row of rows) {
    const values = colNames.map(col => row[col]);
    await conn.run(
      `INSERT OR REPLACE INTO ${tableName} (${colSql}) VALUES (${placeholders})`,
      values
    );
    count++;
  }
  return count;
}

/**
 * Executes a safe, atomic, end-to-end database rebuild.
 * @param {object} options
 * @param {string} [options.targetLivePath] Override live path (for test isolation)
 * @param {string} [options.accessKey] URA API Key
 * @param {boolean} [options.isForce] Skip server check
 * @param {Function} [options.dataProvider] Custom sync provider for testing
 */
export async function rebuildCleanDb(options = {}) {
  const targetPath = options.targetLivePath || liveDbPath;
  const isForce = options.isForce || process.argv.includes('--force');
  const timestamp = Date.now();
  const rebuildDbPath = `${targetPath}.rebuild-${timestamp}.db`;

  console.log('====================================================');
  console.log(' Singapore Home Intel - Hardened Clean Database Rebuild');
  console.log(` Target Path: ${targetPath}`);
  console.log('====================================================\n');

  // Step 1: Pre-flight Safety Checks
  if (!isForce) {
    const isRunning = await checkIsServerRunning();
    if (isRunning) {
      throw new Error(
        'The web application server is currently running. Stop the server before rebuilding or pass --force if isolated.'
      );
    }
  }

  const accessKey = options.accessKey || process.env.URA_ACCESS_KEY;
  if (!accessKey && !options.dataProvider) {
    throw new Error('URA_ACCESS_KEY is required for full database rebuild.');
  }

  // Step 2: Preserve Operational Tables from Live Database
  let preservedLeads = null;
  let preservedJobHistory = null;

  if (fs.existsSync(targetPath)) {
    console.log('[Step 1/6] Preserving operational state (leads, job history) from live database...');
    const liveConn = createConnection(targetPath);
    try {
      preservedLeads = await preserveTableRows(liveConn, 'leads');
      preservedJobHistory = await preserveTableRows(liveConn, 'job_history');
      console.log(`  • Preserved ${preservedLeads?.rows?.length || 0} leads (with all migration columns).`);
      console.log(`  • Preserved ${preservedJobHistory?.rows?.length || 0} job history audit entries.`);
    } finally {
      await liveConn.close();
    }
  } else {
    console.log('[Step 1/6] Live database does not exist yet. Initial build will proceed fresh.');
  }

  // Step 3: Initialize Isolated Rebuild Database File
  console.log(`\n[Step 2/6] Initializing isolated rebuild database: ${path.basename(rebuildDbPath)}...`);
  if (fs.existsSync(rebuildDbPath)) fs.unlinkSync(rebuildDbPath);

  const rebuildConn = createConnection(rebuildDbPath);

  try {
    // Step 4: Apply All Versioned Schema Migrations to Rebuild Target
    console.log('\n[Step 3/6] Applying all schema migrations to clean target...');
    await runMigrations(rebuildConn);
    console.log('Schema migrations applied successfully.');

    // Step 5: Restore Preserved Operational State
    console.log('\n[Step 4/6] Restoring preserved operational data...');
    if (preservedLeads) {
      const restoredCount = await restoreTableRows(rebuildConn, preservedLeads);
      console.log(`  • Restored ${restoredCount} leads.`);
    }
    if (preservedJobHistory) {
      const restoredCount = await restoreTableRows(rebuildConn, preservedJobHistory);
      console.log(`  • Restored ${restoredCount} job history records.`);
    }

    // Step 6: Ingest Data via Injected Rebuild Connection
    console.log('\n[Step 5/6] Ingesting dataset into clean database...');
    let ingestResult;
    if (options.dataProvider) {
      ingestResult = await options.dataProvider(rebuildConn);
    } else {
      ingestResult = await fetchUraData(accessKey, rebuildConn);
    }

    // Strict Gate: Reject partial or failed syncs
    if (!ingestResult || ingestResult.status !== 'success') {
      throw new Error(`Data ingestion failed or returned partial results: ${JSON.stringify(ingestResult)}`);
    }

    // Seed Static Amenities & SORA into Rebuild Connection
    await seedAmenities(rebuildConn);
    await seedSoraRates(rebuildConn);

    // Step 7: Pre-Swap Integrity & Completeness Verification Gates
    console.log('\n[Step 6/6] Executing Pre-Swap Integrity & Completeness Verification Gates...');

    // Gate 1: SQLite structural integrity
    const integrityRes = await rebuildConn.get('PRAGMA integrity_check');
    if (integrityRes?.integrity_check !== 'ok') {
      throw new Error(`Pre-swap Integrity Check FAILED: ${integrityRes?.integrity_check}`);
    }
    console.log('  ✓ Gate 1 Passed: PRAGMA integrity_check = ok');

    // Gate 2: Foreign key consistency
    const fkErrors = await rebuildConn.all('PRAGMA foreign_key_check');
    if (fkErrors.length > 0) {
      throw new Error(`Pre-swap Foreign Key Check FAILED: ${JSON.stringify(fkErrors)}`);
    }
    console.log('  ✓ Gate 2 Passed: 0 foreign key violations');

    // Gate 3: Minimum population check (for non-mock builds)
    const projCount = await rebuildConn.get('SELECT COUNT(*) as c FROM projects');
    const salesCount = await rebuildConn.get('SELECT COUNT(*) as c FROM property_transactions');
    const rentCount = await rebuildConn.get('SELECT COUNT(*) as c FROM rental_transactions');

    console.log(`  • Candidate Dataset: ${projCount.c} projects, ${salesCount.c} sales, ${rentCount.c} rentals.`);

    if (!options.dataProvider && (projCount.c < 1000 || salesCount.c < 10000)) {
      throw new Error(`Pre-swap Population Gate FAILED: Count too low (${projCount.c} projects, ${salesCount.c} sales)`);
    }
    console.log('  ✓ Gate 3 Passed: Population counts meet production threshold.');

    // Step 8: Close and Checkpoint Rebuild Database Handles Cleanly
    await rebuildConn.run('PRAGMA wal_checkpoint(TRUNCATE);');
    await rebuildConn.close();

    // Step 9: Atomic Swap with Verified Rollback
    console.log('\nPerforming atomic file swap into target path...');
    const backupPath = `${targetPath}.backup-${timestamp}`;

    // Move existing live database to backup
    if (fs.existsSync(targetPath)) {
      const liveCloseConn = createConnection(targetPath);
      await liveCloseConn.run('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
      await liveCloseConn.close().catch(() => {});

      fs.renameSync(targetPath, backupPath);
      // Remove stale live WAL/SHM files
      if (fs.existsSync(`${targetPath}-wal`)) fs.unlinkSync(`${targetPath}-wal`);
      if (fs.existsSync(`${targetPath}-shm`)) fs.unlinkSync(`${targetPath}-shm`);
    }

    try {
      // Rename rebuild file to live target
      fs.renameSync(rebuildDbPath, targetPath);

      // Verify that newly swapped database opens cleanly
      const verifyConn = createConnection(targetPath);
      const postSwapCheck = await verifyConn.get('PRAGMA integrity_check');
      await verifyConn.close();

      if (postSwapCheck?.integrity_check !== 'ok') {
        throw new Error(`Post-swap verification failed: ${postSwapCheck?.integrity_check}`);
      }

      console.log(`✓ Clean database successfully deployed as ${path.basename(targetPath)}!`);
      if (fs.existsSync(backupPath)) {
        console.log(`(Previous database archived at: ${path.basename(backupPath)})`);
      }
      return { success: true, targetPath };
    } catch (swapErr) {
      console.error('\n🚨 CRITICAL: Post-swap validation failed! Initiating automated rollback...');
      if (fs.existsSync(backupPath)) {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        fs.renameSync(backupPath, targetPath);
        console.log('✓ Automated rollback succeeded: Original database restored.');
      }
      throw swapErr;
    }
  } catch (err) {
    console.error('\n❌ Rebuild aborted:', err.message);
    try {
      await rebuildConn.close();
    } catch {}
    if (fs.existsSync(rebuildDbPath)) fs.unlinkSync(rebuildDbPath);
    if (fs.existsSync(`${rebuildDbPath}-wal`)) fs.unlinkSync(`${rebuildDbPath}-wal`);
    if (fs.existsSync(`${rebuildDbPath}-shm`)) fs.unlinkSync(`${rebuildDbPath}-shm`);
    throw err;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  rebuildCleanDb()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
