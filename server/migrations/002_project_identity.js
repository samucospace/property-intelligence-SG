/**
 * Migration 002: Project Identity & Landed Housing Aggregation
 * Transitions projects unique constraint from project_name to (project_name, street_name),
 * allows nullable postal_district, and adds geo_source, is_landed_aggregate, livability_score, livability_data.
 */

export const name = '002_project_identity';

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);
  if ((await conn.get('PRAGMA foreign_keys')).foreign_keys !== 0) throw new Error('Table reconstruction must run through the transactional migration runner');

  const cols = await all(`PRAGMA table_info(projects)`);
  const colNames = new Set(cols.map(c => c.name));

  // If already migrated, skip table rebuild
  if (colNames.has('geo_source') && colNames.has('is_landed_aggregate')) {
    return;
  }

  // SQLite table reconstruction with foreign key safety

  await run(`SAVEPOINT migration_table_rebuild`);

  try {
    await run(`
      CREATE TABLE projects_new (
        project_id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        street_name TEXT NOT NULL,
        postal_district TEXT,
        market_segment TEXT NOT NULL,
        planning_area TEXT,
        latitude REAL,
        longitude REAL,
        geo_source TEXT,
        is_landed_aggregate INTEGER DEFAULT 0,
        livability_score INTEGER,
        livability_data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_name, street_name)
      );
    `);

    await run(`
      INSERT OR IGNORE INTO projects_new (
        project_id, project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude, updated_at
      )
      SELECT project_id, project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude, updated_at
      FROM projects;
    `);

    // Flag known landed aggregate names
    await run(`
      UPDATE projects_new
      SET is_landed_aggregate = 1
      WHERE UPPER(project_name) LIKE '%LANDED HOUSING%'
         OR UPPER(project_name) LIKE '%LANDED DEVELOPMENT%'
         OR UPPER(project_name) = 'LANDED';
    `);

    await run(`DROP TABLE projects`);
    await run(`ALTER TABLE projects_new RENAME TO projects`);

    // Recreate indexes
    await run(`CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(postal_district);`);
    await run(`CREATE INDEX IF NOT EXISTS idx_projects_street ON projects(street_name);`);
    await run(`CREATE INDEX IF NOT EXISTS idx_projects_planning_area ON projects(planning_area);`);
    await run(`CREATE INDEX IF NOT EXISTS idx_projects_landed ON projects(is_landed_aggregate);`);

    await run(`RELEASE migration_table_rebuild`);
  } catch (err) {
    await run(`ROLLBACK TO migration_table_rebuild`);
    await run(`RELEASE migration_table_rebuild`);
    throw err;
  } finally {

  }
}
