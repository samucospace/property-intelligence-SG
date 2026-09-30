/**
 * Singapore Home Intel - Street Name and Project Identity Utilities
 */

/**
 * Normalizes street names to canonical uppercase format with standard abbreviations expanded.
 * Standardizes common Singapore street suffix and prefix abbreviations.
 * @param {string} street
 * @returns {string}
 */
export function normalizeStreetName(street) {
  if (!street || typeof street !== 'string') return 'SINGAPORE';

  let s = street.trim().toUpperCase().replace(/\s+/g, ' ');

  // Standard Singapore street replacements on word boundaries
  const replacements = [
    [/\bRD\b/g, 'ROAD'],
    [/\bST\b/g, 'STREET'],
    [/\bAVE\b/g, 'AVENUE'],
    [/\bLOR\b/g, 'LORONG'],
    [/\bJLN\b/g, 'JALAN'],
    [/\bCL\b/g, 'CLOSE'],
    [/\bCRES\b/g, 'CRESCENT'],
    [/\bDR\b/g, 'DRIVE'],
    [/\bPL\b/g, 'PLACE'],
    [/\bTER\b/g, 'TERRACE'],
    [/\bHTS\b/g, 'HEIGHTS'],
    [/\bPK\b/g, 'PARK'],
    [/\bGDNS\b/g, 'GARDENS'],
    [/\bBLVD\b/g, 'BOULEVARD'],
    [/\bBVD\b/g, 'BOULEVARD'],
    [/\bLNK\b/g, 'LINK'],
    [/\bLN\b/g, 'LANE'],
    [/\bGR\b/g, 'GROVE']
  ];

  for (const [regex, rep] of replacements) {
    s = s.replace(regex, rep);
  }

  return s;
}

/**
 * Checks whether a project name or property type indicates a landed property development.
 * Landed homes reported under generic names (e.g. "LANDED HOUSING DEVELOPMENT")
 * or landed property types are treated as landed aggregates.
 * @param {string} projectName
 * @param {string} [propertyType='']
 * @returns {boolean}
 */
export function isLandedDevelopment(projectName, propertyType = '') {
  if (!projectName) return false;
  const name = projectName.toUpperCase();
  const type = (propertyType || '').toUpperCase();

  if (name.includes('LANDED HOUSING') || name.includes('LANDED DEVELOPMENT')) return true;
  if (name === 'LANDED' || name.startsWith('LANDED ')) return true;
  if (type.includes('SEMI-DETACHED') || type.includes('DETACHED') || type.includes('TERRACE') || type.includes('BUNGALOW')) return true;

  return false;
}
