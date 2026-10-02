import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decryptFile } from './backup-db.js';
import { fileHash, databaseMetrics } from '../utils/databaseArtifacts.js';

export async function restoreBaseline({ backupPath, keyFile, outputPath, expectedHash }) {
  if (!backupPath || !keyFile || !outputPath || !expectedHash) throw new Error('Backup, separate key file, new output path and expected SHA256 are required');
  outputPath = path.resolve(outputPath);
  if (fs.existsSync(outputPath) || fs.existsSync(`${outputPath}-wal`) || fs.existsSync(`${outputPath}-shm`)) throw new Error('Restore output must be a new isolated file');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await decryptFile(backupPath, outputPath, fs.readFileSync(keyFile, 'utf8').trim());
    if (fileHash(outputPath) !== expectedHash) throw new Error('Restored snapshot SHA256 mismatch');
    return { outputPath, sha256: expectedHash, ...await databaseMetrics(outputPath) };
  } catch (err) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  restoreBaseline({ backupPath: arg('backup'), keyFile: arg('key-file'), outputPath: arg('output'), expectedHash: arg('sha256') })
    .then(result => console.log(JSON.stringify(result))).catch(err => { console.error(err.message); process.exitCode = 1; });
}
