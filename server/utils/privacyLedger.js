import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDbPath } from '../db.js';

export function ledgerPath() {
  const file = process.env.PRIVACY_LEDGER_PATH;
  if (!file && process.env.NODE_ENV === 'production') throw new Error('PRIVACY_LEDGER_PATH is required in production');
  const resolved = path.resolve(file || `${getDbPath()}.privacy.jsonl`);
  if (resolved === path.resolve(getDbPath())) throw new Error('Privacy ledger must be separate from the database');
  return resolved;
}

export function readPrivacyLedger(file) {
  const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.email_hash) || !['unsubscribed','bounced','complaint','erased','manual'].includes(entry.reason) ||
        !entry.event_id || !Number.isFinite(Date.parse(entry.suppressed_at))) throw new Error('Invalid privacy ledger event');
  }
  return entries;
}

// Append before changing the application DB: a failed DB write must not lose an opt-out.
// The configured production path must be on durable independently replicated storage.
export function appendPrivacyEvent(entry) {
  const file = ledgerPath();
  const replica=process.env.PRIVACY_LEDGER_REPLICA_PATH;
  if (process.env.NODE_ENV==='production' && (!replica || path.resolve(replica)===file)) throw new Error('Independent privacy ledger replica is required');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const event = { ...entry, event_id: crypto.randomUUID(), suppressed_at: new Date().toISOString() };
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  if (replica) {
    // A separately mounted durable destination; failures prevent the DB operation.
    const target=fs.openSync(replica,'a',0o600);
    try { fs.writeSync(target,JSON.stringify(event)+'\n'); fs.fsyncSync(target); }
    finally { fs.closeSync(target); }
  }
  return event;
}
