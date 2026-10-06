import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { validateLeadSubmission, validateFilters } from '../utils/validation.js';
import { generateAdminSession, verifyAdminSession, revokeAdminToken, isTokenRevoked, logAdminAction } from '../utils/security.js';

describe('Phase 3 Track 3: Input Validation & Attributable Admin Boundary (GL-13)', () => {
  let conn;

  beforeEach(async () => {
    conn = createConnection(':memory:');
    await runMigrations(conn);
    process.env.ADMIN_SESSION_SECRET = 'test-secret-key-32-bytes-minimum-length-needed!';
  });

  afterEach(async () => {
    await conn.close();
  });

  describe('validateLeadSubmission primitive typing (0 unhandled 500s)', () => {
    it('rejects non-string object names with 400 error and descriptive reason', () => {
      const result = validateLeadSubmission({
        name: { first: 'John', last: 'Doe' },
        email: 'john@example.sg',
        leadType: 'newsletter',
        pdpaConsent: true
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Name must be a string');
    });

    it('rejects missing or non-boolean pdpaConsent', () => {
      const result1 = validateLeadSubmission({
        name: 'John',
        email: 'john@example.sg',
        leadType: 'newsletter',
        pdpaConsent: 'true' // String instead of boolean
      });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('Explicit Singapore PDPA consent is required');

      const result2 = validateLeadSubmission({
        name: 'John',
        email: 'john@example.sg',
        leadType: 'newsletter',
        pdpaConsent: false
      });
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('Explicit Singapore PDPA consent is required');
    });

    it('rejects invalid email formats', () => {
      const result = validateLeadSubmission({
        name: 'John',
        email: 'not-an-email',
        leadType: 'newsletter',
        pdpaConsent: true
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid email address format');
    });

    it('accepts valid newsletter lead', () => {
      const result = validateLeadSubmission({
        name: 'Sam Fraser',
        email: 'sam@example.sg',
        leadType: 'newsletter',
        pdpaConsent: true
      });
      expect(result.valid).toBe(true);
      expect(result.isBot).toBe(false);
    });
  });

  describe('validateFilters query validation', () => {
    it('rejects fractional page and limit', () => {
      expect(validateFilters({ limit: 10.5 }).valid).toBe(false);
      expect(validateFilters({ page: 2.2 }).valid).toBe(false);
      expect(validateFilters({ limit: 'abc' }).valid).toBe(false);
      expect(validateFilters({ limit: 50 }).valid).toBe(true);
    });

    it('rejects array or object dates', () => {
      expect(validateFilters({ dateFrom: ['2026-01-01'] }).valid).toBe(false);
      expect(validateFilters({ dateFrom: { year: 2026 } }).valid).toBe(false);
      expect(validateFilters({ dateFrom: '2026-01-01' }).valid).toBe(true);
      expect(validateFilters({ dateFrom: '2026-01' }).valid).toBe(true);
    });

    it('rejects negative limits or out-of-bounds limits', () => {
      expect(validateFilters({ limit: 0 }).valid).toBe(false);
      expect(validateFilters({ limit: 600 }).valid).toBe(false);
    });
  });

  describe('Attributable Admin Sessions & Revocation Ledger', () => {
    it('generates, verifies, and revokes operator session tokens', async () => {
      const adminKey = 'test-secret-key-32-bytes-minimum-length-needed!';
      const session = generateAdminSession(adminKey, 2 * 60 * 60 * 1000); // 2 hours
      expect(session.token).toBeDefined();

      const isValid = verifyAdminSession(session.token, adminKey);
      expect(isValid).toBe(true);

      // Token is not revoked initially
      expect(await isTokenRevoked(session.token, conn)).toBe(false);

      // Revoke the token
      await revokeAdminToken(session.token, 'manual_logout', conn);
      expect(await isTokenRevoked(session.token, conn)).toBe(true);

      const revokedRow = await conn.get('SELECT * FROM admin_revoked_tokens WHERE token_hash = ?', [
        (await import('crypto')).default.createHash('sha256').update(session.token).digest('hex')
      ]);
      expect(revokedRow).toBeDefined();
      expect(revokedRow.reason).toBe('manual_logout');
    });

    it('logs administrative actions to admin_audit_log', async () => {
      await logAdminAction({
        operator: 'sam.fraser',
        action: 'DELETE_LEAD',
        targetId: 'lead_12345',
        ip: '127.0.0.1'
      }, conn);

      const log = await conn.get('SELECT * FROM admin_audit_log WHERE target_id = ?', ['lead_12345']);
      expect(log).toBeDefined();
      expect(log.operator).toBe('sam.fraser');
      expect(log.action).toBe('DELETE_LEAD');
      expect(log.ip_address).toBe('127.0.0.1');
    });
  });
});
