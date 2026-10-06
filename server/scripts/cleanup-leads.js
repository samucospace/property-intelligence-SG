import '../config.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';
import { releaseFeatures } from '../utils/releasePolicy.js';
import { appendPrivacyEvent } from '../utils/privacyLedger.js';
import { hashEmail } from '../utils/suppression.js';
import {assertProductionCollection} from '../utils/productionControls.js';

/**
 * Monthly Lead Retention Cleanup Script (PRIV-01, Step 4.5.5 & 5.4).
 * Enforces Singapore PDPA Retention Limitation Obligation & GDPR Article 17:
 * 1. Purges unconverted agent advisory leads older than 12 months.
 * 2. Purges unconfirmed newsletter leads older than 30 days.
 * 3. Anonymizes unsubscribed newsletter leads older than 90 days (replaces PII with SHA256 suppression hash).
 */
export async function cleanupLeads(conn = null) {
  if (!releaseFeatures().leadCleanup && !(process.env.NODE_ENV === 'test' && conn)) {
    return { skipped: true, reason: 'Lead cleanup is contained pending approved retention controls.' };
  }
  const shouldClose = !conn;
  assertProductionCollection();
  const db = conn || createConnection();

  const summary = {
    purgedAdvisory: 0,
    purgedUnconfirmed: 0,
    anonymizedUnsubscribed: 0
  };

  try {
    console.log(`[${new Date().toISOString()}] Starting PDPA lead retention purge...`);

    // Retention tombstones are record-scoped: deleting an old advisory enquiry
    // must not suppress a separate active newsletter subscription.
    const expired=await db.all(`SELECT * FROM leads WHERE
      (lead_type='agent_advisory' AND retention_reviewed_at IS NOT NULL AND COALESCE(is_converted,0)=0 AND created_at<date('now','-12 months')) OR
      (lead_type='agent_advisory' AND is_converted=1 AND converted_at<date('now','-5 years')) OR
      (lead_type='newsletter' AND confirmed_at IS NULL AND created_at<date('now','-30 days'))`);
    for (const lead of expired) {
      appendPrivacyEvent({email_hash:hashEmail(lead.email),reason:'erased',masked_email:'retention-erasure',source_version:'retention',scope:'lead',lead_id:lead.lead_id,created_at:lead.created_at});
      await db.run("UPDATE email_outbox SET status=CASE WHEN status='accepted' THEN status ELSE 'suppressed' END,payload_json='{}',recipient=? WHERE lead_id=?",[`HASH:${hashEmail(lead.email)}`,lead.lead_id]);
    }
    // 1. Purge unconverted agent advisory leads older than 12 months (preserve converted leads for up to 5 years)
    const advisoryRes = await db.run(`
      DELETE FROM leads
      WHERE lead_type = 'agent_advisory'
        AND (is_converted IS NULL OR is_converted = 0)
        AND retention_reviewed_at IS NOT NULL
        AND created_at < date('now', '-12 months')
    `);
    summary.purgedAdvisory = advisoryRes?.changes || 0;

    // Purge converted agent advisory leads older than 5 years (statutory limitation)
    const convertedAdvisoryRes = await db.run(`
      DELETE FROM leads
      WHERE lead_type = 'agent_advisory'
        AND is_converted = 1
        AND converted_at < date('now', '-5 years')
    `);
    summary.purgedConvertedAdvisory = convertedAdvisoryRes?.changes || 0;

    // 2. Purge unconfirmed newsletter signups older than 30 days
    const unconfirmedRes = await db.run(`
      DELETE FROM leads
      WHERE lead_type = 'newsletter'
        AND confirmed_at IS NULL
        AND created_at < date('now', '-30 days')
    `);
    summary.purgedUnconfirmed = unconfirmedRes?.changes || 0;

    // 3. Anonymize unsubscribed newsletter leads older than 90 days
    const expiredUnsubs = await db.all(`
      SELECT lead_id, email FROM leads
      WHERE lead_type = 'newsletter'
        AND unsubscribed_at < date('now', '-90 days')
        AND email NOT LIKE 'HASH:%'
    `);

    const { suppressEmail } = await import('../utils/suppression.js');

    for (const sub of expiredUnsubs) {
      const suppressionHash = crypto.createHash('sha256').update(sub.email.toLowerCase().trim()).digest('hex');

      // Ensure suppression ledger records the erasure/unsubscription
      await suppressEmail({ email: sub.email, reason: 'erased', sourceVersion: 'retention-cleanup' }, db);

      await db.run(`
        UPDATE leads
        SET email = ?,
            name = NULL,
            phone = NULL,
            details = NULL,
            confirmation_token = NULL,
            confirmation_token_expires_at = NULL
        WHERE lead_id = ?
      `, [`HASH:${suppressionHash}`, sub.lead_id]);
      summary.anonymizedUnsubscribed++;
    }

    console.log(`[${new Date().toISOString()}] Retention cleanup completed:`, summary);
    return summary;
  } finally {
    if (shouldClose) {
      await db.close();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cleanupLeads()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`[${new Date().toISOString()}] Lead retention cleanup failed:`, err);
      process.exit(1);
    });
}
