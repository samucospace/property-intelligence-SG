/**
 * Migration 001: Baseline schema
 * Ensures core tables and indexes exist, with clean column definitions for leads.
 */

export const name = '001_baseline_schema';

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL UNIQUE,
      street_name TEXT NOT NULL,
      postal_district TEXT NOT NULL,
      market_segment TEXT NOT NULL,
      planning_area TEXT,
      latitude REAL,
      longitude REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS property_transactions (
      transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      area_sqm REAL NOT NULL,
      area_sqft REAL NOT NULL,
      price_sgd REAL NOT NULL,
      psqm_sgd REAL NOT NULL,
      psft_sgd REAL NOT NULL,
      contract_date TEXT NOT NULL,
      floor_range TEXT,
      tenure TEXT,
      type_of_sale TEXT,
      property_type TEXT,
      raw_hash TEXT UNIQUE,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sora_rates (
      reference_month TEXT PRIMARY KEY,
      sora_1m REAL NOT NULL,
      sora_3m REAL NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS amenities (
      amenity_id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS rental_transactions (
      rental_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      area_sqm REAL NOT NULL,
      area_sqft REAL NOT NULL,
      rent_sgd REAL NOT NULL,
      rent_psqm REAL NOT NULL,
      rent_psft REAL NOT NULL,
      lease_date TEXT NOT NULL,
      bedroom_count TEXT,
      floor_area_range TEXT,
      property_type TEXT,
      raw_hash TEXT UNIQUE,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS leads (
      lead_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      lead_type TEXT NOT NULL,
      enquiry_type TEXT,
      project_interest TEXT,
      pdpa_consent INTEGER DEFAULT 1,
      details TEXT,
      unsubscribed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Verify and add any missing leads columns without try/catch swallowing
  const leadCols = await all(`PRAGMA table_info(leads)`);
  const colNames = new Set(leadCols.map(c => c.name));

  if (!colNames.has('name')) {
    await run(`ALTER TABLE leads ADD COLUMN name TEXT`);
  }
  if (!colNames.has('enquiry_type')) {
    await run(`ALTER TABLE leads ADD COLUMN enquiry_type TEXT`);
  }
  if (!colNames.has('pdpa_consent')) {
    await run(`ALTER TABLE leads ADD COLUMN pdpa_consent INTEGER DEFAULT 1`);
  }
  if (!colNames.has('unsubscribed_at')) {
    await run(`ALTER TABLE leads ADD COLUMN unsubscribed_at DATETIME`);
  }

  // Base indexes
  await run(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON property_transactions(contract_date DESC);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_transactions_project ON property_transactions(project_id);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_rentals_date ON rental_transactions(lease_date DESC);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_rentals_project ON rental_transactions(project_id);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_rentals_bedroom ON rental_transactions(bedroom_count);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(postal_district);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_projects_street ON projects(street_name);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_projects_planning_area ON projects(planning_area);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_amenities_category ON amenities(category);`);
}
