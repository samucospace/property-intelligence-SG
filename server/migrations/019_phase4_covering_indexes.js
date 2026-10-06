export async function up(conn) {
  // Filter joins must not repeatedly fetch large nearest-amenity blobs.
  await conn.run(`CREATE INDEX IF NOT EXISTS idx_projects_filter_cover ON projects
    (project_id,project_name,street_name,postal_district,planning_area,is_landed_aggregate)`);
  await conn.run(`CREATE INDEX IF NOT EXISTS idx_rental_month_scope ON rental_transactions
    (substr(lease_date,1,7),project_id,area_sqm,property_type,bedroom_count,source_district,rent_sgd,rent_psft,rent_psqm)`);
}
