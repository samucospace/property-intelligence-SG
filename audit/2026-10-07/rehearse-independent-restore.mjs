import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {decryptFile} from '/app/server/scripts/backup-db.js';
import {restoreBaseline} from '/app/server/scripts/restore-baseline.js';
const execute=promisify(execFile),start=performance.now();
const artifact=process.argv.find(arg=>arg.startsWith('--artifact='))?.slice(11);
if(!/^property-backup-\d{8}-\d{6}\.db\.enc$/.test(artifact || '')) throw new Error('An explicit encrypted backup artifact is required');
const folder='/tmp/independent-recovery';fs.mkdirSync(folder,{recursive:true});
const bucket=process.env.OFFSITE_BACKUP_BUCKET,prefix=process.env.OFFSITE_BACKUP_PREFIX || 'homeintel/';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function download(name) {
  const target=`${folder}/${name}`;
  await execute('aws',['s3api','get-object','--bucket',bucket,'--key',prefix+name,target],{timeout:180000,maxBuffer:1024*1024});
  return target;
}
const backup=await download(artifact),manifest=JSON.parse(fs.readFileSync(await download(artifact+'.manifest.json'),'utf8'));
if(hash(backup)!==manifest.sha256) throw new Error('Ciphertext checksum mismatch');
const privacy=await download(artifact+'.privacy.enc'),privacyManifest=JSON.parse(fs.readFileSync(await download(artifact+'.privacy.enc.manifest.json'),'utf8'));
if(hash(privacy)!==privacyManifest.sha256) throw new Error('Privacy ciphertext checksum mismatch');
const key=process.env.BACKUP_KEY_FILE,ledger=`${folder}/withdrawals.privacy.jsonl`;
await decryptFile(privacy,ledger,fs.readFileSync(key,'utf8').trim());
if(hash(ledger)!==privacyManifest.snapshotSha256) throw new Error('Privacy plaintext checksum mismatch');
const restored=await restoreBaseline({backupPath:backup,keyFile:key,outputPath:`${folder}/restored.db`,expectedHash:manifest.snapshotSha256,privacyLedgerFile:ledger});
if(restored.counts.projects!==5905 || restored.counts.property_transactions!==132305 || restored.counts.rental_transactions!==451165 || restored.counts.leads!==0) throw new Error('Restored market-only counts do not match');
console.log(JSON.stringify({passed:true,recordedAt:new Date().toISOString(),kind:'Fresh Docker recovery environment on a separate Windows computer, downloaded only from Backblaze',
  artifact,source:'Independent Backblaze account',existingDatabaseMounted:false,backupReadFromDroplet:false,downloadChecksumsVerified:true,privacyChecksumsVerified:true,
  integrity:restored.integrity,foreignKeyViolations:restored.foreignKeyViolations,counts:restored.counts,restoreDurationMs:performance.now()-start,
  scope:'Contact-free analytics pilot; empty privacy history; continuous independent event replication remains unverified'}));
