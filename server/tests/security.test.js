import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  safeEqual,
  escapeHtml,
  generateUnsubscribeToken,
  legacySha256Token,
  verifyUnsubscribeToken,
  checkAdminKey
} from '../utils/security.js';

describe('Security Utilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('safeEqual (Timing-safe comparison)', () => {
    it('returns true for matching strings', () => {
      expect(safeEqual('super-secret-key-12345', 'super-secret-key-12345')).toBe(true);
    });

    it('returns false for mismatched strings', () => {
      expect(safeEqual('super-secret-key-12345', 'super-secret-key-99999')).toBe(false);
      expect(safeEqual('short', 'much-longer-string')).toBe(false);
    });

    it('returns false safely without throwing on non-string inputs', () => {
      expect(safeEqual(null, 'secret')).toBe(false);
      expect(safeEqual(undefined, undefined)).toBe(false);
      expect(safeEqual(12345, '12345')).toBe(false);
      expect(safeEqual({}, {})).toBe(false);
    });
  });

  describe('escapeHtml (XSS Mitigation)', () => {
    it('escapes &, <, >, ", and \' characters', () => {
      const dangerous = `<script>alert("XSS & 'injection'")</script>`;
      const safe = escapeHtml(dangerous);
      expect(safe).toBe('&lt;script&gt;alert(&quot;XSS &amp; &#39;injection&#39;&quot;)&lt;/script&gt;');
    });

    it('handles null and undefined safely by returning empty string', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('converts numbers to safe string representation', () => {
      expect(escapeHtml(42)).toBe('42');
    });
  });

  describe('verifyUnsubscribeToken', () => {
    const testSecret = '0123456789abcdef0123456789abcdef';
    const email = 'subscriber@example.com';

    it('validates a freshly generated HMAC-SHA256 token', () => {
      process.env.UNSUBSCRIBE_SECRET = testSecret;
      const token = generateUnsubscribeToken(email, testSecret);
      expect(verifyUnsubscribeToken(email, token)).toBe(true);
    });

    it('rejects missing or empty tokens without throwing', () => {
      process.env.UNSUBSCRIBE_SECRET = testSecret;
      expect(verifyUnsubscribeToken(email, '')).toBe(false);
      expect(verifyUnsubscribeToken(email, null)).toBe(false);
      expect(verifyUnsubscribeToken(email, undefined)).toBe(false);
    });

    it('rejects forged and non-ASCII tokens without throwing 500', () => {
      process.env.UNSUBSCRIBE_SECRET = testSecret;
      expect(verifyUnsubscribeToken(email, 'forged-token-abc')).toBe(false);
      expect(verifyUnsubscribeToken(email, '\x00\xff\xfe\x01\x02')).toBe(false);
      expect(verifyUnsubscribeToken(email, '🚀🎉✨💥')).toBe(false);
    });

    it('accepts legacy SHA-256 tokens before the cut-off date', () => {
      process.env.UNSUBSCRIBE_SECRET = testSecret;
      process.env.ADMIN_API_KEY = 'legacy_secret_key_for_hash';
      process.env.LEGACY_UNSUB_UNTIL = '2099-12-31';

      const legacyToken = legacySha256Token(email, process.env.ADMIN_API_KEY);
      expect(verifyUnsubscribeToken(email, legacyToken)).toBe(true);
    });

    it('rejects legacy SHA-256 tokens after the cut-off date has passed', () => {
      process.env.UNSUBSCRIBE_SECRET = testSecret;
      process.env.ADMIN_API_KEY = 'legacy_secret_key_for_hash';
      process.env.LEGACY_UNSUB_UNTIL = '2020-01-01'; // In the past

      const legacyToken = legacySha256Token(email, process.env.ADMIN_API_KEY);
      expect(verifyUnsubscribeToken(email, legacyToken)).toBe(false);
    });
  });

  describe('checkAdminKey (Fail-closed Admin Auth Guard)', () => {
    const validKey = '0123456789abcdef0123456789abcdef'; // 32 characters

    it('fails closed (503) if ADMIN_API_KEY is not configured or too short', () => {
      expect(checkAdminKey(undefined, validKey)).toEqual({
        ok: false,
        status: 503,
        error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.'
      });
      expect(checkAdminKey('', validKey)).toEqual({
        ok: false,
        status: 503,
        error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.'
      });
      expect(checkAdminKey('short_key_123', validKey)).toEqual({
        ok: false,
        status: 503,
        error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.'
      });
    });

    it('fails closed (503) if ADMIN_API_KEY is an insecure default placeholder', () => {
      expect(checkAdminKey('secure_admin_key_please_change', validKey)).toEqual({
        ok: false,
        status: 503,
        error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.'
      });
      expect(checkAdminKey('change_this_to_a_secure_random_key_in_production', validKey)).toEqual({
        ok: false,
        status: 503,
        error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.'
      });
      expect(checkAdminKey('my_example_secret_key_that_is_32_characters_long', validKey)).toEqual({
        ok: false,
        status: 503,
        error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.'
      });
    });

    it('rejects (401) if provided key is missing or mismatched', () => {
      expect(checkAdminKey(validKey, undefined)).toEqual({
        ok: false,
        status: 401,
        error: 'Unauthorized: Valid X-Admin-Key header required.'
      });
      expect(checkAdminKey(validKey, 'wrong_key_1234567890123456789012')).toEqual({
        ok: false,
        status: 401,
        error: 'Unauthorized: Valid X-Admin-Key header required.'
      });
    });

    it('authorizes successfully (ok: true) when key matches configured key', () => {
      expect(checkAdminKey(validKey, validKey)).toEqual({ ok: true });
    });
  });
});
