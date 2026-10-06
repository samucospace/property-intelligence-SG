import crypto from 'crypto';
import { withTransaction, createConnection } from '../db.js';
import { isEmailSuppressed } from './suppression.js';
import { sendEmail } from './emailAdapter.js';
import { assertProductionCollection } from './productionControls.js';

export function generateIdempotencyKey(recipient, emailType, contextKey = '') {
  const clean = String(recipient || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(`${clean}|${emailType}|${contextKey}`).digest('hex');
}

/**
 * Enqueues an email into the durable outbox ledger.
 */
export async function enqueueEmail({
  recipient,
  subject,
  emailType,
  payload = {},
  idempotencyKey = null,
  maxAttempts = 3,
  leadId = null
}, conn = null) {
  const db = conn || createConnection();
  const shouldClose = !conn;

  try {
    const cleanRecipient = String(recipient || '').trim().toLowerCase();
    
    // Consult suppression ledger before queueing
    if (await isEmailSuppressed(cleanRecipient, db)) {
      return { enqueued: false, suppressed: true, reason: 'Recipient is on suppression ledger.' };
    }

    const id = crypto.randomUUID();
    const finalKey = idempotencyKey || generateIdempotencyKey(cleanRecipient, emailType, JSON.stringify(payload));
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const result = await db.run(`
      INSERT INTO email_outbox (
        id, recipient, subject, email_type, payload_json, status,
        idempotency_key, attempts, max_attempts, lead_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO NOTHING
    `, [id, cleanRecipient, subject, emailType, payloadJson, finalKey, maxAttempts, leadId]);

    if (result && result.changes === 0) {
      const existing = await db.get(`SELECT id, status, provider_message_id FROM email_outbox WHERE idempotency_key = ?`, [finalKey]);
      return { enqueued: false, duplicate: true, existing };
    }

    return { enqueued: true, id, idempotencyKey: finalKey };
  } finally {
    if (shouldClose) await db.close();
  }
}

/**
 * Claims pending emails with mutual exclusion worker lease.
 */
export async function claimPendingEmails({ workerId = `worker-${process.pid}`, batchSize = 10 }, conn) {
  if (!Number.isInteger(batchSize) || batchSize<1 || batchSize>10) throw new Error('Outbox batchSize must be between 1 and 10');
  return await withTransaction(conn, async () => {
    // Provider idempotency expires after 24h. Ambiguous old work needs operator reconciliation.
    await conn.run(`UPDATE email_outbox SET status='permanent_failed', last_error='Acceptance uncertain; reconcile with provider before requeue'
      WHERE status IN ('claimed','failed') AND first_dispatch_at < datetime('now','-23 hours')`);
    await conn.run(`UPDATE email_outbox SET status='failed', next_retry_at=CURRENT_TIMESTAMP,
      lease_token=NULL WHERE status='claimed' AND lease_expires_at <= datetime('now')`);
    const pending = await conn.all(`
      SELECT id, recipient, subject, email_type, payload_json, attempts, max_attempts, idempotency_key, lead_id
      FROM email_outbox
      WHERE status IN ('pending', 'failed')
        AND attempts < max_attempts
        AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now'))
      ORDER BY created_at ASC
      LIMIT ?
    `, [batchSize]);

    if (!pending || pending.length === 0) return [];

    for (const item of pending) {
      const id = item.id;
      item.lease_token = crypto.randomUUID();
      await conn.run(`
        UPDATE email_outbox
        SET status = 'claimed',
            claimed_by = ?,
            claimed_at = datetime('now'),
            lease_token = ?, lease_expires_at = datetime('now','+5 minutes'),
            first_dispatch_at = COALESCE(first_dispatch_at,datetime('now')),
            updated_at = datetime('now')
        WHERE id = ? AND status IN ('pending', 'failed')
      `, [workerId, item.lease_token, id]);
    }

    return pending;
  });
}

/**
 * Marks outbox entry as accepted by provider.
 */
export async function markEmailAccepted(conn, id, providerMessageId, leaseToken) {
  return await conn.run(`
    UPDATE email_outbox
    SET status = 'accepted',
        provider_message_id = ?,
        payload_json = '{}',
        updated_at = datetime('now')
    WHERE id = ? AND status='claimed' AND lease_token=?
  `, [providerMessageId, id, leaseToken]);
}

/**
 * Marks outbox entry as failed, scheduling exponential retry or permanent failure.
 */
export async function markEmailFailed(conn, id, currentAttempts, maxAttempts, errorMessage, isPermanent = false, leaseToken) {
  const nextAttempts = currentAttempts + 1;
  if (isPermanent || nextAttempts >= maxAttempts) {
    return await conn.run(`
      UPDATE email_outbox
      SET status = 'permanent_failed',
          attempts = ?,
          last_error = ?,
          updated_at = datetime('now')
      WHERE id = ? AND status='claimed' AND lease_token=?
    `, [nextAttempts, errorMessage, id, leaseToken]);
  }

  // Bounded exponential backoff: 2 * (2 ^ attempts) minutes (e.g., 2m, 4m, 8m)
  const backoffMinutes = Math.min(60, Math.pow(2, nextAttempts));
  return await conn.run(`
    UPDATE email_outbox
    SET status = 'failed',
        attempts = ?,
        next_retry_at = datetime('now', '+' || ? || ' minutes'),
        last_error = ?,
        updated_at = datetime('now')
    WHERE id = ? AND status='claimed' AND lease_token=?
  `, [nextAttempts, backoffMinutes, errorMessage, id, leaseToken]);
}

/**
 * Processes a batch from the email outbox.
 */
export async function processOutboxBatch({
  workerId = `worker-${process.pid}`,
  batchSize = 10,
  conn = null,
  sendEmailFn = sendEmail
} = {}) {
  assertProductionCollection();
  const db = conn || createConnection();
  const shouldClose = !conn;

  const summary = { claimed: 0, accepted: 0, failed: 0, permanentFailed: 0, mocked: 0 };

  try {
    const batch = await claimPendingEmails({ workerId, batchSize }, db);
    summary.claimed = batch.length;
    if (batch.length === 0) return summary;

    for (const item of batch) {
      let payload;
      try { payload = JSON.parse(item.payload_json); } catch {
        await markEmailFailed(db,item.id,item.attempts,item.max_attempts,'Invalid payload',true,item.lease_token);
        summary.permanentFailed++; continue;
      }
      if (item.lead_id) {
        const lead = await db.get("SELECT *,datetime(confirmation_token_expires_at)>datetime('now') AS token_valid FROM leads WHERE lead_id=?",[item.lead_id]);
        if (!lead || lead.unsubscribed_at || (item.email_type === 'newsletter_digest' && (!lead.confirmed_at || lead.is_quarantined)) ||
            (item.email_type === 'newsletter_confirmation' && (!lead.confirmation_token || payload.confirmationToken !== lead.confirmation_token ||
              !lead.token_valid))) {
          await db.run("UPDATE email_outbox SET status='suppressed',payload_json='{}' WHERE id=? AND lease_token=?",[item.id,item.lease_token]);
          continue;
        }
      }

      // Re-verify suppression immediately prior to send
      if (await isEmailSuppressed(item.recipient, db)) {
        await db.run(`
          UPDATE email_outbox
          SET status = 'suppressed', last_error = 'Suppressed prior to dispatch', updated_at = datetime('now')
          WHERE id = ?
        `, [item.id]);
        summary.permanentFailed++;
        continue;
      }

      try {
        // The production scheduler serializes dispatch jobs across processes.
        // Pace its provider calls; 429s still use bounded retry/backoff.
        if (sendEmailFn===sendEmail && process.env.NODE_ENV==='production') await new Promise(resolve=>setTimeout(resolve,550));
        const stillOwned=await db.get("SELECT id FROM email_outbox WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>datetime('now')",[item.id,item.lease_token]);
        if (!stillOwned) continue;
        const sendResult = await sendEmailFn({
          from: payload.from,
          to: item.recipient,
          subject: item.subject,
          html: payload.html,
          headers: payload.headers || {},
          idempotencyKey: item.idempotency_key
        });

        if (sendResult?.mocked) {
          await markEmailFailed(db,item.id,item.attempts,item.max_attempts,'Mock transport; no live acceptance',true,item.lease_token);
          summary.mocked++; continue;
        }

        if (sendResult?.error || !sendResult?.data?.id) {
          const errMsg = sendResult?.error?.message || 'Provider did not return message ID';
          const statusCode = sendResult?.error?.statusCode;
          const isPermanent = statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429;
          await markEmailFailed(db, item.id, item.attempts, item.max_attempts, errMsg, isPermanent, item.lease_token);
          if (isPermanent || item.attempts+1>=item.max_attempts) summary.permanentFailed++;
          else summary.failed++;
        } else {
          await withTransaction(db, async () => {
            const result = await markEmailAccepted(db, item.id, sendResult.data.id, item.lease_token);
            if (!result.changes) return;
            if (item.lead_id && item.email_type==='newsletter_digest') await db.run('UPDATE leads SET last_newsletter_sent_at=CURRENT_TIMESTAMP WHERE lead_id=?',[item.lead_id]);
            if (item.lead_id && item.email_type==='newsletter_confirmation') await db.run('UPDATE leads SET last_confirmation_sent_at=CURRENT_TIMESTAMP WHERE lead_id=?',[item.lead_id]);
            summary.accepted++;
          });
        }
      } catch (err) {
        await markEmailFailed(db, item.id, item.attempts, item.max_attempts, err.message, false, item.lease_token);
        if (item.attempts+1>=item.max_attempts) summary.permanentFailed++;
        else summary.failed++;
      }
    }

    return summary;
  } finally {
    if (shouldClose) await db.close();
  }
}
