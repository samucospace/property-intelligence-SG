/**
 * Canonical Bedroom Label Normalization Utility
 */

/**
 * Normalizes a raw bedroom count or string into standard Singapore format:
 * '1-Bedder', '2-Bedder', ..., 'Unspecified'.
 * Maps legacy 'NA-Bedder', '00-Bedder', and empty values to 'Unspecified'.
 * Normalizes '03-Bedder' -> '3-Bedder'.
 * @param {string|number|null|undefined} raw
 * @returns {string}
 */
export function normalizeBedroom(raw) {
  if (raw === null || raw === undefined) return 'Unspecified';

  const s = String(raw).trim();
  if (!s || s === 'NA-Bedder' || s === '00-Bedder' || s === '0' || s.toUpperCase() === 'NA' || s.toUpperCase() === 'UNSPECIFIED') {
    return 'Unspecified';
  }

  // Check if string contains digits
  const match = s.match(/\d+/);
  if (!match) {
    return 'Unspecified';
  }

  const num = parseInt(match[0], 10);
  if (num <= 0 || isNaN(num)) {
    return 'Unspecified';
  }

  return `${num}-Bedder`;
}
