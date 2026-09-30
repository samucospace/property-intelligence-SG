/**
 * Validation utilities for query engine, analytics, and leads.
 */

export const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;
export const SG_PHONE_REGEX = /^(?:\+65\s?)?[689]\d{7}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates analytics and query filter parameters.
 * @param {object} filters
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFilters(filters = {}) {
  if (!filters || typeof filters !== 'object') {
    return { valid: true };
  }

  // 1. Date format & bounds validation
  if (filters.dateFrom) {
    if (!DATE_REGEX.test(filters.dateFrom)) {
      return { valid: false, error: 'Invalid dateFrom format. Expected YYYY-MM or YYYY-MM-DD.' };
    }
    const year = parseInt(filters.dateFrom.slice(0, 4), 10);
    if (year < 2000 || year > 2100) {
      return { valid: false, error: 'dateFrom year must be between 2000 and 2100.' };
    }
  }

  if (filters.dateTo) {
    if (!DATE_REGEX.test(filters.dateTo)) {
      return { valid: false, error: 'Invalid dateTo format. Expected YYYY-MM or YYYY-MM-DD.' };
    }
    const year = parseInt(filters.dateTo.slice(0, 4), 10);
    if (year < 2000 || year > 2100) {
      return { valid: false, error: 'dateTo year must be between 2000 and 2100.' };
    }
  }

  if (filters.dateFrom && filters.dateTo) {
    if (filters.dateFrom > filters.dateTo) {
      return { valid: false, error: 'dateFrom cannot be greater than dateTo.' };
    }
    const dFrom = new Date(filters.dateFrom);
    const dTo = new Date(filters.dateTo);
    const diffYears = (dTo - dFrom) / (1000 * 60 * 60 * 24 * 365.25);
    if (diffYears > 10) {
      return { valid: false, error: 'Date range cannot exceed 10 years.' };
    }
  }

  // 2. Cap projects list at 50 items
  if (Array.isArray(filters.projects) && filters.projects.length > 50) {
    return { valid: false, error: 'Cannot query more than 50 projects simultaneously.' };
  }

  // 3. Numeric fields validation
  if (filters.radiusKm != null && filters.radiusKm !== '') {
    const r = parseFloat(filters.radiusKm);
    if (isNaN(r) || r < 0.1 || r > 10) {
      return { valid: false, error: 'radiusKm must be a number between 0.1 and 10 km.' };
    }
  }

  if (filters.priceMin != null && filters.priceMin !== '') {
    const p = parseFloat(filters.priceMin);
    if (isNaN(p) || p < 0) {
      return { valid: false, error: 'priceMin must be a non-negative number.' };
    }
  }

  if (filters.priceMax != null && filters.priceMax !== '') {
    const p = parseFloat(filters.priceMax);
    if (isNaN(p) || p < 0) {
      return { valid: false, error: 'priceMax must be a non-negative number.' };
    }
  }

  return { valid: true };
}

/**
 * Validates lead submission fields.
 * @param {object} body
 * @returns {{ valid: boolean, error?: string, isBot?: boolean }}
 */
export function validateLeadSubmission(body = {}) {
  const { name, email, phone, leadType, pdpaConsent, website } = body;

  // Honeypot
  if (website) {
    return { valid: true, isBot: true };
  }

  // PDPA Consent
  if (pdpaConsent !== true) {
    return { valid: false, error: 'Explicit Singapore PDPA consent is required to proceed.' };
  }

  // Length & format checks
  if (name && typeof name === 'string' && name.length > 100) {
    return { valid: false, error: 'Name must not exceed 100 characters.' };
  }

  if (!email || typeof email !== 'string' || email.length > 254) {
    return { valid: false, error: 'A valid email address is required (maximum 254 characters).' };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return { valid: false, error: 'Invalid email address format.' };
  }

  const cleanLeadType = leadType === 'newsletter' ? 'newsletter' : 'agent_advisory';

  if (cleanLeadType === 'agent_advisory') {
    if (!phone || typeof phone !== 'string') {
      return { valid: false, error: 'A valid Singapore contact number is required for agent advisory.' };
    }
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!SG_PHONE_REGEX.test(cleanPhone)) {
      return { valid: false, error: 'Please provide a valid 8-digit Singapore phone number starting with 6, 8, or 9.' };
    }
  }

  return { valid: true, isBot: false };
}
