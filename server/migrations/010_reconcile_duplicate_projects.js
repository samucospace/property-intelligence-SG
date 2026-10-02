/**
 * Migration 010: Reconcile Duplicate Projects & Dataset Hardening (GL-04, GL-05, GL-08)
 *
 * 1. Standardizes street names (Saint vs Street prefixes).
 * 2. Consolidates 35 candidate duplicate project groups (70 project rows into 35 canonical rows)
 *    and reassigns all associated sales caveats and rental leases without loss.
 * 3. Repairs incorrectly flagged non-landed aggregate development.
 * 4. Cleans invalid planning areas (street names and generic "Central") to NULL for district fallback.
 * 5. Suppresses livability scoring on approximate coordinates (district_centre).
 * 6. Refreshes 24-month rolling median benchmarks.
 */

import { normalizeStreetName } from '../utils/streetUtils.js';

export const name = '010_reconcile_duplicate_projects';

const URA_PLANNING_AREAS = [
  'ANG MO KIO', 'BEDOK', 'BISHAN', 'BOON LAY', 'BUKIT BATOK', 'BUKIT MERAH',
  'BUKIT PANJANG', 'BUKIT TIMAH', 'CENTRAL WATER CATCHMENT', 'CHANGI', 'CHANGI BAY',
  'CHOA CHU KANG', 'CLEMENTI', 'DOWNTOWN CORE', 'GEYLANG', 'HOUGANG', 'JURONG EAST',
  'JURONG WEST', 'KALLANG', 'LIM CHU KANG', 'MANDAI', 'MARINE PARADE', 'MUSEUM',
  'NEWTON', 'NOVENA', 'ORCHARD', 'OUTRAM', 'PASIR RIS', 'PAYA LEBAR', 'PIONEER',
  'PUNGGOL', 'QUEENSTOWN', 'RIVER VALLEY', 'ROCHOR', 'SELETAR', 'SEMBAWANG',
  'SENGKANG', 'SERANGOON', 'SIMPANG', 'SINGAPORE RIVER', 'SOUTHERN ISLANDS',
  'STRAITS VIEW', 'SUNGEI KADUT', 'TAMPINES', 'TANGLIN', 'TENGAH', 'TOA PAYOH',
  'TUAS', 'WESTERN ISLANDS', 'WESTERN WATER CATCHMENT', 'WOODLANDS', 'YISHUN',
  'MARINA EAST', 'MARINA SOUTH', 'NORTH-EASTERN ISLANDS'
];

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  console.log('[Migration 010] Starting project deduplication and catalog reconciliation...');

  // Step 1: Query all projects to group and adjudicate duplicates
  const allProjects = await all(`
    SELECT p.project_id, p.project_name, p.street_name, p.postal_district, p.market_segment,
           p.planning_area, p.latitude, p.longitude, p.geo_source, p.is_landed_aggregate, p.tenure_class,
           (SELECT COUNT(*) FROM property_transactions WHERE project_id=p.project_id) as sales_cnt,
           (SELECT COUNT(*) FROM rental_transactions WHERE project_id=p.project_id) as rentals_cnt
    FROM projects p
  `);

  const groups = new Map();
  for (const p of allProjects) {
    const normStreet = normalizeStreetName(p.street_name);
    const key = p.project_name.trim().toUpperCase() + '|' + normStreet;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...p, normStreet });
  }

  let mergedGroups = 0;
  let redundantProjectsRemoved = 0;
  let salesMoved = 0;
  let rentalsMoved = 0;

  for (const [, projs] of groups) {
    if (projs.length > 1) {
      mergedGroups++;
      // Sort canonical master: prefer SVY21 coordinates, then transaction volume, then lowest project_id
      projs.sort((a, b) => {
        if (a.geo_source === 'svy21' && b.geo_source !== 'svy21') return -1;
        if (b.geo_source === 'svy21' && a.geo_source !== 'svy21') return 1;
        const aTx = a.sales_cnt + a.rentals_cnt;
        const bTx = b.sales_cnt + b.rentals_cnt;
        if (aTx !== bTx) return bTx - aTx;
        return a.project_id - b.project_id;
      });

      const canonical = projs[0];
      const redundant = projs.slice(1);

      // Backfill missing coordinates or district from redundant rows
      let newLat = canonical.latitude;
      let newLng = canonical.longitude;
      let newGeo = canonical.geo_source;
      let newDistrict = canonical.postal_district;

      for (const r of redundant) {
        if (!newGeo && r.geo_source) {
          newGeo = r.geo_source;
          newLat = r.latitude;
          newLng = r.longitude;
        }
        if (!newDistrict && r.postal_district) {
          newDistrict = r.postal_district;
        }
      }

      // Reassign transactions to canonical project and delete redundant rows first
      for (const r of redundant) {
        redundantProjectsRemoved++;
        salesMoved += r.sales_cnt;
        rentalsMoved += r.rentals_cnt;

        await run(`UPDATE property_transactions SET project_id = ? WHERE project_id = ?`, [canonical.project_id, r.project_id]);
        await run(`UPDATE rental_transactions SET project_id = ? WHERE project_id = ?`, [canonical.project_id, r.project_id]);
        await run(`DELETE FROM project_benchmarks WHERE project_id = ?`, [r.project_id]);
        await run(`DELETE FROM projects WHERE project_id = ?`, [r.project_id]);
      }

      await run(
        `UPDATE projects SET street_name = ?, latitude = ?, longitude = ?, geo_source = ?, postal_district = ? WHERE project_id = ?`,
        [canonical.normStreet, newLat, newLng, newGeo, newDistrict, canonical.project_id]
      );
    } else {
      const p = projs[0];
      if (p.street_name !== p.normStreet) {
        await run(`UPDATE projects SET street_name = ? WHERE project_id = ?`, [p.normStreet, p.project_id]);
      }
    }
  }

  console.log(`[Migration 010] Consolidated ${mergedGroups} duplicate groups (removed ${redundantProjectsRemoved} redundant rows, moved ${salesMoved} sales, ${rentalsMoved} rentals).`);

  // Step 2: Repair landed flag on non-landed residential developments
  const landedFix = await run(`
    UPDATE projects 
    SET is_landed_aggregate = 0 
    WHERE project_name LIKE '%NON-LANDED%' AND is_landed_aggregate = 1
  `);
  if (landedFix?.changes > 0) {
    console.log(`[Migration 010] Corrected landed flag for ${landedFix.changes} non-landed project records.`);
  }

  // Step 3: Clean invalid planning area values (street names or generic 'Central')
  const placeholders = URA_PLANNING_AREAS.map(() => '?').join(',');
  const planningClean = await run(
    `UPDATE projects SET planning_area = NULL WHERE planning_area IS NOT NULL AND UPPER(planning_area) NOT IN (${placeholders})`,
    URA_PLANNING_AREAS
  );
  console.log(`[Migration 010] Cleaned ${planningClean?.changes || 0} invalid planning area entries to NULL.`);

  // Step 4: Suppress livability scores for approximate coordinates (GL-08)
  const approxQuarantine = await run(`
    UPDATE projects 
    SET livability_score = NULL, livability_data = NULL 
    WHERE geo_source = 'district_centre'
  `);
  console.log(`[Migration 010] Quarantined livability scoring for ${approxQuarantine?.changes || 0} approximate district_centre projects.`);

  // Step 5: Refresh project benchmarks table to include consolidated transactions
  console.log('[Migration 010] Refreshing 24-month rolling median sale benchmarks...');
  await run(`DELETE FROM project_benchmarks`);
  await run(`
    INSERT INTO project_benchmarks (project_id, rolling_24m_median_price, rolling_24m_median_psft, sale_count, updated_at)
    WITH ranked_psft AS (
      SELECT project_id, psft_sgd,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY psft_sgd) AS rn,
             COUNT(*) OVER (PARTITION BY project_id) AS cnt
      FROM property_transactions
      WHERE contract_date >= date('now', '-24 months')
        AND (no_of_units = 1 OR no_of_units IS NULL)
    ),
    med_psft AS (
      SELECT project_id,
             ROUND(AVG(psft_sgd), 2) AS rolling_24m_median_psft,
             cnt AS sale_count
      FROM ranked_psft
      WHERE rn IN ((cnt + 1)/2, (cnt + 2)/2)
      GROUP BY project_id
    ),
    ranked_price AS (
      SELECT project_id, price_sgd,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY price_sgd) AS rn,
             COUNT(*) OVER (PARTITION BY project_id) AS cnt
      FROM property_transactions
      WHERE contract_date >= date('now', '-24 months')
        AND (no_of_units = 1 OR no_of_units IS NULL)
    ),
    med_price AS (
      SELECT project_id,
             ROUND(AVG(price_sgd)) AS rolling_24m_median_price
      FROM ranked_price
      WHERE rn IN ((cnt + 1)/2, (cnt + 2)/2)
      GROUP BY project_id
    )
    SELECT p.project_id,
           pr.rolling_24m_median_price,
           p.rolling_24m_median_psft,
           p.sale_count,
           CURRENT_TIMESTAMP
    FROM med_psft p
    JOIN med_price pr ON p.project_id = pr.project_id
  `);

  console.log('[Migration 010] Migration 010 complete.');
}
