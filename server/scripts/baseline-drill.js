import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { encryptFile } from './backup-db.js';
import { openReadonly, databaseMetrics, fileHash } from '../utils/databaseArtifacts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inside = (parent, child) => { const rel = path.relative(path.resolve(parent), path.resolve(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

export async function captureBaseline({ sourcePath, backupRoot, keyFile, createKey = false, restoreRoot, workspaceRoot = root }) {
  sourcePath = path.resolve(sourcePath);
  backupRoot = path.resolve(backupRoot);
  keyFile = path.resolve(keyFile);
  restoreRoot = path.resolve(restoreRoot);
  if (inside(backupRoot, keyFile) || inside(restoreRoot, keyFile)) throw new Error('Recovery key must be stored separately from backup and restored database directories');
  if (!fs.existsSync(keyFile)) {
    if (!createKey) throw new Error('Recovery key file does not exist; create it explicitly and retain it separately');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  }
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Recovery key must contain 32 random bytes encoded as 64 hex characters');
  const captureId = `baseline-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const directory = path.join(backupRoot, captureId);
  const restoreDirectory = path.join(restoreRoot, captureId);
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(restoreDirectory, { recursive: true });
  const snapshot = path.join(restoreDirectory, 'snapshot.db');
  const encrypted = path.join(directory, 'database.db.enc');
  const restored = path.join(restoreDirectory, 'restored.db');
  const source = openReadonly(sourcePath);
  try { await source.run('VACUUM INTO ?', [snapshot]); } finally { await source.close(); }
  const snapshotMetrics = await databaseMetrics(snapshot);
  const snapshotHash = fileHash(snapshot);
  await encryptFile(snapshot, encrypted, key);
  // Restore in a new process using only the saved key and encrypted artifact.
  const child = spawnSync(process.execPath, [path.join(root, 'server/scripts/restore-baseline.js'), `--backup=${encrypted}`, `--key-file=${keyFile}`, `--output=${restored}`, `--sha256=${snapshotHash}`], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 60000 });
  if (child.status !== 0) throw new Error(`Fresh-process restore failed: ${child.stderr}`);
  const restoreResult = JSON.parse(child.stdout.trim());
  if (JSON.stringify(restoreResult.counts) !== JSON.stringify(snapshotMetrics.counts)) throw new Error('Restore table counts differ');
  fs.unlinkSync(snapshot);

  // Retain a reviewable working-tree/build baseline, excluding secrets and data.
  const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: workspaceRoot, encoding: 'utf8' });
  if (listing.status !== 0) throw new Error('Cannot capture working-tree baseline');
  const files = [];
  const allowed = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.yml', '.yaml', '.py', '.sql', '.svg', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2']);
  for (const relative of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
    if (relative.startsWith('audit/') || relative.includes('node_modules/') || (relative.includes('.env') && !['.env.example', '.env.staging.example'].includes(path.basename(relative))) || relative.startsWith('.recovery-keys/')) continue;
    if (!allowed.has(path.extname(relative)) && !['Dockerfile', 'Caddyfile', '.gitignore', '.dockerignore', 'LICENSE'].includes(relative)) continue;
    const from = path.join(workspaceRoot, relative);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    const to = path.join(directory, 'working-tree', relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files.push({ path: relative, sha256: fileHash(from) });
  }
  const manifest = {
    captureId, capturedAt: new Date().toISOString(), sourcePath,
    encryptedBackup: encrypted, encryptedSha256: fileHash(encrypted), snapshotSha256: snapshotHash,
    keyFile, keyCustody: 'Separate local file; retain independently. Windows access controls require operator review.',
    restoredPath: restored, restoreProcess: 'Fresh Node process using saved key file', ...snapshotMetrics,
    workingTree: { head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).stdout.trim(), runtime: process.version, files },
    offHost: { status: 'pending-deployment', destination: 'Sam Fraser local machine after hosting is established' }
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  captureBaseline({ sourcePath: arg('source') || path.join(root, 'server/property.db'), backupRoot: arg('backup-root') || path.join(root, 'server/backups'), keyFile: arg('key-file') || path.join(root, '.recovery-keys/phase0.key'), createKey: process.argv.includes('--create-key'), restoreRoot: arg('restore-root') || path.join(root, 'audit/recovery-drill') })
    .then(result => console.log(JSON.stringify({ captureId: result.captureId, encryptedBackup: result.encryptedBackup, keyFile: result.keyFile, snapshotSha256: result.snapshotSha256, counts: result.counts, offHost: result.offHost }, null, 2))).catch(err => { console.error(err.message); process.exitCode = 1; });
}
