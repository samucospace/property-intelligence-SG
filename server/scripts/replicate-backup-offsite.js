import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
async function aws(args) {
  const result=await execute(process.env.AWS_CLI_PATH || 'aws',args,{timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

/**
 * Off-host backup replication script (GL-11, Phase 3 Track 4).
 * Replicates encrypted database snapshots and their SHA-256 manifests
 * to an isolated secondary storage location (e.g. S3/B2 bucket, off-host volume, or offsite staging directory).
 * Fails closed if source backup does not exist or SHA256 integrity check fails.
 */
export async function replicateBackupOffsite({
  backupFile,
  destinationDir = process.env.OFFSITE_BACKUP_DIR,
  metadataFile = null,
  runAws = aws
} = {}) {
  if (!backupFile) {
    throw new Error('replicateBackupOffsite requires backupFile parameter.');
  }

  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup source file does not exist: ${backupFile}`);
  }

  // Backups must be encrypted in production
  if (process.env.NODE_ENV === 'production' && !backupFile.endsWith('.enc')) {
    throw new Error('Refusing to replicate unencrypted backup in production.');
  }

  const bucket=process.env.OFFSITE_BACKUP_BUCKET;
  if (process.env.NODE_ENV==='production' && !bucket) throw new Error('Production offsite backups require OFFSITE_BACKUP_BUCKET in an independent account/provider');
  if (bucket) {
    const prefix=process.env.OFFSITE_BACKUP_PREFIX || 'homeintel/';
    if (!/^[a-zA-Z0-9/_-]+\/$/.test(prefix) || !/^[a-z0-9.-]+$/.test(bucket)) throw new Error('Invalid offsite backup namespace');
    const key=prefix+path.basename(backupFile);
    const sha256=crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex');
    const metadata=metadataFile ? JSON.parse(fs.readFileSync(metadataFile,'utf8')) : {};
    const manifest={...metadata,sha256,byteSize:fs.statSync(backupFile).size,replicatedAt:new Date().toISOString()};
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'offsite-verify-'));
    try {
      await runAws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',path.resolve(backupFile),'--metadata',`sha256=${sha256}`]);
      const verification=path.join(dir,'download.enc');
      await runAws(['s3api','get-object','--bucket',bucket,'--key',key,verification]);
      if (crypto.createHash('sha256').update(fs.readFileSync(verification)).digest('hex')!==sha256) throw new Error('Offsite download checksum mismatch');
      const manifestFile=path.join(dir,'manifest.json');
      fs.writeFileSync(manifestFile,JSON.stringify(manifest));
      await runAws(['s3api','put-object','--bucket',bucket,'--key',key+'.manifest.json','--body',manifestFile]);
      // Only this application's namespace is eligible for retention deletion.
      const retention=Number(process.env.BACKUP_RETENTION_DAYS || 30);
      if (!Number.isInteger(retention) || retention<1) throw new Error('Invalid backup retention');
      const cutoff=Date.now()-retention*86400000;
      let continuation;
      do {
        const page=await runAws(['s3api','list-objects-v2','--bucket',bucket,'--prefix',prefix,...(continuation ? ['--continuation-token',continuation] : [])]);
        for (const object of page.Contents || []) if (object.Key.startsWith(prefix+'property-backup-') && Date.parse(object.LastModified)<cutoff) {
          await runAws(['s3api','delete-object','--bucket',bucket,'--key',object.Key]);
        }
        continuation=page.IsTruncated ? page.NextContinuationToken : null;
      } while (continuation);
      return {success:true,targetFile:`s3://${bucket}/${key}`,sha256,byteSize:manifest.byteSize};
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  }

  const targetDir = destinationDir || path.join(path.dirname(backupFile), 'offsite-replica');
  fs.mkdirSync(targetDir, { recursive: true });

  const fileName = path.basename(backupFile);
  const targetFile = path.join(targetDir, fileName);

  console.log(`[${new Date().toISOString()}] Replicating backup ${fileName} to ${targetDir}...`);

  // Compute source sha256
  const sourceBytes = fs.readFileSync(backupFile);
  const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');

  // Copy encrypted archive
  fs.copyFileSync(backupFile, targetFile);

  // Verify replica sha256
  const replicaBytes = fs.readFileSync(targetFile);
  const replicaSha256 = crypto.createHash('sha256').update(replicaBytes).digest('hex');

  if (sourceSha256 !== replicaSha256) {
    fs.unlinkSync(targetFile);
    throw new Error(`Replication checksum mismatch! Source: ${sourceSha256}, Replica: ${replicaSha256}`);
  }

  // Create or copy manifest
  const manifestPath = `${targetFile}.manifest.json`;
  const manifest = {
    ...(metadataFile ? JSON.parse(fs.readFileSync(metadataFile,'utf8')) : {}),
    replicatedAt: new Date().toISOString(),
    sourceFile: fileName,
    sha256: replicaSha256,
    byteSize: replicaBytes.length,
    isEncrypted: fileName.endsWith('.enc'),
    retentionPolicy: '30-days'
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const cutoff=Date.now()-Number(process.env.BACKUP_RETENTION_DAYS || 30)*86400000;
  for (const name of fs.readdirSync(targetDir)) {
    const file=path.join(targetDir,name);
    if (name.startsWith('property-backup-') && fs.statSync(file).isFile() && fs.statSync(file).mtimeMs<cutoff) fs.unlinkSync(file);
  }

  console.log(`✓ Replicated ${fileName} successfully. Verified SHA-256: ${replicaSha256}`);
  return {
    success: true,
    targetFile,
    manifestPath,
    sha256: replicaSha256,
    byteSize: replicaBytes.length
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  replicateBackupOffsite({
    backupFile: arg('backup'),
    destinationDir: arg('dest')
  }).then(res => {
    console.log(JSON.stringify(res));
    process.exit(0);
  }).catch(err => {
    console.error('Replication failed:', err);
    process.exit(1);
  });
}
