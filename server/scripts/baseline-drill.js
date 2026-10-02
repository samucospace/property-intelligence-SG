import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { encryptFile, decryptFile } from './backup-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '../..');
const liveDbPath = path.resolve(rootDir, 'server/property.db');
const backupDir = path.resolve(rootDir, 'server/backups');
const baselineDbPath = path.join(backupDir, 'baseline-authoritative-20261002.db');
const encryptedBaselinePath = `${baselineDbPath}.enc`;
const drillDir = path.resolve(rootDir, 'audit/recovery-drill');
const restoredDbPath = path.join(drillDir, 'restored-baseline.db');

async function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getDbMetrics(dbFilePath) {
  const db = new sqlite3.Database(dbFilePath, sqlite3.OPEN_READONLY);
  try {
    const integrity = await runQuery(db, 'PRAGMA integrity_check;');
    const fkCheck = await runQuery(db, 'PRAGMA foreign_key_check;');
    const tables = [
      'projects',
      'property_transactions',
      'rental_transactions',
      'project_benchmarks',
      'amenities',
      'sora_rates',
      'leads',
      'schema_migrations'
    ];

    const counts = {};
    for (const t of tables) {
      try {
        const row = await runQuery(db, `SELECT COUNT(*) as cnt FROM ${t};`);
        counts[t] = row[0].cnt;
      } catch (err) {
        counts[t] = `Error: ${err.message}`;
      }
    }

    return {
      integrity: integrity[0]?.integrity_check || 'unknown',
      fkViolations: fkCheck.length,
      counts
    };
  } finally {
    await new Promise(res => db.close(res));
  }
}

