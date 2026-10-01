import '../config.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';

/**
 * Monthly Lead Retention Cleanup Script (PRIV-01, Step 4.5.5 & 5.4).
 * Enforces Singapore PDPA Retention Limitation Obligation & GDPR Article 17:
 * 1. Purges unconverted agent advisory leads older than 12 months.
 * 2. Purges unconfirmed newsletter leads older than 30 days.
 * 3. Anonymizes unsubscribed newsletter leads older than 90 days (replaces PII with SHA256 suppression hash).
 */
export async function cleanupLeads(conn = null) {
  const shouldClose = !conn;
  const db = conn || createConnection();

  const summary = {
    purgedAdvisory: 0,
    purgedUnconfirmed: 0,
    anonymizedUnsubscribed: 0
  };

  try {
    console.log(`[${new Date().toISOString()}] Starting PDPA lead retention purge...`);

    // 1. Purge unconverted agent advisory leads older than 12 months
    const advisoryRes = await db.run(`
      DELETE FROM leads
      WHERE lead_type = 'agent_advisory'
        AND created_at < date('now', '-12 months')
    `);
    summary.purgedAdvisory = advisoryRes?.changes || 0;

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

    for (const sub of expiredUnsubs) {
      const suppressionHash = crypto.createHash('sha256').update(sub.email.toLowerCase().trim()).digest('hex');
      await db.run(`
        UPDATE leads
        SET email = ?,
            name = NULL,
            phone = NULL,
            details = NULL,
            confirmation_token = NULL
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
