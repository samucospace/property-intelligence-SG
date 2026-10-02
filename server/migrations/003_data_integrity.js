/**
 * Migration 003: Data Integrity (P1)
 * - Adds no_of_units column to property_transactions for bulk sale tracking
 * - Makes area and psft columns in rental_transactions nullable to eliminate invented 1000 sqft defaults
 * - Adds source column and seed_versions table to support reliable amenity reseeding
 */

export const name = '003_data_integrity';

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  // 1. Ensure property_transactions has no_of_units column
  const txCols = await all(`PRAGMA table_info(property_transactions)`);
  const txColNames = new Set(txCols.map(c => c.name));
  if (!txColNames.has('no_of_units')) {
    await run(`ALTER TABLE property_transactions ADD COLUMN no_of_units INTEGER DEFAULT 1`);
  }

  // 2. Ensure amenities has source column
  const amenityCols = await all(`PRAGMA table_info(amenities)`);
  const amenityColNames = new Set(amenityCols.map(c => c.name));
  if (!amenityColNames.has('source')) {
    await run(`ALTER TABLE amenities ADD COLUMN source TEXT DEFAULT 'seed'`);
  }
  await run(`CREATE INDEX IF NOT EXISTS idx_amenities_source ON amenities(source)`);

  // 3. Ensure seed_versions table exists
  await run(`
    CREATE TABLE IF NOT EXISTS seed_versions (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Check if rental_transactions has NOT NULL constraints on area/psft columns
  const rentCols = await all(`PRAGMA table_info(rental_transactions)`);
  const areaSqmCol = rentCols.find(c => c.name === 'area_sqm');

  if (areaSqmCol && areaSqmCol.notnull === 1) {
    console.log('[Migration 003] Rebuilding rental_transactions to allow nullable area and psft fields...');

    await run(`SAVEPOINT migration_table_rebuild`);

    try {
      await run(`
        CREATE TABLE rental_transactions_new (
          rental_id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          area_sqm REAL,
          area_sqft REAL,
          rent_sgd REAL NOT NULL,
          rent_psqm REAL,
          rent_psft REAL,
          lease_date TEXT NOT NULL,
          bedroom_count TEXT,
          floor_area_range TEXT,
          property_type TEXT,
          raw_hash TEXT UNIQUE,
          FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
        );
      `);

      await run(`
        INSERT INTO rental_transactions_new (
          rental_id, project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft,
          lease_date, bedroom_count, floor_area_range, property_type, raw_hash
        )
        SELECT rental_id, project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft,
               lease_date, bedroom_count, floor_area_range, property_type, raw_hash
        FROM rental_transactions;
      `);

      await run(`DROP TABLE rental_transactions`);
      await run(`ALTER TABLE rental_transactions_new RENAME TO rental_transactions`);

      // Recreate rental indexes
      await run(`CREATE INDEX IF NOT EXISTS idx_rentals_date ON rental_transactions(lease_date DESC);`);
      await run(`CREATE INDEX IF NOT EXISTS idx_rentals_project ON rental_transactions(project_id);`);
      await run(`CREATE INDEX IF NOT EXISTS idx_rentals_bedroom ON rental_transactions(bedroom_count);`);

      await run(`RELEASE migration_table_rebuild`);
      console.log('[Migration 003] rental_transactions rebuilt successfully.');
    } catch (err) {
      await run(`ROLLBACK TO migration_table_rebuild`);
    await run(`RELEASE migration_table_rebuild`);
      throw err;
    } finally {

    }
  }
}
