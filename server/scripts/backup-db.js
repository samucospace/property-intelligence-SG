import '../config.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, '../property.db');
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

/**
 * Derives a 32-byte key for AES-256-GCM encryption.
 */
export function deriveKey(secret) {
  if (!secret) throw new Error('Encryption secret is required.');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypts a file using AES-256-GCM with authenticated tag (ARCH-01).
 * Layout: [12 bytes IV][16 bytes AuthTag][Ciphertext]
 */
export async function encryptFile(sourcePath, destPath, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const plaintext = fs.readFileSync(sourcePath);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedBuffer = Buffer.concat([iv, authTag, ciphertext]);
  fs.writeFileSync(destPath, encryptedBuffer);
  return destPath;
}

/**
 * Decrypts an AES-256-GCM encrypted backup file.
 */
export async function decryptFile(sourcePath, destPath, secret) {
  const key = deriveKey(secret);
  const encryptedBuffer = fs.readFileSync(sourcePath);

  if (encryptedBuffer.length < 28) {
    throw new Error('Encrypted file too small to contain IV and AuthTag.');
  }

  const iv = encryptedBuffer.subarray(0, 12);
  const authTag = encryptedBuffer.subarray(12, 28);
  const ciphertext = encryptedBuffer.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  fs.writeFileSync(destPath, plaintext);
  return destPath;
}

export async function runBackup() {
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

    // 3. Optional AES-256-GCM encryption (ARCH-01)
    const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
    if (encryptionKey) {
      const encryptedPath = `${targetPath}.enc`;
      console.log(`[${new Date().toISOString()}] Encrypting snapshot with AES-256-GCM into ${encryptedPath}...`);
      await encryptFile(targetPath, encryptedPath, encryptionKey);
      console.log(`[${new Date().toISOString()}] Encrypted backup created: OK.`);

      // Unless explicitly told to keep unencrypted copies, remove the plaintext snapshot
      if (process.env.KEEP_UNENCRYPTED_BACKUPS !== 'true') {
        fs.unlinkSync(targetPath);
        console.log(`[${new Date().toISOString()}] Cleaned up plaintext snapshot.`);
      }
    } else {
      console.log(`[${new Date().toISOString()}] Notice: BACKUP_ENCRYPTION_KEY not configured. Backup stored unencrypted.`);
    }

    // 4. Purge backups older than RETENTION_DAYS (both .db and .db.enc)
    const retentionCutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const existingFiles = fs.readdirSync(backupDir).filter(f => f.startsWith('property-backup-') && (f.endsWith('.db') || f.endsWith('.db.enc')));
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBackup().then(() => process.exit(0));
}
