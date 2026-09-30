/**
 * Migration 004: Clean Data Integrity & Stacked Geocoding Remediation (Step 2.3, 2.4, 2.7)
 * - Normalizes postal_district in projects: only '01'..'28' or NULL (no '00', 'CCR', 'RCR', 'OCR')
 * - Un-stacks copied coordinates on streets (e.g. 27 condos on Pasir Panjang Rd)
 * - Sets geo_source accurately ('svy21' or NULL)
 * - Ensures no_of_units defaults to 1 for existing transactions
 */

export const name = '004_clean_data_integrity';

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  console.log('[Migration 004] Cleaning postal districts in projects...');
  // 1. District normalization: remove segment codes and '00', store NULL
  await run(`
    UPDATE projects
    SET postal_district = NULL
    WHERE postal_district NOT IN (
      '01','02','03','04','05','06','07','08','09','10',
      '11','12','13','14','15','16','17','18','19','20',
      '21','22','23','24','25','26','27','28'
    )
  `);

  console.log('[Migration 004] Remediating copied street coordinates...');
  // 2. Identify projects that had their coordinates stacked by legacy streetMatch fallback
  const stackedGroups = await all(`
    SELECT street_name, latitude, longitude, MIN(project_id) as original_id, COUNT(*) as cnt
    FROM projects
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    GROUP BY UPPER(street_name), latitude, longitude
    HAVING cnt > 1
  `);

  let unstackedCount = 0;
  for (const group of stackedGroups) {
    // Keep original_id's coordinates; clear inherited coordinates for other projects on that street
    const res = await run(
      `UPDATE projects 
       SET latitude = NULL, longitude = NULL, geo_source = NULL
       WHERE UPPER(street_name) = UPPER(?) AND latitude = ? AND longitude = ? AND project_id != ?`,
      [group.street_name, group.latitude, group.longitude, group.original_id]
    );
    unstackedCount += (group.cnt - 1);
  }
  console.log(`[Migration 004] Unstacked ${unstackedCount} copied coordinates across ${stackedGroups.length} street groups.`);

  // 3. Set geo_source = 'svy21' for projects that retained unique coordinates
  await run(`
    UPDATE projects
    SET geo_source = 'svy21'
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geo_source IS NULL
  `);

  // 4. Set no_of_units = 1 where missing
  await run(`
    UPDATE property_transactions
    SET no_of_units = 1
    WHERE no_of_units IS NULL
  `);
}
