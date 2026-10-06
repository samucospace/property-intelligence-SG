/**
 * Validation utilities for query engine, analytics, and leads (GL-13).
 * Strictly asserts primitive types to prevent unhandled 500 errors.
 */

export const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;
export const SG_PHONE_REGEX = /^(?:\+65\s?)?[689]\d{7}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) && Number.isFinite(Number(value));
function calendarDate(value) {
  if (!DATE_REGEX.test(value)) return false;
  if (value.length===7) return true;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}

/**
 * Validates analytics and query filter parameters with strict type checking.
 * @param {object} filters
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFilters(filters = {}) {
  if (filters == null || typeof filters !== 'object' || Array.isArray(filters)) {
    return { valid: false, error: 'Filters must be an object.' };
  }
  for (const field of ['street','planningArea','unitType','tenure','propertyType']) {
    if (filters[field]!=null && (typeof filters[field]!=='string' || filters[field].length>150)) return {valid:false,error:`${field} must be a bounded string.`};
  }
  if (filters.district!=null && filters.district!=='' && (!numeric(filters.district) || !Number.isInteger(Number(filters.district)) || Number(filters.district)<1 || Number(filters.district)>28)) return {valid:false,error:'Invalid district.'};
  for (const field of ['unitSizeMin','unitSizeMax']) if (filters[field]!=null && (!numeric(filters[field]) || Number(filters[field])<0 || Number(filters[field])>100000)) return {valid:false,error:`Invalid ${field}.`};
  if (filters.unitSizeMin!=null && filters.unitSizeMax!=null && Number(filters.unitSizeMin)>Number(filters.unitSizeMax)) return {valid:false,error:'Invalid unit size range.'};
  if (filters.centerCoords!=null && (typeof filters.centerCoords!=='object' || Array.isArray(filters.centerCoords) ||
    !numeric(filters.centerCoords.lat) || !numeric(filters.centerCoords.lng) || Math.abs(Number(filters.centerCoords.lat))>90 || Math.abs(Number(filters.centerCoords.lng))>180)) return {valid:false,error:'Invalid center coordinates.'};
  if (filters.lifestyleWeights!=null && (typeof filters.lifestyleWeights!=='object' || Array.isArray(filters.lifestyleWeights) ||
    Object.values(filters.lifestyleWeights).some(value=>typeof value!=='number' || !Number.isFinite(value) || value<0 || value>100))) return {valid:false,error:'Invalid lifestyle weights.'};

  // 1. Date format & bounds validation
  if (filters.dateFrom != null && filters.dateFrom !== '') {
    if (typeof filters.dateFrom !== 'string' || !calendarDate(filters.dateFrom)) {
      return { valid: false, error: 'Invalid dateFrom format. Expected YYYY-MM or YYYY-MM-DD.' };
    }
    const year = parseInt(filters.dateFrom.slice(0, 4), 10);
    if (year < 2000 || year > 2100) {
      return { valid: false, error: 'dateFrom year must be between 2000 and 2100.' };
    }
  }

  if (filters.dateTo != null && filters.dateTo !== '') {
    if (typeof filters.dateTo !== 'string' || !calendarDate(filters.dateTo)) {
      return { valid: false, error: 'Invalid dateTo format. Expected YYYY-MM or YYYY-MM-DD.' };
    }
    const year = parseInt(filters.dateTo.slice(0, 4), 10);
    if (year < 2000 || year > 2100) {
      return { valid: false, error: 'dateTo year must be between 2000 and 2100.' };
    }
  }

  if (typeof filters.dateFrom === 'string' && typeof filters.dateTo === 'string' && filters.dateFrom && filters.dateTo) {
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

  // 2. Pagination integers
  if (filters.page != null && filters.page !== '') {
    const pageNum = Number(filters.page);
    if (!numeric(filters.page) || !Number.isSafeInteger(pageNum) || pageNum < 1) {
      return { valid: false, error: 'page must be a positive integer.' };
    }
  }

  if (filters.limit != null && filters.limit !== '') {
    const limitNum = Number(filters.limit);
    if (!numeric(filters.limit) || !Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
      return { valid: false, error: 'limit must be an integer between 1 and 100.' };
    }
  }

  // 3. Cap projects list at 50 items and assert string items
  if (filters.projects != null) {
    if (!Array.isArray(filters.projects)) {
      return { valid: false, error: 'projects must be an array of strings.' };
    }
    if (filters.projects.length > 50) {
      return { valid: false, error: 'Cannot query more than 50 projects simultaneously.' };
    }
    if (filters.projects.some(p => typeof p !== 'string')) {
      return { valid: false, error: 'projects must contain string values.' };
    }
  }

  // 4. Numeric fields validation
  if (filters.radiusKm != null && filters.radiusKm !== '') {
    const r = typeof filters.radiusKm === 'number' ? filters.radiusKm : parseFloat(filters.radiusKm);
    if (!numeric(filters.radiusKm) || r < 0.1 || r > 10) {
      return { valid: false, error: 'radiusKm must be a number between 0.1 and 10 km.' };
    }
  }

  if (filters.priceMin != null && filters.priceMin !== '') {
    const p = typeof filters.priceMin === 'number' ? filters.priceMin : parseFloat(filters.priceMin);
    if (!numeric(filters.priceMin) || p < 0) {
      return { valid: false, error: 'priceMin must be a non-negative number.' };
    }
  }

  if (filters.priceMax != null && filters.priceMax !== '') {
    const p = typeof filters.priceMax === 'number' ? filters.priceMax : parseFloat(filters.priceMax);
    if (!numeric(filters.priceMax) || p < 0) {
      return { valid: false, error: 'priceMax must be a non-negative number.' };
    }
  }

  if (filters.priceMin != null && filters.priceMax != null && Number(filters.priceMin)>Number(filters.priceMax)) return {valid:false,error:'priceMin cannot exceed priceMax.'};
  return { valid: true };
}

/**
 * Validates lead submission fields with strict primitive assertions.
 * @param {object} body
 * @returns {{ valid: boolean, error?: string, isBot?: boolean }}
 */
