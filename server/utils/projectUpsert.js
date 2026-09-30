/**
 * Canonical Project Resolver & Upsert Utilities (Step 2.1, 2.3 & 5.1).
 * Eliminates duplicate project resolution across sales feeds, rental feeds, and bulk imports.
 */

import { normalizeStreetName } from './streetUtils.js';
import { svy21ToWgs84, getDistrictCenter } from './geo.js';

const POSTAL_SECTOR_TO_DISTRICT = {
  '01': '01', '02': '01', '03': '01', '04': '01', '05': '01', '06': '01',
  '07': '02', '08': '02',
  '14': '03', '15': '03', '16': '03',
  '09': '04', '10': '04',
  '11': '05', '12': '05', '13': '05',
  '17': '06',
  '18': '07', '19': '07',
  '20': '08', '21': '08',
  '22': '09', '23': '09',
  '24': '10', '25': '10', '26': '10', '27': '10',
  '28': '11', '29': '11', '30': '11',
  '31': '12', '32': '12', '33': '12',
  '34': '13', '35': '13', '36': '13', '37': '13',
  '38': '14', '39': '14', '40': '14', '41': '14',
  '42': '15', '43': '15', '44': '15', '45': '15',
  '46': '16', '47': '16', '48': '16',
  '49': '17', '50': '17', '81': '17',
  '51': '18', '52': '18',
  '53': '19', '54': '19', '55': '19', '82': '19',
  '56': '20', '57': '20',
  '58': '21', '59': '21',
  '60': '22', '61': '22', '62': '22', '63': '22', '64': '22',
  '65': '23', '66': '23', '67': '23', '68': '23',
  '69': '24', '70': '24', '71': '24',
  '72': '25', '73': '25',
  '77': '26', '78': '26',
  '75': '27', '76': '27',
  '79': '28', '80': '28'
};

/**
 * Validates and normalizes postal district to 2-digit format ('01' - '28').
 * Returns null for invalid or segment codes (e.g. '00', 'CCR', 'RCR', 'OCR').
 * @param {string|number} val
 * @returns {string|null}
 */
export function cleanPostalDistrict(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  const stripped = s.startsWith('D') ? s.slice(1).trim() : s;
  const num = parseInt(stripped, 10);
  if (!isNaN(num) && String(num) === stripped.replace(/^0+/, '') && num >= 1 && num <= 28) {
    return String(num).padStart(2, '0');
  }
  return null;
}

/**
 * Resolves canonical postal district from postal code, transaction-level, or project-level records.
 * Uses Singapore postal sector mapping when available, or the most frequent valid district ('01'-'28').
 * @param {object} rawProj
 * @returns {string|null}
 */
export function resolveProjectDistrict(rawProj) {
  if (!rawProj) return null;

  // 1. Resolve from 6-digit postal code or 2-digit sector
  const postal = rawProj.postalCode || rawProj.postal_code;
  if (postal) {
    const s = String(postal).trim();
    if (s.length >= 2) {
      const sector = s.slice(0, 2);
      if (POSTAL_SECTOR_TO_DISTRICT[sector]) {
        return POSTAL_SECTOR_TO_DISTRICT[sector];
      }
    }
  }

  // 2. Count districts across all transactions
  const districtCounts = new Map();
  const txList = rawProj.transaction || rawProj.transactions || rawProj.rental || rawProj.rentals || [];
  for (const item of txList) {
    const d = cleanPostalDistrict(item.district || item.postal_district);
    if (d) {
      districtCounts.set(d, (districtCounts.get(d) || 0) + 1);
    }
  }

  // 3. Fallback to project-level district field
  const projD = cleanPostalDistrict(rawProj.district || rawProj.postal_district);
  if (projD) {
    districtCounts.set(projD, (districtCounts.get(projD) || 0) + 1);
  }

  if (districtCounts.size === 0) return null;

  let bestDistrict = null;
  let maxCount = -1;
  for (const [d, count] of districtCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestDistrict = d;
    }
  }
  return bestDistrict;
}

/**
 * Determines whether a development name indicates a landed property aggregate.
 * @param {string} projName
 * @returns {boolean}
 */
export function isLandedDevelopment(projName) {
  if (!projName) return false;
  const upper = projName.trim().toUpperCase();
  return (
    upper.includes('LANDED HOUSING') ||
    upper.includes('SEMI-DETACHED') ||
    upper.includes('DETACHED HOUSE') ||
    upper.includes('TERRACE HOUSE') ||
    upper.includes('BUNGALOW')
  );
}

/**
 * Resolves an existing project or inserts a new one into `projects` table.
 * Matches strictly on (project_name, street_name).
 * Strictly enforces geocoding hierarchy: SVY21 -> OneMap -> District Centroid -> NULL.
 * @param {object} conn Database connection wrapper
 * @param {object} rawProj Project payload
 * @returns {Promise<{ projId: number, projName: string, street: string, resolvedDistrict: string|null, isNew: boolean }>}
 */
export async function getOrCreateProject(conn, rawProj) {
  const projName = (rawProj.project || rawProj.project_name || 'Unknown Project').trim().toUpperCase();
  const rawStreet = (rawProj.street || rawProj.street_name || 'Singapore').trim();
  const street = normalizeStreetName(rawStreet);
  const segment = rawProj.marketSegment || rawProj.market_segment || 'OCR';

  let projRecord = await conn.get(
    `SELECT project_id, postal_district, latitude, longitude, geo_source, planning_area FROM projects WHERE UPPER(project_name) = UPPER(?) AND UPPER(street_name) = UPPER(?)`,
    [projName, street]
  );

  const resolvedDistrict = resolveProjectDistrict(rawProj);

  if (!projRecord) {
    let geo = null;
    if (rawProj.x && rawProj.y) {
      geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
    }

    let lat = null, lng = null, geoSource = null;
    const planningArea = rawProj.planningArea || rawProj.planning_area || null;

    if (geo) {
      lat = geo.latitude;
      lng = geo.longitude;
      geoSource = 'svy21';
    } else if (rawProj.latitude && rawProj.longitude) {
      lat = parseFloat(rawProj.latitude);
      lng = parseFloat(rawProj.longitude);
      geoSource = 'onemap';
    } else if (resolvedDistrict) {
      const center = getDistrictCenter(resolvedDistrict);
      if (center) {
        lat = center.lat;
        lng = center.lng;
        geoSource = 'district_centre';
      }
    }

    const isLanded = isLandedDevelopment(projName);
    const insertRes = await conn.run(
      `INSERT INTO projects (project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude, geo_source, is_landed_aggregate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projName, street, resolvedDistrict, segment, planningArea, lat, lng, geoSource, isLanded ? 1 : 0]
    );
    return { projId: insertRes.lastID, projName, street, resolvedDistrict, isNew: true };
  }

  const projId = projRecord.project_id;
  // If existing record was missing district or coordinates, enrich it if incoming record has higher fidelity
  if (!projRecord.postal_district && resolvedDistrict) {
    await conn.run(`UPDATE projects SET postal_district = ? WHERE project_id = ?`, [resolvedDistrict, projId]);
  }
  if ((projRecord.latitude == null || projRecord.geo_source === 'district_centre') && rawProj.x && rawProj.y) {
    const geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
    if (geo) {
      await conn.run(
        `UPDATE projects SET latitude = ?, longitude = ?, geo_source = 'svy21' WHERE project_id = ?`,
        [geo.latitude, geo.longitude, projId]
      );
    }
  }

  return {
    projId,
    projName,
    street,
    resolvedDistrict: projRecord.postal_district || resolvedDistrict,
    isNew: false
  };
}
