/**
 * Canonical Tenure Classification Utility for Singapore Property Intelligence
 */

/**
 * Classifies a raw tenure string into 'freehold', 'leasehold', or null.
 * In Singapore real estate conventions, 999-year and 9999-year titles are treated as freehold equivalent.
 * @param {string|null|undefined} tenureStr
 * @returns {'freehold'|'leasehold'|null}
 */
export function classifyTenure(tenureStr) {
  if (!tenureStr || typeof tenureStr !== 'string') return null;

  const upper = tenureStr.trim().toUpperCase();
  if (
    upper.includes('FREEHOLD') ||
    upper.startsWith('999') ||
    upper.startsWith('956') ||
    upper.startsWith('947') ||
    upper.startsWith('946') ||
    upper.startsWith('929') ||
    upper.startsWith('993')
  ) {
    return 'freehold';
  }

  if (
    upper.includes('LEASE') ||
    upper.includes('YRS') ||
    upper.includes('YEARS') ||
    /\b\d{2,3}\s*Y/i.test(upper)
  ) {
    return 'leasehold';
  }

  return null;
}
