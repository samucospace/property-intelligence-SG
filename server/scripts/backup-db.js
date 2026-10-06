import '../config.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { createConnection, getDbPath } from '../db.js';
import { fileHash } from '../utils/databaseArtifacts.js';
import { ledgerPath, readPrivacyLedger } from '../utils/privacyLedger.js';
import { replicateBackupOffsite } from './replicate-backup-offsite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


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

export async function runBackup(customConn = null) {
  const dbPath=customConn?.path || getDbPath();
  const backupDir=process.env.BACKUP_DIR || path.join(path.dirname(dbPath),'backups');
  const RETENTION_DAYS=Number(process.env.BACKUP_RETENTION_DAYS || 30);
  if (!Number.isInteger(RETENTION_DAYS) || RETENTION_DAYS<1) throw new Error('Invalid backup retention');
  if (process.env.NODE_ENV==='production' && process.env.KEEP_UNENCRYPTED_BACKUPS==='true') throw new Error('Production plaintext backup retention is forbidden');
  const encryptionKey = process.env.BACKUP_KEY_FILE
    ? fs.readFileSync(process.env.BACKUP_KEY_FILE, 'utf8').trim()
    : process.env.BACKUP_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === 'production' && !encryptionKey) {
    throw new Error('Production backups require BACKUP_KEY_FILE or BACKUP_ENCRYPTION_KEY');
  }
  if (process.env.NODE_ENV==='production' && encryptionKey.length<32) throw new Error('Production backup encryption secret is too short');
  console.log(`[${new Date().toISOString()}] Starting SQLite online database backup...`);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database file does not exist at ${dbPath}`);
    throw new Error(`Database file does not exist at ${dbPath}`);
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

  const conn = customConn || createConnection();
  const shouldClose = !customConn;
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
    const snapshotSha256 = fileHash(targetPath);
    let artifactPath = targetPath;
    if (encryptionKey) {
      const encryptedPath = `${targetPath}.enc`;
      console.log(`[${new Date().toISOString()}] Encrypting snapshot with AES-256-GCM into ${encryptedPath}...`);
      await encryptFile(targetPath, encryptedPath, encryptionKey);
      artifactPath = encryptedPath;
      console.log(`[${new Date().toISOString()}] Encrypted backup created: OK.`);

      // Unless explicitly told to keep unencrypted copies, remove the plaintext snapshot
      if (process.env.KEEP_UNENCRYPTED_BACKUPS !== 'true') {
        fs.unlinkSync(targetPath);
        console.log(`[${new Date().toISOString()}] Cleaned up plaintext snapshot.`);
      }
    } else {
      console.log(`[${new Date().toISOString()}] Notice: BACKUP_ENCRYPTION_KEY not configured. Backup stored unencrypted.`);
    }

    const manifestPath = artifactPath+'.manifest.json';
    fs.writeFileSync(manifestPath,JSON.stringify({snapshotSha256,sha256:fileHash(artifactPath),createdAt:new Date().toISOString(),schema:'sqlite'}),{mode:0o600});
    if (process.env.NODE_ENV==='production' || process.env.OFFSITE_BACKUP_DIR || process.env.OFFSITE_BACKUP_BUCKET) {
      const privacyFile=ledgerPath();
      readPrivacyLedger(privacyFile);
      const ledgerBackup=artifactPath+'.privacy.enc';
      const ledgerSnapshot=artifactPath+'.privacy-snapshot';
      try {
        fs.writeFileSync(ledgerSnapshot,fs.readFileSync(privacyFile),{mode:0o600});
        readPrivacyLedger(ledgerSnapshot);
        await encryptFile(ledgerSnapshot,ledgerBackup,encryptionKey);
        fs.writeFileSync(ledgerBackup+'.manifest.json',JSON.stringify({snapshotSha256:fileHash(ledgerSnapshot),sha256:fileHash(ledgerBackup),createdAt:new Date().toISOString(),schema:'privacy-jsonl'}),{mode:0o600});
      } finally {if(fs.existsSync(ledgerSnapshot)) fs.unlinkSync(ledgerSnapshot);}
      await replicateBackupOffsite({backupFile:artifactPath,metadataFile:manifestPath});
      await replicateBackupOffsite({backupFile:ledgerBackup,metadataFile:ledgerBackup+'.manifest.json'});
    }

    // 4. Purge backups older than RETENTION_DAYS (both .db and .db.enc)
    const retentionCutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const existingFiles = fs.readdirSync(backupDir).filter(f => f.startsWith('property-backup-') && (f.endsWith('.db') || f.endsWith('.enc') || f.endsWith('.manifest.json')));
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
    return { success: true, backupFilename:path.basename(artifactPath),backupPath:artifactPath,manifestPath,snapshotSha256 };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Backup error:`, err);
    if (fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch {}
    }
    throw err;
  } finally {
    if (shouldClose) {
      await conn.close();
    }
  }
}

export const backupDatabase = runBackup;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBackup()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