export function validateLeadSubmission(body = {}) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const { name, email, phone, leadType, pdpaConsent, website, enquiryType, projectInterest, details } = body;
  for (const field of ['website','phone','enquiryType','projectInterest','details','requestId']) {
    if (body[field]!=null && typeof body[field]!=='string') return {valid:false,error:`${field} must be a string.`};
  }
  if (body.requestId && !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) return {valid:false,error:'Invalid requestId.'};
  if (leadType!=null && !['newsletter','agent_advisory'].includes(leadType)) return {valid:false,error:'Invalid leadType.'};

  // Honeypot
  if (website) {
    return { valid: true, isBot: true };
  }

  // PDPA Consent must be strict boolean true
  if (pdpaConsent !== true) {
    return { valid: false, error: 'Explicit Singapore PDPA consent is required to proceed.' };
  }

  // Name check
  if (name != null) {
    if (typeof name !== 'string') {
      return { valid: false, error: 'Name must be a string.' };
    }
    if (name.length > 100) {
      return { valid: false, error: 'Name must not exceed 100 characters.' };
    }
  }

  // Email check
  if (!email || typeof email !== 'string' || email.length > 254) {
    return { valid: false, error: 'A valid email address is required (maximum 254 characters).' };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return { valid: false, error: 'Invalid email address format.' };
  }

  // Lead Type check
  if (leadType != null && typeof leadType !== 'string') {
    return { valid: false, error: 'leadType must be a string.' };
  }

  const cleanLeadType = leadType === 'newsletter' ? 'newsletter' : 'agent_advisory';

  // Agent Advisory checks
  if (cleanLeadType === 'agent_advisory') {
    if (!phone || typeof phone !== 'string') {
      return { valid: false, error: 'A valid Singapore contact number is required for agent advisory.' };
    }
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!SG_PHONE_REGEX.test(cleanPhone)) {
      return { valid: false, error: 'Please provide a valid 8-digit Singapore phone number starting with 6, 8, or 9.' };
    }

    if (enquiryType != null && (typeof enquiryType !== 'string' || enquiryType.length > 50)) {
      return { valid: false, error: 'Enquiry type must be a string under 50 characters.' };
    }
    if (projectInterest != null && (typeof projectInterest !== 'string' || projectInterest.length > 100)) {
      return { valid: false, error: 'Project interest must be a string under 100 characters.' };
    }
    if (details != null && (typeof details !== 'string' || details.length > 2000)) {
      return { valid: false, error: 'Details must be a string under 2000 characters.' };
    }
  }

  return { valid: true, isBot: false };
}
