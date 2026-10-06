import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { isEmailSuppressed, suppressEmail, hashEmail } from '../utils/suppression.js';
import { cleanupLeads } from '../scripts/cleanup-leads.js';

describe('Phase 3 Track 2: Consent Lifecycle, Expiring Tokens & Suppression (GL-10)', () => {
  let conn;

  beforeEach(async () => {
    conn = createConnection(':memory:');
    await runMigrations(conn);
  });

  afterEach(async () => {
    await conn.close();
  });

  it('verifies 24-hour token expiry prevents activation of stale confirmation links', async () => {
    // Insert fresh token (expires in 24 hours)
    const tokenFresh = 'token_fresh_123';
    await conn.run(`
      INSERT INTO leads (
        lead_type, email, confirmation_token, confirmation_token_expires_at, pdpa_consent, created_at
      ) VALUES ('newsletter', 'fresh@example.com', ?, datetime('now', '+24 hours'), 1, CURRENT_TIMESTAMP)
    `, [tokenFresh]);

    // Insert expired token (expired 1 hour ago)
    const tokenExpired = 'token_expired_456';
    await conn.run(`
      INSERT INTO leads (
        lead_type, email, confirmation_token, confirmation_token_expires_at, pdpa_consent, created_at
      ) VALUES ('newsletter', 'expired@example.com', ?, datetime('now', '-1 hour'), 1, CURRENT_TIMESTAMP)
    `, [tokenExpired]);

    // Check expiration query logic
    const checkFresh = await conn.get(`
      SELECT lead_id, email FROM leads
      WHERE email = ? AND confirmation_token = ? AND datetime('now') <= confirmation_token_expires_at
    `, ['fresh@example.com', tokenFresh]);
    expect(checkFresh).toBeDefined();
    expect(checkFresh.email).toBe('fresh@example.com');

    const checkExpired = await conn.get(`
      SELECT lead_id, email FROM leads
      WHERE email = ? AND confirmation_token = ? AND datetime('now') <= confirmation_token_expires_at
    `, ['expired@example.com', tokenExpired]);
    expect(checkExpired).toBeUndefined();
  });

  it('single-use confirmation consumes token and sets confirmed_at atomically', async () => {
    const token = 'single_use_token';
    await conn.run(`
      INSERT INTO leads (
        lead_type, email, confirmation_token, confirmation_token_expires_at, pdpa_consent, created_at
      ) VALUES ('newsletter', 'singleuse@example.com', ?, datetime('now', '+24 hours'), 1, CURRENT_TIMESTAMP)
    `, [token]);

    // 1st consumption: updates record and clears token
    const updateRes = await conn.run(`
      UPDATE leads
      SET confirmed_at = CURRENT_TIMESTAMP,
          unsubscribed_at = NULL,
          confirmation_token = NULL,
          confirmation_token_expires_at = NULL,
          consent_version = '2026-v1.0'
      WHERE email = ? AND confirmation_token = ? AND datetime('now') <= confirmation_token_expires_at
    `, ['singleuse@example.com', token]);
    expect(updateRes.changes).toBe(1);

    const lead = await conn.get('SELECT confirmed_at, confirmation_token, consent_version FROM leads WHERE email = ?', ['singleuse@example.com']);
    expect(lead.confirmed_at).not.toBeNull();
    expect(lead.confirmation_token).toBeNull();
    expect(lead.consent_version).toBe('2026-v1.0');

    // 2nd consumption (replay attempt): changes 0 rows
    const replayRes = await conn.run(`
      UPDATE leads
      SET confirmed_at = CURRENT_TIMESTAMP
      WHERE email = ? AND confirmation_token = ?
    `, ['singleuse@example.com', token]);
    expect(replayRes.changes).toBe(0);
  });

  it('suppression ledger records opt-outs and blocks re-enrolment', async () => {
    const email = 'optout@example.sg';
    expect(await isEmailSuppressed(email, conn)).toBe(false);

    await suppressEmail({ email, reason: 'unsubscribed', sourceVersion: '2026-v1.0' }, conn);
    expect(await isEmailSuppressed(email, conn)).toBe(true);

    const row = await conn.get('SELECT email_hash, masked_email, reason FROM email_suppression WHERE email_hash = ?', [hashEmail(email)]);
    expect(row).toBeDefined();
    expect(row.reason).toBe('unsubscribed');
    expect(row.masked_email).toContain('@example.sg');
  });

  it('legacy quarantine prevents unverified contacts from receiving dispatches', async () => {
    // Legacy lead without verified opt-in is quarantined
    await conn.run(`
      INSERT INTO leads (
        lead_type, email, confirmed_at, is_quarantined, quarantined_reason, pdpa_consent, created_at
      ) VALUES ('newsletter', 'legacy@example.com', CURRENT_TIMESTAMP, 1, 'legacy_unverified_import', 1, CURRENT_TIMESTAMP)
    `, []);

    // Verified subscriber
    await conn.run(`
      INSERT INTO leads (
        lead_type, email, confirmed_at, is_quarantined, pdpa_consent, created_at
      ) VALUES ('newsletter', 'verified@example.com', CURRENT_TIMESTAMP, 0, 1, CURRENT_TIMESTAMP)
    `, []);

    const eligible = await conn.all(`
      SELECT email FROM leads
      WHERE lead_type = 'newsletter'
        AND confirmed_at IS NOT NULL
        AND (is_quarantined IS NULL OR is_quarantined = 0)
    `);

    expect(eligible.length).toBe(1);
    expect(eligible[0].email).toBe('verified@example.com');
  });

  it('cleanupLeads differentiates converted leads (5y) vs unconverted (12m) and purges unconfirmed > 30d', async () => {
    process.env.NODE_ENV = 'test';

    // 1. Unconverted advisory lead older than 12 months -> Should be purged
    await conn.run(`
      INSERT INTO leads (lead_type, email, is_converted, created_at,retention_reviewed_at,converted_at)
      VALUES ('agent_advisory', 'unconverted@example.com', 0, date('now', '-13 months'),CURRENT_TIMESTAMP,NULL)
    `);

    // 2. Converted advisory lead older than 12 months (e.g. 2 years) -> Should NOT be purged (statutory retention up to 5y)
    await conn.run(`
      INSERT INTO leads (lead_type, email, is_converted, created_at,retention_reviewed_at,converted_at)
      VALUES ('agent_advisory', 'converted@example.com', 1, date('now', '-24 months'),CURRENT_TIMESTAMP,date('now','-24 months'))
    `);

    // 3. Converted advisory lead older than 5 years -> Should be purged
    await conn.run(`
      INSERT INTO leads (lead_type, email, is_converted, created_at,retention_reviewed_at,converted_at)
      VALUES ('agent_advisory', 'oldconverted@example.com', 1, date('now', '-6 years'),CURRENT_TIMESTAMP,date('now','-6 years'))
    `);

    // 4. Unconfirmed newsletter signup older than 30 days -> Should be purged
    await conn.run(`
      INSERT INTO leads (lead_type, email, confirmed_at, created_at)
      VALUES ('newsletter', 'unconfirmed@example.com', NULL, date('now', '-35 days'))
    `);

    // 5. Unsubscribed newsletter lead older than 90 days -> Should be anonymized & suppression recorded
    await conn.run(`
      INSERT INTO leads (lead_type, email, confirmed_at, unsubscribed_at, created_at)
      VALUES ('newsletter', 'unsubold@example.com', date('now', '-100 days'), date('now', '-95 days'), date('now', '-100 days'))
    `);

    const summary = await cleanupLeads(conn);
    expect(summary.purgedAdvisory).toBe(1);
    expect(summary.purgedConvertedAdvisory).toBe(1);
    expect(summary.purgedUnconfirmed).toBe(1);
    expect(summary.anonymizedUnsubscribed).toBe(1);

    const remainingAdvisory = await conn.all('SELECT email, is_converted FROM leads WHERE lead_type = \'agent_advisory\'');
    expect(remainingAdvisory.length).toBe(1);
    expect(remainingAdvisory[0].email).toBe('converted@example.com');

    // Verify unsubscribed lead was anonymized and recorded in email_suppression
    const anonymizedLead = await conn.get('SELECT email FROM leads WHERE lead_type = \'newsletter\'');
    expect(anonymizedLead.email).toMatch(/^HASH:[a-f0-9]{64}$/);
    expect(await isEmailSuppressed('unsubold@example.com', conn)).toBe(true);
  });
});
