import { describe, it, expect } from 'vitest';
import { validateLeadSubmission } from '../utils/validation.js';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';

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
  });
});
