import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { encryptFile, decryptFile } from '../scripts/backup-db.js';
import { restoreBaseline, reapplySuppressionToRestoredDb } from '../scripts/restore-baseline.js';
import { replicateBackupOffsite } from '../scripts/replicate-backup-offsite.js';

describe('Phase 3 Track 4: Authenticated Backups & Clean Recovery (GL-11)', () => {
  const tempDir = path.resolve('tests/temp-phase3-recovery');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        // Windows file locking retry
        await new Promise(r => setTimeout(r, 200));
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      }
    }
  });

  it('encrypts and decrypts snapshots using AES-256-GCM with authentication tag', async () => {
    const secret = 'super-secure-production-key-for-test-32b';
    const sourcePath = path.join(tempDir, 'plain.db');
    const encPath = path.join(tempDir, 'plain.db.enc');
    const decPath = path.join(tempDir, 'restored.db');

    // Create small SQLite database
    const conn = createConnection(sourcePath);
    await runMigrations(conn);
    await conn.run("INSERT INTO leads (lead_type, email, pdpa_consent) VALUES ('newsletter', 'backup@test.sg', 1)");
    await conn.close();

    // Encrypt
    await encryptFile(sourcePath, encPath, secret);
    expect(fs.existsSync(encPath)).toBe(true);
    expect(fs.statSync(encPath).size).toBeGreaterThan(28);

    // Decrypt
    await decryptFile(encPath, decPath, secret);
    expect(fs.existsSync(decPath)).toBe(true);

    // Verify content matches
    const restoredConn = createConnection(decPath);
    const row = await restoredConn.get('SELECT email FROM leads WHERE email = ?', ['backup@test.sg']);
    expect(row).toBeDefined();
    expect(row.email).toBe('backup@test.sg');
    await restoredConn.close();
  });

  it('replicates encrypted backup off-host and verifies SHA256 manifest', async () => {
    const encFile = path.join(tempDir, 'backup-replica-test.db.enc');
    fs.writeFileSync(encFile, crypto.randomBytes(1024));

    const offsiteDir = path.join(tempDir, 'offsite-storage');
    const result = await replicateBackupOffsite({
      backupFile: encFile,
      destinationDir: offsiteDir
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(result.targetFile)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    expect(manifest.sha256).toBe(result.sha256);
    expect(manifest.isEncrypted).toBe(true);
  });

  it('re-applies external suppression records during restore baseline', async () => {
    const dbPath = path.join(tempDir, 'restore-target.db');
    const conn = createConnection(dbPath);
    await runMigrations(conn);

    const email = 'erased_later@test.sg';
    const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

    // Lead present in old backup
    await conn.run(`
      INSERT INTO leads (lead_type, email, pdpa_consent, created_at)
      VALUES ('newsletter', ?, 1, CURRENT_TIMESTAMP)
    `, [email]);
    await conn.close();

    // Now execute suppression re-synchronization hook with external suppression ledger entry
    const suppressionEntries = [{
      email_hash: emailHash,
      masked_email: 'er***@test.sg',
      reason: 'unsubscribed',
      suppressed_at: new Date().toISOString(),
      source_version: 'post-backup-sync'
    }];

    const syncResult = await reapplySuppressionToRestoredDb(dbPath, suppressionEntries);
    expect(syncResult.appliedCount).toBe(1);

    // Verify the restored lead now has unsubscribed_at set
    const checkConn = createConnection(dbPath);
    const lead = await checkConn.get('SELECT unsubscribed_at FROM leads WHERE email = ?', [email]);
    expect(lead.unsubscribed_at).not.toBeNull();

    const suppressionRow = await checkConn.get('SELECT * FROM email_suppression WHERE email_hash = ?', [emailHash]);
    expect(suppressionRow).toBeDefined();
    expect(suppressionRow.reason).toBe('unsubscribed');
    await checkConn.close();
  });
});
