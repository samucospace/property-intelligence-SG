import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  safeEqual,
  escapeHtml,
  generateUnsubscribeToken,
  legacySha256Token,
  verifyUnsubscribeToken,
  checkAdminKey,
  generateAdminSession,
  verifyAdminSession,
  isPlaceholderSecret
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

    it('rejects legacy SHA-256 tokens after the cut-off date has passed or when unset', () => {
      process.env.UNSUBSCRIBE_SECRET = testSecret;
      process.env.ADMIN_API_KEY = 'legacy_secret_key_for_hash';
      process.env.LEGACY_UNSUB_UNTIL = '2020-01-01'; // In the past

      const legacyToken = legacySha256Token(email, process.env.ADMIN_API_KEY);
      expect(verifyUnsubscribeToken(email, legacyToken)).toBe(false);

      delete process.env.LEGACY_UNSUB_UNTIL;
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

  describe('Newsletter Template Sanitization (SEC-01)', async () => {
    const { buildNewsletterHtml } = await import('../scripts/send-weekly-newsletter.js');

    it('sanitizes malicious script tags and HTML injection in project names and caveat fields', () => {
      const maliciousData = {
        topYields: [
          {
            project_name: '<script>alert("xss")</script>Condo',
            gross_yield: '5.2',
            market_segment: '<img src=x onerror=alert(1)>CCR',
            postal_district: '09"><script>xss()</script>',
            avg_rent: 4500,
            avg_psft: 6.5,
            avg_sale_price: 1500000
          }
        ],
        sora: {
          sora_3m: '2.44"><b',
          reference_month: '2026-09<script>'
        },
        recentCaveats: [
          {
            project_name: '<b>Injected</b> Project',
            postal_district: '10',
            price_sgd: 2000000,
            contract_date: '2026-09-15',
            floor_range: '<iframe src="evil.com">',
            psft_sgd: 2100,
            type_of_sale: 'Resale"><script>alert(2)</script>'
          }
        ],
        recipientEmail: 'victim@example.sg',
        baseUrl: 'https://homeintel.sg'
      };

      const html = buildNewsletterHtml(maliciousData);

      // Verify unescaped tags are NOT present
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).not.toContain('<script>xss()</script>');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<b>Injected</b>');

      // Verify escaped equivalents ARE present
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Condo');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;CCR');
      expect(html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;');
      expect(html).toContain('&lt;b&gt;Injected&lt;/b&gt; Project');
      expect(html).toContain('Resale&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
    });
  });

  describe('HTML Template In-Memory Caching (PERF-01)', async () => {
    const { getIndexHtmlTemplate } = await import('../index.js');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    it('caches HTML template in memory under production mode', () => {
      const tmpFile = path.join(os.tmpdir(), `test-index-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, '<html><head><title>Initial</title></head></html>');

      process.env.NODE_ENV = 'production';
      const initial = getIndexHtmlTemplate(tmpFile);
      expect(initial).toContain('Initial');

      // Change file on disk
      fs.writeFileSync(tmpFile, '<html><head><title>Updated On Disk</title></head></html>');

      // In production, should return cached initial content without reading disk
      const cached = getIndexHtmlTemplate(tmpFile);
      expect(cached).toContain('Initial');
      expect(cached).not.toContain('Updated On Disk');

      fs.unlinkSync(tmpFile);
    });
  });

  describe('Strict CORS Policy Logic (SEC-03)', async () => {
    const express = (await import('express')).default;
    const cors = (await import('cors')).default;

    it('blocks wildcard CORS when ALLOWED_ORIGIN is unset in production', async () => {
      const testApp = express();
      const allowedOrigin = undefined;
      const nodeEnv = 'production';
      if (allowedOrigin) {
        testApp.use(cors({ origin: allowedOrigin }));
      } else if (nodeEnv !== 'production') {
        testApp.use(cors());
      }
      testApp.get('/api/test', (req, res) => res.send('ok'));

      const server = testApp.listen(0);
      const port = server.address().port;
      try {
        const res = await fetch(`http://localhost:${port}/api/test`, {
          headers: { Origin: 'http://evil.com' }
        });
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      } finally {
        server.close();
      }
    });

    it('emits explicit Access-Control-Allow-Origin only for configured ALLOWED_ORIGIN', async () => {
      const testApp = express();
      const allowedOrigin = 'https://homeintel.sg';
      if (allowedOrigin) {
        const allowedOrigins = allowedOrigin.split(',').map(s => s.trim()).filter(Boolean);
        testApp.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-Admin-Key'] }));
      }
      testApp.get('/api/test', (req, res) => res.send('ok'));

      const server = testApp.listen(0);
      const port = server.address().port;
      try {
        const res = await fetch(`http://localhost:${port}/api/test`, {
          headers: { Origin: 'https://homeintel.sg' }
        });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://homeintel.sg');

        const unauthorizedRes = await fetch(`http://localhost:${port}/api/test`, {
          headers: { Origin: 'http://evil.com' }
        });
        expect(unauthorizedRes.headers.get('access-control-allow-origin')).toBeNull();
      } finally {
        server.close();
      }
    });
  });

  describe('Server Live Check for Database Rebuild (RES-01)', async () => {
    const { checkIsServerRunning } = await import('../scripts/rebuild-clean-db.js');
    const http = (await import('http')).default;

    it('detects when server is active and when it is offline', async () => {
      // 1. Random free port where nothing is listening
      const offlineStatus = await checkIsServerRunning(49151);
      expect(offlineStatus).toBe(false);

      // 2. Start a mock server responding on /api/health
      const server = http.createServer((req, res) => {
        if (req.url === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => server.listen(0, resolve));
      const testPort = server.address().port;

      try {
        const activeStatus = await checkIsServerRunning(testPort);
        expect(activeStatus).toBe(true);
      } finally {
        server.close();
      }
    });
  });

  describe('Admin Session Management (IAM-01)', () => {
    const validKey = '0123456789abcdef0123456789abcdef'; // 32 characters
    const differentKey = 'fedcba9876543210fedcba9876543210';

    it('generates a signed session token with valid format and expiration', () => {
      const session = generateAdminSession(validKey, 60000);
      expect(session).toHaveProperty('token');
      expect(session).toHaveProperty('expiresAt');
      expect(session.token).toMatch(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('throws when attempting to generate session with invalid or short key', () => {
      expect(() => generateAdminSession('')).toThrow(/Valid 32\+ character ADMIN_API_KEY required/);
      expect(() => generateAdminSession('short-key')).toThrow(/Valid 32\+ character ADMIN_API_KEY required/);
      expect(() => generateAdminSession(null)).toThrow(/Valid 32\+ character ADMIN_API_KEY required/);
    });

    it('verifies a valid session token within the expiration window', () => {
      const session = generateAdminSession(validKey, 300000);
      expect(verifyAdminSession(session.token, validKey)).toBe(true);
    });

    it('rejects an expired session token', () => {
      // Issue session with negative duration (already in past)
      const expiredSession = generateAdminSession(validKey, -1000);
      expect(verifyAdminSession(expiredSession.token, validKey)).toBe(false);
    });

    it('rejects tampered timestamp or signature', () => {
      const session = generateAdminSession(validKey, 60000);
      const [expiresAt, sig] = session.token.split('.');

      // Alter timestamp
      const tamperedTimestamp = `${parseInt(expiresAt, 10) + 1000}.${sig}`;
      expect(verifyAdminSession(tamperedTimestamp, validKey)).toBe(false);

      // Alter signature
      const tamperedSig = `${expiresAt}.${sig.replace(/^[0-9a-f]/, (c) => (c === 'a' ? 'b' : 'a'))}`;
      expect(verifyAdminSession(tamperedSig, validKey)).toBe(false);
    });

    it('rejects tokens signed with a different key', () => {
      const session = generateAdminSession(validKey, 60000);
      expect(verifyAdminSession(session.token, differentKey)).toBe(false);
    });

    it('safely rejects malformed and non-string tokens without throwing', () => {
      expect(verifyAdminSession('', validKey)).toBe(false);
      expect(verifyAdminSession(null, validKey)).toBe(false);
      expect(verifyAdminSession(undefined, validKey)).toBe(false);
      expect(verifyAdminSession('invalid-token-no-dot', validKey)).toBe(false);
      expect(verifyAdminSession('notanumber.validsig', validKey)).toBe(false);
      expect(verifyAdminSession('123.456.789', validKey)).toBe(false);
      expect(verifyAdminSession(validKey, '')).toBe(false);
    });
  });

  describe('requireAdmin Middleware (IAM-01)', async () => {
    const { requireAdmin } = await import('../index.js');
    beforeEach(async () => { const {initDb}=await import('../db.js'); await initDb(); });
    const validKey = '0123456789abcdef0123456789abcdef';

    function createMockReqRes(headers = {}) {
      const normalizedHeaders = {};
      for (const [k, v] of Object.entries(headers)) {
        normalizedHeaders[k.toLowerCase()] = v;
      }

      const req = {
        get: (header) => normalizedHeaders[header.toLowerCase()]
      };

      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        }
      };

      return { req, res };
    }

    it('fails closed (503) when ADMIN_API_KEY is unset or placeholder', () => {
      process.env.ADMIN_API_KEY = 'secure_admin_key_please_change';
      const { req, res } = createMockReqRes({ 'x-admin-key': validKey });
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toMatch(/ADMIN_API_KEY is not securely configured/);
    });

    it('authorizes request via Authorization: Bearer <sessionToken>', async () => {
      process.env.ADMIN_API_KEY = validKey;
      const session = generateAdminSession(validKey, 60000);
      const { req, res } = createMockReqRes({ authorization: `Bearer ${session.token}` });
      let nextCalled = false;

      await requireAdmin(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('authorizes request via X-Admin-Session header', async () => {
      process.env.ADMIN_API_KEY = validKey;
      const session = generateAdminSession(validKey, 60000);
      const { req, res } = createMockReqRes({ 'x-admin-session': session.token });
      let nextCalled = false;

      await requireAdmin(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('rejects direct X-Admin-Key access to sensitive operations', () => {
      process.env.ADMIN_API_KEY = validKey;
      const { req, res } = createMockReqRes({ 'x-admin-key': validKey });
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
    });

    it('rejects expired Bearer session token with 401', () => {
      process.env.ADMIN_API_KEY = validKey;
      const expiredSession = generateAdminSession(validKey, -5000);
      const { req, res } = createMockReqRes({ authorization: `Bearer ${expiredSession.token}` });
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
    });

    it('rejects missing or invalid credentials with 401', () => {
      process.env.ADMIN_API_KEY = validKey;
      const { req, res } = createMockReqRes({});
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Valid admin session token required/);
    });
  });

  describe('Database Backup AES-256-GCM Encryption (ARCH-01)', async () => {
    const { deriveKey, encryptFile, decryptFile } = await import('../scripts/backup-db.js');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const testSecret = 'super-secret-backup-passphrase-32b!';

    it('derives a 32-byte hash buffer from secret', () => {
      const key = deriveKey(testSecret);
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
      expect(() => deriveKey('')).toThrow(/Encryption secret is required/);
    });

    it('successfully encrypts and decrypts a snapshot with exact bit-for-bit fidelity', async () => {
      const originalPath = path.join(os.tmpdir(), `test-db-orig-${Date.now()}.db`);
      const encPath = path.join(os.tmpdir(), `test-db-orig-${Date.now()}.db.enc`);
      const restoredPath = path.join(os.tmpdir(), `test-db-restored-${Date.now()}.db`);

      const sampleData = Buffer.from('SQLite format 3\0sample database contents for backup test', 'utf8');
      fs.writeFileSync(originalPath, sampleData);

      try {
        await encryptFile(originalPath, encPath, testSecret);
        expect(fs.existsSync(encPath)).toBe(true);

        const encryptedBytes = fs.readFileSync(encPath);
        // Minimum length = 12 (IV) + 16 (AuthTag) + plaintext length
        expect(encryptedBytes.length).toBe(12 + 16 + sampleData.length);

        await decryptFile(encPath, restoredPath, testSecret);
        expect(fs.existsSync(restoredPath)).toBe(true);

        const restoredBytes = fs.readFileSync(restoredPath);
        expect(Buffer.compare(sampleData, restoredBytes)).toBe(0);
      } finally {
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
        if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
        if (fs.existsSync(restoredPath)) fs.unlinkSync(restoredPath);
      }
    });

    it('rejects tampered ciphertext with GCM authentication failure', async () => {
      const originalPath = path.join(os.tmpdir(), `tamper-orig-${Date.now()}.db`);
      const encPath = path.join(os.tmpdir(), `tamper-orig-${Date.now()}.db.enc`);
      const restoredPath = path.join(os.tmpdir(), `tamper-restored-${Date.now()}.db`);

      fs.writeFileSync(originalPath, 'sensitive database payload');

      try {
        await encryptFile(originalPath, encPath, testSecret);

        // Tamper with one byte of ciphertext (after IV 12 + AuthTag 16 = byte 28 onwards)
        const encBytes = fs.readFileSync(encPath);
        encBytes[30] ^= 0xff; // flip bits in ciphertext
        fs.writeFileSync(encPath, encBytes);

        await expect(decryptFile(encPath, restoredPath, testSecret)).rejects.toThrow();
      } finally {
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
        if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
        if (fs.existsSync(restoredPath)) fs.unlinkSync(restoredPath);
      }
    });

    it('rejects tampered auth tag', async () => {
      const originalPath = path.join(os.tmpdir(), `tag-orig-${Date.now()}.db`);
      const encPath = path.join(os.tmpdir(), `tag-orig-${Date.now()}.db.enc`);
      const restoredPath = path.join(os.tmpdir(), `tag-restored-${Date.now()}.db`);

      fs.writeFileSync(originalPath, 'payload with tag check');

      try {
        await encryptFile(originalPath, encPath, testSecret);

        // Tamper with the authTag (bytes 12 to 27)
        const encBytes = fs.readFileSync(encPath);
        encBytes[15] ^= 0x01;
        fs.writeFileSync(encPath, encBytes);

        await expect(decryptFile(encPath, restoredPath, testSecret)).rejects.toThrow();
      } finally {
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
        if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
        if (fs.existsSync(restoredPath)) fs.unlinkSync(restoredPath);
      }
    });

    it('rejects files too small to contain IV and AuthTag (< 28 bytes)', async () => {
      const truncatedPath = path.join(os.tmpdir(), `truncated-${Date.now()}.enc`);
      const outPath = path.join(os.tmpdir(), `out-${Date.now()}.db`);

      fs.writeFileSync(truncatedPath, Buffer.alloc(20)); // Only 20 bytes

      try {
        await expect(decryptFile(truncatedPath, outPath, testSecret)).rejects.toThrow(
          /Encrypted file too small to contain IV and AuthTag/
        );
      } finally {
        if (fs.existsSync(truncatedPath)) fs.unlinkSync(truncatedPath);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      }
    });
  });
});

