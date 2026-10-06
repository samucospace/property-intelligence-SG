import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptFile } from './backup-db.js';
import { fileHash, databaseMetrics } from '../utils/databaseArtifacts.js';
import { createConnection, withTransaction } from '../db.js';
import { readPrivacyLedger } from '../utils/privacyLedger.js';
import { hashEmail } from '../utils/suppression.js';
import { runMigrations } from '../migrations/index.js';

export async function reapplySuppressionToRestoredDb(restoredDbPath, suppressionEntries = []) {
  const db = createConnection(restoredDbPath);
  try {
    return await withTransaction(db, async () => {
      await db.run(`CREATE TABLE IF NOT EXISTS email_suppression(email_hash TEXT PRIMARY KEY,masked_email TEXT NOT NULL,reason TEXT NOT NULL,suppressed_at TEXT,source_version TEXT)`);
      const latest = new Map();
      for (const entry of suppressionEntries) {
        if (!/^[a-f0-9]{64}$/.test(entry.email_hash) || !['erased','unsubscribed','bounced','complaint','manual'].includes(entry.reason)) throw new Error('Invalid suppression event');
        if (entry.scope==='lead') {
          const lead=await db.get('SELECT * FROM leads WHERE lead_id=? AND created_at=?',[entry.lead_id,entry.created_at]);
          if (lead && hashEmail(lead.email)===entry.email_hash) {
            const outbox=await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='email_outbox'");
            if (outbox) await db.run("UPDATE email_outbox SET status=CASE WHEN status='accepted' THEN status ELSE 'suppressed' END,payload_json='{}',recipient=? WHERE lead_id=?",[`HASH:${entry.email_hash}`,lead.lead_id]);
            await db.run('DELETE FROM leads WHERE lead_id=?',[lead.lead_id]);
          }
          continue;
        }
        const previous=latest.get(entry.email_hash);
        if (!previous || (previous.reason!=='erased' && (entry.reason==='erased' || entry.suppressed_at>=previous.suppressed_at))) latest.set(entry.email_hash,entry);
      }
      for (const entry of latest.values()) await db.run(`INSERT INTO email_suppression VALUES(?,?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET
        reason=CASE WHEN email_suppression.reason='erased' THEN 'erased' ELSE excluded.reason END,
        suppressed_at=excluded.suppressed_at,source_version=excluded.source_version`,
        [entry.email_hash,entry.masked_email || 'erased',entry.reason,entry.suppressed_at || new Date().toISOString(),entry.source_version || 'restore']);
      const suppression = new Map((await db.all('SELECT * FROM email_suppression')).map(entry=>[entry.email_hash,entry]));
      const tables=new Set((await db.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row=>row.name));
      const columns=new Set((await db.all('PRAGMA table_info(leads)')).map(row=>row.name));
      for (const lead of await db.all('SELECT * FROM leads')) {
        const hash=lead.email?.startsWith('HASH:') ? lead.email.slice(5) : hashEmail(lead.email);
        const event=suppression.get(hash);
        if (!event) continue;
        if (tables.has('email_outbox')) await db.run(`UPDATE email_outbox SET status=CASE WHEN status='accepted' THEN status ELSE 'suppressed' END,
          payload_json='{}',recipient=? WHERE recipient=? OR lead_id=?`,[`HASH:${hash}`,lead.email,lead.lead_id]);
        if (event.reason==='erased') {
          await db.run('DELETE FROM leads WHERE lead_id=?',[lead.lead_id]);
        } else {
          const tokenReset=columns.has('confirmation_token') ? ',confirmation_token=NULL' : '';
          await db.run(`UPDATE leads SET unsubscribed_at=CURRENT_TIMESTAMP${tokenReset} WHERE lead_id=?`,[lead.lead_id]);
        }
      }
      return {appliedCount:latest.size};
    });
  } finally { await db.close(); }
}

export async function restoreBaseline({backupPath,keyFile,outputPath,expectedHash,suppressionEntries=[],privacyLedgerFile}) {
  if (!backupPath || !keyFile || !outputPath || !expectedHash) throw new Error('Backup, separate key file, new output path and expected SHA256 are required');
  if (process.env.NODE_ENV==='production' && !privacyLedgerFile) throw new Error('Production restore requires the independently recovered current privacy ledger');
  const entries=privacyLedgerFile ? readPrivacyLedger(privacyLedgerFile) : suppressionEntries;
  outputPath=path.resolve(outputPath);
  if (fs.existsSync(outputPath) || fs.existsSync(outputPath+'-wal') || fs.existsSync(outputPath+'-shm')) throw new Error('Restore output must be a new isolated file');
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  try {
    await decryptFile(backupPath,outputPath,fs.readFileSync(keyFile,'utf8').trim());
    if (fileHash(outputPath)!==expectedHash) throw new Error('Restored snapshot SHA256 mismatch');
    await databaseMetrics(outputPath);
    const migrated=createConnection(outputPath);
    try { await runMigrations(migrated); } finally { await migrated.close(); }
    await reapplySuppressionToRestoredDb(outputPath,entries);
    return {outputPath,sourceSha256:expectedHash,sha256:fileHash(outputPath),...await databaseMetrics(outputPath)};
  } catch(error) {
    for (const suffix of ['','-wal','-shm']) if (fs.existsSync(outputPath+suffix)) fs.unlinkSync(outputPath+suffix);
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
  restoreBaseline({backupPath:arg('backup'),keyFile:arg('key-file'),outputPath:arg('output'),expectedHash:arg('sha256'),privacyLedgerFile:arg('privacy-ledger')})
    .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
