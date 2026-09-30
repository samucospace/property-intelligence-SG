import crypto from 'crypto';

/**
 * Constant-time string comparison that prevents timing attacks.
 * Verifies byte lengths before invoking crypto.timingSafeEqual.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Escapes special HTML characters to prevent Reflected and Stored XSS.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates HMAC-SHA256 unsubscribe token using dedicated UNSUBSCRIBE_SECRET.
 */
export function generateUnsubscribeToken(email, secret = process.env.UNSUBSCRIBE_SECRET) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const unsubSecret = secret || process.env.UNSUBSCRIBE_SECRET;
  if (!unsubSecret) {
    throw new Error('UNSUBSCRIBE_SECRET is required to generate unsubscribe tokens.');
  }
  return crypto.createHmac('sha256', unsubSecret).update(cleanEmail).digest('hex');
}

/**
 * Generates legacy SHA-256 token for backward compatibility.
 */
export function legacySha256Token(email, secret = process.env.ADMIN_API_KEY || 'property_sg_newsletter_secret') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(`${cleanEmail}|${secret}`).digest('hex').slice(0, 16);
}

/**
 * Checks whether legacy tokens are still within the grace period.
 */
export function legacyTokensAccepted() {
  const cutOff = process.env.LEGACY_UNSUB_UNTIL;
  if (!cutOff) return true;
  const cutOffDate = new Date(cutOff);
  return !isNaN(cutOffDate.getTime()) && Date.now() <= cutOffDate.getTime();
}

/**
 * Verifies an unsubscribe token against HMAC-SHA256 or acceptable legacy token.
 */
export function verifyUnsubscribeToken(email, token) {
  if (!token || typeof token !== 'string') return false;
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanToken = token.trim();

  const unsubSecret = process.env.UNSUBSCRIBE_SECRET;
  if (unsubSecret) {
    const expected = crypto.createHmac('sha256', unsubSecret).update(cleanEmail).digest('hex');
    if (safeEqual(cleanToken, expected)) {
      return true;
    }
  }

  if (legacyTokensAccepted()) {
    const legacy = legacySha256Token(cleanEmail);
    if (safeEqual(cleanToken, legacy)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper to identify unconfigured placeholder or example secrets.
 */
export function isPlaceholderSecret(secret) {
  if (!secret || typeof secret !== 'string') return true;
  const s = secret.toLowerCase();
  return (
    s.includes('change_this') ||
    s.includes('placeholder') ||
    s.includes('example') ||
    s === 'secure_admin_key_please_change'
  );
}

/**
 * Validates admin credentials with fail-closed semantics (Step 1.3).
 * Rejects undefined, empty, default placeholder, or short (< 32 char) keys.
 */
export function checkAdminKey(configuredKey, providedKey) {
  if (
    !configuredKey ||
    typeof configuredKey !== 'string' ||
    configuredKey.length < 32 ||
    isPlaceholderSecret(configuredKey)
  ) {
    return { ok: false, status: 503, error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.' };
  }
  if (!providedKey || typeof providedKey !== 'string' || !safeEqual(providedKey, configuredKey)) {
    return { ok: false, status: 401, error: 'Unauthorized: Valid X-Admin-Key header required.' };
  }
  return { ok: true };
}
