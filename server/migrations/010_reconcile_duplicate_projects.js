import { mergeReviewedProjects, readAdjudications } from '../utils/projectAdjudication.js';
import { withTransaction } from '../db.js';
/**
 * Migration 010: Reconcile Duplicate Projects & Dataset Hardening (GL-04, GL-05, GL-08)
 *
 * 1. Standardizes street names (Saint vs Street prefixes).
 * 2. Applies only explicitly approved identity mappings with exact preconditions;
 *    pending normalization collisions retain their original rows and ownership.
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

export async function up(conn, {adjudications = readAdjudications()} = {}) {
  await withTransaction(conn, () => reconcile(conn, adjudications));
}

async function reconcile(conn, adjudications) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  console.log('[Migration 010] Starting project deduplication and catalog reconciliation...');

  // Step 1: Query all projects to group and adjudicate duplicates
  let allProjects = await all(`
    SELECT p.project_id, p.project_name, p.street_name, p.postal_district, p.market_segment,
           p.planning_area, p.latitude, p.longitude, p.geo_source, p.is_landed_aggregate, p.tenure_class,
           (SELECT COUNT(*) FROM property_transactions WHERE project_id=p.project_id) as sales_cnt,
           (SELECT COUNT(*) FROM rental_transactions WHERE project_id=p.project_id) as rentals_cnt
    FROM projects p
  `);

  const reviewed = await mergeReviewedProjects(conn, allProjects, adjudications);
  allProjects = reviewed.projects;
  const groups = new Map();
  for (const project of allProjects) {
    const street = normalizeStreetName(project.street_name);
    const key = project.project_name.trim().toUpperCase()+'|'+street;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({...project,normStreet:street});
  }
  for (const projects of groups.values()) {
    if (projects.length > 1) {
      // Keep original identities and street strings until explicitly reviewed.
      for (const project of projects) await run(
        'INSERT OR IGNORE INTO project_identity_review(project_id,status,reason) VALUES(?,?,?)',
        [project.project_id,'pending','Ambiguous normalized identity; no automatic merge']);
    } else {
      const project=projects[0];
      await run('UPDATE projects SET street_name=? WHERE project_id=?',[project.normStreet,project.project_id]);
    }
  }
  console.log('[Migration 010] Explicitly approved removals:', reviewed.removed);

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

  const { refreshProjectBenchmarks } = await import('../queryEngine.js');
  await refreshProjectBenchmarks(conn);
}
