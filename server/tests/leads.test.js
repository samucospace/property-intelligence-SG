import { describe, it, expect } from 'vitest';
import { validateLeadSubmission } from '../utils/validation.js';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { cleanupLeads } from '../scripts/cleanup-leads.js';

describe('Leads & PDPA Integrity', () => {
  describe('validateLeadSubmission', () => {
    it('requires explicit PDPA consent', () => {
      const res = validateLeadSubmission({
        email: 'test@example.com',
        pdpaConsent: false
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Explicit Singapore PDPA consent is required/i);
    });

    it('silently flags honeypot submissions as bots', () => {
      const res = validateLeadSubmission({
        email: 'spammer@bot.com',
        pdpaConsent: true,
        website: 'http://spam-link.ru'
      });
      expect(res.valid).toBe(true);
      expect(res.isBot).toBe(true);
    });

    it('enforces maximum length constraints on name and email', () => {
      const longName = 'A'.repeat(101);
      const nameRes = validateLeadSubmission({
        name: longName,
        email: 'user@example.com',
        pdpaConsent: true,
        leadType: 'newsletter'
      });
      expect(nameRes.valid).toBe(false);
      expect(nameRes.error).toMatch(/Name must not exceed 100 characters/i);

      const longEmail = `${'a'.repeat(250)}@example.com`;
      const emailRes = validateLeadSubmission({
        email: longEmail,
        pdpaConsent: true,
        leadType: 'newsletter'
      });
      expect(emailRes.valid).toBe(false);
      expect(emailRes.error).toMatch(/maximum 254 characters/i);
    });

    it('validates standard email address formats', () => {
      const res = validateLeadSubmission({
        email: 'invalid-email-format',
        pdpaConsent: true,
        leadType: 'newsletter'
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Invalid email address format/i);
    });

    it('validates Singapore contact number for agent advisory leads', () => {
      // Missing phone
      expect(validateLeadSubmission({
        name: 'John Tan',
        email: 'john@example.sg',
        pdpaConsent: true,
        leadType: 'agent_advisory'
      }).valid).toBe(false);

      // Invalid SG phone format (7 digits or wrong starting digit)
      expect(validateLeadSubmission({
        name: 'John Tan',
        email: 'john@example.sg',
        phone: '12345678',
        pdpaConsent: true,
        leadType: 'agent_advisory'
      }).valid).toBe(false);

      // Valid SG phone formats (8 digits starting with 6, 8, 9, or +65 prefix)
      expect(validateLeadSubmission({
        name: 'John Tan',
        email: 'john@example.sg',
        phone: '91234567',
        pdpaConsent: true,
        leadType: 'agent_advisory'
      }).valid).toBe(true);

      expect(validateLeadSubmission({
        name: 'John Tan',
        email: 'john@example.sg',
        phone: '+65 8123 4567',
        pdpaConsent: true,
        leadType: 'agent_advisory'
      }).valid).toBe(true);
    });

    it('does not require phone number for newsletter signups', () => {
      const res = validateLeadSubmission({
        email: 'subscriber@homeintel.sg',
        pdpaConsent: true,
        leadType: 'newsletter'
      });
      expect(res.valid).toBe(true);
      expect(res.isBot).toBe(false);
    });
  });

  describe('Database Lead Management & Duplicate Subscriptions', () => {
    it('applies migrations and handles newsletter duplicate upserts without errors', async () => {
      const conn = createConnection(':memory:');
      try {
        await runMigrations(conn);

        // First subscription
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, consent_version, consent_at, confirmation_token)
          VALUES (?, ?, 'newsletter', 1, '2026-v1.0', CURRENT_TIMESTAMP, ?)
          ON CONFLICT(email) WHERE lead_type = 'newsletter'
          DO UPDATE SET
            pdpa_consent = 1,
            unsubscribed_at = NULL,
            confirmation_token = excluded.confirmation_token,
            consent_at = CURRENT_TIMESTAMP
        `, ['Sam', 'sam@example.com', 'token-123']);

        let rows = await conn.all(`SELECT email, lead_type, unsubscribed_at, confirmation_token FROM leads WHERE email = ?`, ['sam@example.com']);
        expect(rows.length).toBe(1);
        expect(rows[0].confirmation_token).toBe('token-123');

        // Simulate user unsubscribing
        await conn.run(`UPDATE leads SET unsubscribed_at = CURRENT_TIMESTAMP WHERE email = ?`, ['sam@example.com']);

        // Resubscribe with new token
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, consent_version, consent_at, confirmation_token)
          VALUES (?, ?, 'newsletter', 1, '2026-v1.0', CURRENT_TIMESTAMP, ?)
          ON CONFLICT(email) WHERE lead_type = 'newsletter'
          DO UPDATE SET
            pdpa_consent = 1,
            unsubscribed_at = NULL,
            confirmation_token = excluded.confirmation_token,
            consent_at = CURRENT_TIMESTAMP
        `, ['Sam', 'sam@example.com', 'token-456']);

        rows = await conn.all(`SELECT email, lead_type, unsubscribed_at, confirmation_token FROM leads WHERE email = ?`, ['sam@example.com']);
        expect(rows.length).toBe(1); // Still exactly 1 row, no duplicates
        expect(rows[0].confirmation_token).toBe('token-456');
        expect(rows[0].unsubscribed_at).toBeNull();
      } finally {
        await conn.close();
      }
    });

    it('enforces 5-minute cooldown between confirmation email dispatches (ABU-02)', async () => {
      const conn = createConnection(':memory:');
      try {
        await runMigrations(conn);

        // 1. Initial submission
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, consent_version, consent_at, confirmation_token, last_confirmation_sent_at)
          VALUES ('Alex', 'alex@example.com', 'newsletter', 1, 'v1.0', CURRENT_TIMESTAMP, 'tok-1', CURRENT_TIMESTAMP)
        `);

        // Check elapsed time using SQLite strftime
        const lead = await conn.get(
          `SELECT (strftime('%s', 'now') - strftime('%s', last_confirmation_sent_at)) AS elapsed_seconds FROM leads WHERE email = ?`,
          ['alex@example.com']
        );
        expect(lead.elapsed_seconds).toBeDefined();
        expect(lead.elapsed_seconds).toBeLessThan(300);

        // Simulate 6 minutes having passed
        await conn.run(
          `UPDATE leads SET last_confirmation_sent_at = datetime('now', '-6 minutes') WHERE email = ?`,
          ['alex@example.com']
        );

        const updatedLead = await conn.get(
          `SELECT (strftime('%s', 'now') - strftime('%s', last_confirmation_sent_at)) AS elapsed_seconds FROM leads WHERE email = ?`,
          ['alex@example.com']
        );
        expect(updatedLead.elapsed_seconds).toBeGreaterThanOrEqual(300);
      } finally {
        await conn.close();
      }
    });

    it('filters subscribers idempotently using last_newsletter_sent_at (OPS-01)', async () => {
      const conn = createConnection(':memory:');
      try {
        await runMigrations(conn);

        // Sub 1: Never received newsletter
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, confirmed_at, last_newsletter_sent_at)
          VALUES ('Sub1', 'sub1@example.sg', 'newsletter', 1, CURRENT_TIMESTAMP, NULL)
        `);

        // Sub 2: Received newsletter today (should be skipped)
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, confirmed_at, last_newsletter_sent_at)
          VALUES ('Sub2', 'sub2@example.sg', 'newsletter', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        // Sub 3: Received newsletter 7 days ago (should be included)
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, confirmed_at, last_newsletter_sent_at)
          VALUES ('Sub3', 'sub3@example.sg', 'newsletter', 1, CURRENT_TIMESTAMP, datetime('now', '-7 days'))
        `);

        const pendingSubscribers = await conn.all(`
          SELECT email
          FROM leads
          WHERE lead_type = 'newsletter'
            AND unsubscribed_at IS NULL
            AND confirmed_at IS NOT NULL
            AND (last_newsletter_sent_at IS NULL OR last_newsletter_sent_at < date('now', '-6 days'))
          ORDER BY email
        `);

        const emails = pendingSubscribers.map(s => s.email);
        expect(emails).toContain('sub1@example.sg');
        expect(emails).toContain('sub3@example.sg');
        expect(emails).not.toContain('sub2@example.sg');
      } finally {
        await conn.close();
      }
    });

    it('enforces automated retention purging & suppression hashing (PRIV-01)', async () => {
      const conn = createConnection(':memory:');
      try {
        await runMigrations(conn);

        // 1. Unconfirmed signup older than 30 days (should be deleted)
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, confirmed_at, created_at)
          VALUES ('Expired Unconfirmed', 'unconfirmed@example.com', 'newsletter', 1, NULL, datetime('now', '-35 days'))
        `);

        // 2. Unconfirmed signup within 30 days (should be retained)
        await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, confirmed_at, created_at)
          VALUES ('Recent Unconfirmed', 'recent_unconfirmed@example.com', 'newsletter', 1, NULL, datetime('now', '-10 days'))
        `);

        // 3. Unsubscribed lead older than 90 days (should be anonymized to HASH:...)
        await conn.run(`
          INSERT INTO leads (name, email, phone, details, lead_type, pdpa_consent, confirmed_at, unsubscribed_at, created_at)
          VALUES ('Old Optout', 'optout_old@example.com', '91234567', 'Private notes', 'newsletter', 1, datetime('now', '-120 days'), datetime('now', '-95 days'), datetime('now', '-120 days'))
        `);

        // 4. Unsubscribed lead within 90 days (should be kept in plaintext for grace period)
        await conn.run(`
          INSERT INTO leads (name, email, phone, details, lead_type, pdpa_consent, confirmed_at, unsubscribed_at, created_at)
          VALUES ('Recent Optout', 'optout_recent@example.com', '98765432', 'Recent notes', 'newsletter', 1, datetime('now', '-30 days'), datetime('now', '-15 days'), datetime('now', '-30 days'))
        `);

        // 5. Unconverted agent advisory lead older than 12 months (should be deleted)
        await conn.run(`
          INSERT INTO leads (name, email, phone, lead_type, pdpa_consent, created_at,retention_reviewed_at)
          VALUES ('Old Advisory', 'advisory_old@example.com', '90000001', 'agent_advisory', 1, datetime('now', '-13 months'),CURRENT_TIMESTAMP)
        `);

        const summary = await cleanupLeads(conn);
        expect(summary.purgedUnconfirmed).toBe(1);
        expect(summary.purgedAdvisory).toBe(1);
        expect(summary.anonymizedUnsubscribed).toBe(1);

        // Verify database state:
        const remaining = await conn.all(`SELECT lead_id, name, email, phone, details FROM leads ORDER BY lead_id`);
        const remainingEmails = remaining.map(r => r.email);

        // Expired unconfirmed and old advisory are deleted
        expect(remainingEmails).not.toContain('unconfirmed@example.com');
        expect(remainingEmails).not.toContain('advisory_old@example.com');

        // Recent unconfirmed is retained
        expect(remainingEmails).toContain('recent_unconfirmed@example.com');

        // Recent optout is retained in plaintext
        expect(remainingEmails).toContain('optout_recent@example.com');

        // Old optout is anonymized: email starts with HASH: and personal data is NULL
        const anonymizedRow = remaining.find(r => r.email.startsWith('HASH:'));
        expect(anonymizedRow).toBeDefined();
        expect(anonymizedRow.name).toBeNull();
        expect(anonymizedRow.phone).toBeNull();
        expect(anonymizedRow.details).toBeNull();
      } finally {
        await conn.close();
      }
    });

    it('supports permanent Right-to-Erasure lead deletion (PRIV-01 / PDPA Section 25)', async () => {
      const conn = createConnection(':memory:');
      try {
        await runMigrations(conn);

        // Insert a lead to be erased
        const insertRes = await conn.run(`
          INSERT INTO leads (name, email, lead_type, pdpa_consent, created_at)
          VALUES ('To Erase', 'erasure@example.sg', 'agent_advisory', 1, CURRENT_TIMESTAMP)
        `);
        const targetLeadId = insertRes.lastID;

        // Verify lead exists
        let row = await conn.get(`SELECT lead_id, email FROM leads WHERE lead_id = ?`, [targetLeadId]);
        expect(row).toBeDefined();
        expect(row.email).toBe('erasure@example.sg');

        // Execute Right-to-Erasure permanent deletion
        const deleteRes = await conn.run(`DELETE FROM leads WHERE lead_id = ?`, [targetLeadId]);
        expect(deleteRes.changes).toBe(1);

        // Verify record is gone
        row = await conn.get(`SELECT lead_id, email FROM leads WHERE lead_id = ?`, [targetLeadId]);
        expect(row).toBeUndefined();

        // Repeated deletion attempts yield 0 changes (404 condition)
        const reDeleteRes = await conn.run(`DELETE FROM leads WHERE lead_id = ?`, [targetLeadId]);
        expect(reDeleteRes.changes).toBe(0);
      } finally {
        await conn.close();
      }
    });
  });
});