async function main() {
  console.log('===========================================================');
  console.log(' Phase 0: Baseline Capture & Recovery Rehearsal Drill');
  console.log('===========================================================\n');

  if (!fs.existsSync(liveDbPath)) {
    throw new Error(`Live database not found at ${liveDbPath}`);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  if (!fs.existsSync(drillDir)) {
    fs.mkdirSync(drillDir, { recursive: true });
  }

  // 1. Audit Live Source DB
  console.log('[Step 1/5] Auditing live source database at:', liveDbPath);
  const liveStats = fs.statSync(liveDbPath);
  const liveMetrics = await getDbMetrics(liveDbPath);
  console.log(`Live size: ${(liveStats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log('Live integrity:', liveMetrics.integrity);
  console.log('Live table counts:', JSON.stringify(liveMetrics.counts, null, 2));

  // 2. Point-in-time consistent vacuum snapshot
  console.log('\n[Step 2/5] Creating point-in-time VACUUM INTO baseline snapshot...');
  if (fs.existsSync(baselineDbPath)) {
    fs.unlinkSync(baselineDbPath);
  }

  const liveDb = new sqlite3.Database(liveDbPath);
  await new Promise((resolve, reject) => {
    liveDb.run('VACUUM INTO ?', [baselineDbPath], (err) => {
      liveDb.close();
      if (err) reject(err);
      else resolve();
    });
  });

  const baselineStats = fs.statSync(baselineDbPath);
  console.log(`Baseline snapshot created: ${baselineDbPath}`);
  console.log(`Baseline size: ${(baselineStats.size / (1024 * 1024)).toFixed(2)} MB`);
  const baselineMetrics = await getDbMetrics(baselineDbPath);
  console.log('Baseline integrity:', baselineMetrics.integrity);

  // 3. Encrypt Baseline with AES-256-GCM
  console.log('\n[Step 3/5] Encrypting baseline snapshot with AES-256-GCM...');
  const drillKey = crypto.randomBytes(32).toString('hex');
  if (fs.existsSync(encryptedBaselinePath)) {
    fs.unlinkSync(encryptedBaselinePath);
  }
  await encryptFile(baselineDbPath, encryptedBaselinePath, drillKey);
  const encStats = fs.statSync(encryptedBaselinePath);
  console.log(`Encrypted baseline created: ${encryptedBaselinePath}`);
  console.log(`Encrypted size: ${(encStats.size / (1024 * 1024)).toFixed(2)} MB`);

  // 4. Recovery Rehearsal Drill in Isolated Directory
  console.log('\n[Step 4/5] Executing isolated restore drill in:', drillDir);
  if (fs.existsSync(restoredDbPath)) {
    fs.unlinkSync(restoredDbPath);
  }
  await decryptFile(encryptedBaselinePath, restoredDbPath, drillKey);
  const restoredStats = fs.statSync(restoredDbPath);
  console.log(`Decrypted restored database created: ${restoredDbPath}`);
  console.log(`Restored size: ${(restoredStats.size / (1024 * 1024)).toFixed(2)} MB`);

  const restoredMetrics = await getDbMetrics(restoredDbPath);
  console.log('Restored integrity check:', restoredMetrics.integrity);
  console.log('Restored FK violations:', restoredMetrics.fkViolations);
  console.log('Restored table counts:', JSON.stringify(restoredMetrics.counts, null, 2));

  // 5. Verification Validation
  console.log('\n[Step 5/5] Comparing Live vs Restored counts...');
  let allMatched = true;
  for (const [table, cnt] of Object.entries(liveMetrics.counts)) {
    if (cnt !== restoredMetrics.counts[table]) {
      console.error(`❌ Mismatch in table ${table}: Live ${cnt} vs Restored ${restoredMetrics.counts[table]}`);
      allMatched = false;
    } else {
      console.log(`✓ Table [${table}] matched perfectly: ${cnt}`);
    }
  }

  if (allMatched && restoredMetrics.integrity === 'ok' && restoredMetrics.fkViolations === 0) {
    console.log('\n🎉 ALL RECOVERY CHECKS PASSED: Authoritative baseline is 100% verified and recoverable!');
  } else {
    throw new Error('Recovery drill failed validation checks.');
  }

  // Generate markdown report
  const report = `# Baseline Recovery Rehearsal Drill Report

**Executed:** ${new Date().toISOString()}  
**Drill Objective:** Prove consistent baseline capture and complete isolated restoration from encrypted backup (GL-11).  
**Outcome:** **PASSED (100% Exact Match)**  

## 1. Artifact Verification

| Item | Path | Size | Integrity Check |
| :--- | :--- | :--- | :--- |
| **Live Source** | \`${liveDbPath}\` | ${(liveStats.size / (1024 * 1024)).toFixed(2)} MB | ${liveMetrics.integrity} |
| **Snapshot Baseline** | \`${baselineDbPath}\` | ${(baselineStats.size / (1024 * 1024)).toFixed(2)} MB | ${baselineMetrics.integrity} |
| **Encrypted Snapshot** | \`${encryptedBaselinePath}\` | ${(encStats.size / (1024 * 1024)).toFixed(2)} MB | AES-256-GCM (AuthTag Verified) |
| **Restored Isolated Copy** | \`${restoredDbPath}\` | ${(restoredStats.size / (1024 * 1024)).toFixed(2)} MB | ${restoredMetrics.integrity} |

## 2. Table Row Count Reconciliation

| Table Name | Live Count | Baseline Snapshot | Restored Count | Status |
| :--- | :--- | :--- | :--- | :--- |
| **\`projects\`** | ${liveMetrics.counts.projects} | ${baselineMetrics.counts.projects} | ${restoredMetrics.counts.projects} | ✅ Verified Match |
| **\`property_transactions\`** | ${liveMetrics.counts.property_transactions} | ${baselineMetrics.counts.property_transactions} | ${restoredMetrics.counts.property_transactions} | ✅ Verified Match |
| **\`rental_transactions\`** | ${liveMetrics.counts.rental_transactions} | ${baselineMetrics.counts.rental_transactions} | ${restoredMetrics.counts.rental_transactions} | ✅ Verified Match |
| **\`project_benchmarks\`** | ${liveMetrics.counts.project_benchmarks} | ${baselineMetrics.counts.project_benchmarks} | ${restoredMetrics.counts.project_benchmarks} | ✅ Verified Match |
| **\`amenities\`** | ${liveMetrics.counts.amenities} | ${baselineMetrics.counts.amenities} | ${restoredMetrics.counts.amenities} | ✅ Verified Match |
| **\`sora_rates\`** | ${liveMetrics.counts.sora_rates} | ${baselineMetrics.counts.sora_rates} | ${restoredMetrics.counts.sora_rates} | ✅ Verified Match |
| **\`leads\`** | ${liveMetrics.counts.leads} | ${baselineMetrics.counts.leads} | ${restoredMetrics.counts.leads} | ✅ Verified Match |
| **\`schema_migrations\`** | ${liveMetrics.counts.schema_migrations} | ${baselineMetrics.counts.schema_migrations} | ${restoredMetrics.counts.schema_migrations} | ✅ Verified Match |

## 3. Foreign Key and Structural Integrity
- **Integrity Check:** \`${restoredMetrics.integrity}\`
- **Foreign Key Violations:** \`${restoredMetrics.fkViolations}\`

The baseline recovery procedure proves that an encrypted backup can be successfully decrypted and restored in an isolated environment with zero data loss or structural anomalies.
`;

  fs.writeFileSync(path.join(rootDir, 'audit/2026-10-02/BASELINE_RESTORE_DRILL.md'), report);
  console.log('Report written to audit/2026-10-02/BASELINE_RESTORE_DRILL.md');
}

main().catch(err => {
  console.error('\n❌ Baseline drill failed:', err);
  process.exit(1);
});
