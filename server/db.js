import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'property.db');

const db = new sqlite3.Database(dbPath);

export function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

export function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export async function initDb() {
  await dbRun(`
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

  await dbRun(`
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

  await dbRun(`
    CREATE TABLE IF NOT EXISTS sora_rates (
      reference_month TEXT PRIMARY KEY,
      sora_1m REAL NOT NULL,
      sora_3m REAL NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await dbRun(`
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

  await dbRun(`
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

  await dbRun(`
    CREATE TABLE IF NOT EXISTS leads (
      lead_id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      lead_type TEXT NOT NULL,
      project_interest TEXT,
      phone TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON property_transactions(contract_date DESC);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_transactions_project ON property_transactions(project_id);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_rentals_date ON rental_transactions(lease_date DESC);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_rentals_project ON rental_transactions(project_id);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_rentals_bedroom ON rental_transactions(bedroom_count);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(postal_district);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_projects_street ON projects(street_name);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_projects_planning_area ON projects(planning_area);`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_amenities_category ON amenities(category);`);

  console.log('Database initialized successfully.');
}

export default db;
