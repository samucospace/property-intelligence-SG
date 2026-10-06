import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';
import { hasOpenConnections } from '../db.js';
import { databaseMetrics, fileHash } from './databaseArtifacts.js';
import { operationalState, operationalStatePreserved } from './rebuildEngine.js';

function persist(file, value) {
  const fd = fs.openSync(file + '.tmp', 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(file + '.tmp', file);
}
async function checkpoint(file) {
  // Recovery deliberately operates below the application connection guard: the
  // guard must continue refusing application startup while a swap journal exists.
  const raw = await new Promise((resolve,reject)=>{const db=new sqlite3.Database(file,sqlite3.OPEN_READWRITE,error=>error?reject(error):resolve(db));});
  try {
    const row = await new Promise((resolve,reject)=>raw.get('PRAGMA wal_checkpoint(TRUNCATE)',(error,result)=>error?reject(error):resolve(result)));
    if (!row || row.busy !== 0 || row.log > 0) throw Error('Promotion checkpoint is busy or incomplete');
  } finally { await new Promise((resolve,reject)=>raw.close(error=>error?reject(error):resolve())); }
  if (fs.existsSync(file + '-wal') || fs.existsSync(file + '-shm')) throw Error('Database users still hold WAL/SHM handles');
}
function paths(target, record) {
  for (const [field, prefix] of [['staged', '.candidate-'], ['backup', '.backup-']]) {
    if (path.dirname(record[field]) !== path.dirname(target) || !record[field].startsWith(target + prefix))
      throw Error('Invalid promotion recovery path');
  }
  if (record.target !== target || record.host !== os.hostname()) throw Error('Promotion recovery target/host mismatch');
}
async function restoreOriginal(target, record) {
  paths(target, record);
  if (fs.existsSync(record.backup)) {
    if (fileHash(record.backup) !== record.originalHash) throw Error('Promotion rollback backup hash mismatch');
    await databaseMetrics(record.backup);
    await checkpoint(record.backup);
    if (fs.existsSync(target)) {
      await checkpoint(target);
      fs.renameSync(target, target + '.rejected-' + crypto.randomUUID() + '.db');
    }
    fs.renameSync(record.backup, target);
  }
  if (!fs.existsSync(target) || fileHash(target) !== record.originalHash) throw Error('Original promotion database unavailable');
  if (record.generation === null) {
    if (fs.existsSync(target + '.generation')) fs.unlinkSync(target + '.generation');
  } else fs.writeFileSync(target + '.generation', record.generation);
}

// Explicit, hash-bound promotion of an already reconciled snapshot. This never
// fetches sources, rebuilds data, enables jobs or relaxes the quarantined rebuild command.
export async function promoteReviewedCandidate({ targetPath, candidatePath, expectedTargetHash, expectedCandidateHash, validateCandidate, onSwapStage, allowEmptyAddedTables = [] }) {
  const target = path.resolve(targetPath), candidate = path.resolve(candidatePath);
  if (target === candidate || typeof validateCandidate !== 'function' || !/^[a-f0-9]{64}$/.test(expectedTargetHash || '') || !/^[a-f0-9]{64}$/.test(expectedCandidateHash || ''))
    throw Error('Reviewed promotion requires separate paths, bound hashes and independent validation');
  if (hasOpenConnections(target) || hasOpenConnections(candidate)) throw Error('Stop all database users before promotion');
  if (fs.existsSync(target + '.swap.json')) throw Error('Interrupted promotion requires explicit recovery');
  if (!fs.existsSync(target) || !fs.existsSync(candidate) || fileHash(target) !== expectedTargetHash || fileHash(candidate) !== expectedCandidateHash)
    throw Error('Promotion source/candidate hash mismatch');
  if (fs.existsSync(candidate + '-wal') || fs.existsSync(candidate + '-shm')) throw Error('Candidate must be closed and checkpointed');
  const lock = target + '.maintenance', journal = target + '.swap.json';
  const record = { target, staged: target + '.candidate-' + crypto.randomUUID() + '.db', backup: target + '.backup-' + crypto.randomUUID(),
    originalHash: expectedTargetHash, candidateHash: expectedCandidateHash, pid: process.pid, host: os.hostname(),
    generation: fs.existsSync(target + '.generation') ? fs.readFileSync(target + '.generation', 'utf8') : null };
  const fd = fs.openSync(lock, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  let moved = false;
  try {
    await checkpoint(target);
    if (fileHash(target) !== expectedTargetHash) throw Error('Source changed during promotion checkpoint');
    const state = await operationalState(target);
    fs.copyFileSync(candidate, record.staged, fs.constants.COPYFILE_EXCL);
    const stagedFd = fs.openSync(record.staged, 'r+');
    try { fs.fsyncSync(stagedFd); } finally { fs.closeSync(stagedFd); }
    await databaseMetrics(record.staged);
    if (fileHash(record.staged) !== expectedCandidateHash || !(await validateCandidate(record.staged))?.match)
      throw Error('Independent candidate validation failed');
    if (!await operationalStatePreserved(state,record.staged,allowEmptyAddedTables)) throw Error('Candidate operational records differ');
    await checkpoint(record.staged); await checkpoint(target);
    if (fileHash(target) !== expectedTargetHash || fileHash(record.staged) !== expectedCandidateHash) throw Error('Database changed before swap');
    persist(journal, record);
    await onSwapStage?.('prepared');
    fs.renameSync(target, record.backup); moved = true;
    await onSwapStage?.('source-moved');
    fs.renameSync(record.staged, target);
    await onSwapStage?.('installed');
    if (!(await validateCandidate(target))?.match || !await operationalStatePreserved(state,target,allowEmptyAddedTables)) throw Error('Post-promotion validation failed');
    await checkpoint(target);
    persist(target + '.generation', { generation: crypto.randomUUID() });
    fs.unlinkSync(journal);
    return { promoted: true, target, backup: record.backup, sha256: fileHash(target), operationalStatePreserved: true };
  } catch (error) {
    if (moved) await restoreOriginal(target, record);
    if (fs.existsSync(journal)) fs.unlinkSync(journal);
    throw error;
  } finally {
    if (!fs.existsSync(journal)) {
      if (fs.existsSync(record.staged)) fs.unlinkSync(record.staged);
      if (fs.existsSync(lock)) fs.unlinkSync(lock);
    }
  }
}

export async function recoverReviewedPromotion(targetPath) {
  const target = path.resolve(targetPath), journal = target + '.swap.json', lock = target + '.maintenance';
  if (!fs.existsSync(journal) && !fs.existsSync(lock)) return { recovered: false };
  const record = JSON.parse(fs.readFileSync(fs.existsSync(journal) ? journal : lock, 'utf8'));
  paths(target, record);
  try { process.kill(record.pid, 0); throw Error('Promotion owner is still running'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  await restoreOriginal(target, record);
  if (fs.existsSync(journal)) fs.unlinkSync(journal);
  if (fs.existsSync(lock)) fs.unlinkSync(lock);
  return { recovered: true, sha256: fileHash(target) };
}
