import crypto from 'crypto';
import { createConnection } from '../db.js';
import { appendPrivacyEvent } from './privacyLedger.js';
import { ledgerPath, readPrivacyLedger } from './privacyLedger.js';
import fs from 'node:fs';

export function hashEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const clean = email.trim().toLowerCase();
  const [local, domain] = clean.split('@');
  if (!domain) return clean;
  const maskedLocal = local.length > 2 ? `${local.slice(0, 2)}***` : `${local[0] || '*'}***`;
  return `${maskedLocal}@${domain}`;
}

/**
 * Checks whether an email address is listed on the suppression ledger.
 */
export async function isEmailSuppressed(email, conn = null) {
  const hash = hashEmail(email);
  if (!hash) return false;
  const ledger=ledgerPath();
  if (fs.existsSync(ledger)) {
    if (readPrivacyLedger(ledger).some(event=>event.email_hash===hash && event.scope!=='lead')) return true;
  } else if (process.env.NODE_ENV==='production') throw new Error('Privacy ledger unavailable; dispatch prohibited');
  const db = conn || createConnection();
  const shouldClose = !conn;
  try {
    const row = await db.get(
      'SELECT email_hash, reason FROM email_suppression WHERE email_hash = ?',
      [hash]
    );
    return Boolean(row);
  } finally {
    if (shouldClose) await db.close();
  }
}

/**
 * Adds an email hash to the suppression ledger.
 */
export async function suppressEmail({ email, reason = 'unsubscribed', sourceVersion = 'v1.0' }, conn = null) {
  const hash = hashEmail(email);
  if (!hash) return false;
  const masked = maskEmail(email);
  const event = appendPrivacyEvent({ email_hash: hash, masked_email: masked, reason, source_version: sourceVersion });
  const db = conn || createConnection();
  const shouldClose = !conn;
  try {
    await db.run(
      `INSERT INTO email_suppression (email_hash, masked_email, reason, suppressed_at, source_version)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET
       reason=CASE WHEN email_suppression.reason='erased' THEN 'erased' ELSE excluded.reason END,
       suppressed_at=excluded.suppressed_at, source_version=excluded.source_version`,
      [hash, masked, reason, event.suppressed_at, sourceVersion]
    );
    await db.run(`INSERT INTO consent_events(event_id,email_hash,action,consent_version,created_at) VALUES(?,?,?,?,?)`,
      [event.event_id, hash, reason, sourceVersion, event.suppressed_at]);
    await db.run(`UPDATE email_outbox SET status=CASE WHEN status='accepted' THEN status ELSE 'suppressed' END,
      payload_json='{}', recipient=?, updated_at=CURRENT_TIMESTAMP
      WHERE recipient=? OR lead_id IN (SELECT lead_id FROM leads WHERE LOWER(email)=?)`,
      [`HASH:${hash}`, email.trim().toLowerCase(), email.trim().toLowerCase()]);
    return true;
  } finally {
    if (shouldClose) await db.close();
  }
}
