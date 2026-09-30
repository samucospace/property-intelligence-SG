import '../config.js';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, '../property.db');
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

async function runBackup() {
  console.log(`[${new Date().toISOString()}] Starting SQLite online database backup...`);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database file does not exist at ${dbPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Format timestamp YYYY-MM-DD-HHmmss in Singapore timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  const h = parts.find(p => p.type === 'hour').value;
  const min = parts.find(p => p.type === 'minute').value;
  const s = parts.find(p => p.type === 'second').value;

  const backupFilename = `property-backup-${y}${m}${d}-${h}${min}${s}.db`;
  const targetPath = path.join(backupDir, backupFilename);

  const conn = createConnection();
  try {
    // 1. Point-in-time consistent vacuum snapshot (non-blocking)
    console.log(`[${new Date().toISOString()}] Creating VACUUM snapshot into ${targetPath}...`);
    await conn.run(`VACUUM INTO ?`, [targetPath]);

    const stats = fs.statSync(targetPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[${new Date().toISOString()}] Snapshot created successfully (${sizeMb} MB).`);

    // 2. Integrity verification on the generated backup
    console.log(`[${new Date().toISOString()}] Verifying backup integrity...`);
    await new Promise((resolve, reject) => {
      const backupDb = new sqlite3.Database(targetPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) return reject(err);
        backupDb.get('PRAGMA integrity_check', (checkErr, row) => {
          backupDb.close();
          if (checkErr) return reject(checkErr);
          if (row?.integrity_check !== 'ok') {
            return reject(new Error(`Backup integrity check failed: ${JSON.stringify(row)}`));
          }
          resolve();
        });
      });
    });
    console.log(`[${new Date().toISOString()}] Backup integrity verified: OK.`);

    // 3. Purge backups older than RETENTION_DAYS
    const retentionCutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const existingFiles = fs.readdirSync(backupDir).filter(f => f.startsWith('property-backup-') && f.endsWith('.db'));
    let purgedCount = 0;
    for (const f of existingFiles) {
      const fPath = path.join(backupDir, f);
      const fStat = fs.statSync(fPath);
      if (fStat.mtimeMs < retentionCutoff) {
        fs.unlinkSync(fPath);
        purgedCount++;
      }
    }
    if (purgedCount > 0) {
      console.log(`[${new Date().toISOString()}] Purged ${purgedCount} backups older than ${RETENTION_DAYS} days.`);
    }

    console.log(`[${new Date().toISOString()}] Database backup job finished successfully.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Backup error:`, err);
    if (fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch {}
    }
    process.exit(1);
  } finally {
    await conn.close();
  }
}

runBackup().then(() => process.exit(0));
