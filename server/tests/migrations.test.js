import { describe, it, expect } from 'vitest';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';

describe('Database Migrations from Empty State (CI Safe)', () => {
  it('applies all versioned migrations (001 through 007) on a fresh empty database', async () => {
    const conn = createConnection(':memory:');
    try {
      await runMigrations(conn);

      const tables = await conn.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('property_transactions');
      expect(tableNames).toContain('rental_transactions');
      expect(tableNames).toContain('leads');
      expect(tableNames).toContain('amenities');
      expect(tableNames).toContain('project_benchmarks');
      expect(tableNames).toContain('sora_rates');

      // Verify leads table has migration 007 and 008 columns
      const leadCols = await conn.all(`PRAGMA table_info(leads)`);
      const leadColNames = leadCols.map(c => c.name);
      expect(leadColNames).toContain('confirmed_at');
      expect(leadColNames).toContain('confirmation_token');
      expect(leadColNames).toContain('consent_version');
      expect(leadColNames).toContain('consent_at');
      expect(leadColNames).toContain('last_confirmation_sent_at');
      expect(leadColNames).toContain('last_newsletter_sent_at');
    } finally {
      await conn.close();
    }
  });

  it('migration 007 succeeds on a leads table with existing rows and duplicate newsletter emails', async () => {
    const conn = createConnection(':memory:');
    try {
      // 1. Manually create baseline schema up to migration 006
      await conn.run(`
        CREATE TABLE leads (
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

      // Insert pre-existing rows with duplicate newsletter emails
      await conn.run(`INSERT INTO leads (name, email, lead_type) VALUES ('Old User 1', 'subscriber@example.com', 'newsletter')`);
      await conn.run(`INSERT INTO leads (name, email, lead_type) VALUES ('Old User 2', 'subscriber@example.com', 'newsletter')`);
      await conn.run(`INSERT INTO leads (name, email, lead_type) VALUES ('Lead 1', 'buyer@example.com', 'agent_advisory')`);

      // 2. Run migration 007
      const migration007 = await import('../migrations/007_leads_enhancements.js');
      await migration007.up(conn);

      // Verify columns added
      const cols = await conn.all(`PRAGMA table_info(leads)`);
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('consent_at');
      expect(colNames).toContain('confirmed_at');

      // Verify duplicate newsletter emails were deduplicated to 1 row
      const newsRows = await conn.all(`SELECT * FROM leads WHERE lead_type = 'newsletter' AND email = 'subscriber@example.com'`);
      expect(newsRows.length).toBe(1);

      // Verify agent advisory lead was untouched
      const agentRows = await conn.all(`SELECT * FROM leads WHERE lead_type = 'agent_advisory'`);
      expect(agentRows.length).toBe(1);
    } finally {
      await conn.close();
    }
  });

  it('computes independent, accurate true medians for price and psft without cross-averaging', async () => {
    const conn = createConnection(':memory:');
    try {
      await runMigrations(conn);

      // Create a test project
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, market_segment, is_landed_aggregate)
        VALUES (999, 'TEST MEDIAN RESIDENCES', 'Test Street', 'CCR', 0)
      `);

      // Insert transactions where unit 1 has low price but high psft, and unit 2 has high price but low psft
      // Unit 1: 500 sqft, $1,500,000 -> $3,000 psft
      // Unit 2: 1000 sqft, $2,000,000 -> $2,000 psft
      // Unit 3: 2000 sqft, $3,000,000 -> $1,500 psft
      // True price median of [1.5M, 2.0M, 3.0M] = $2,000,000
      // True psft median of [1500, 2000, 3000] = $2,000 psft
      await conn.run(`
        INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, raw_hash)
        VALUES
          (999, date('now', '-1 month'), 1500000, 3000.0, 32291.7, 500, 46.5, 1, 'Resale', 'h1'),
          (999, date('now', '-2 month'), 2000000, 2000.0, 21527.8, 1000, 92.9, 1, 'Resale', 'h2'),
          (999, date('now', '-3 month'), 3000000, 1500.0, 16145.8, 2000, 185.8, 1, 'Resale', 'h3')
      `);

      const migration005 = await import('../migrations/005_benchmarks_and_tenure.js');
      await migration005.up(conn);

      const bench = await conn.get(`SELECT * FROM project_benchmarks WHERE project_id = 999`);
      expect(bench).toBeDefined();
      expect(bench.rolling_24m_median_price).toBe(2000000);
      expect(bench.rolling_24m_median_psft).toBe(2000.0);
      expect(bench.sale_count).toBe(3);
    } finally {
      await conn.close();
    }
  });
});
