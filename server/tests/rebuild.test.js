import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { rebuildCleanDb } from '../scripts/rebuild-clean-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Clean Database Rebuild Safety & Atomic Rollback (GL-01)', () => {
  const testDir = path.join(__dirname, 'temp-rebuild-test');
  const liveDbFile = path.join(testDir, 'live-test.db');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('preserves all leads columns dynamically including Migration 008 cooldowns (G1-6)', async () => {
    // 1. Initialize live test database with full schema and sample lead data
    const liveConn = createConnection(liveDbFile);
    await runMigrations(liveConn);

    await liveConn.run(`
      INSERT INTO leads (
        name, email, phone, lead_type, pdpa_consent,
        confirmation_token, confirmed_at, consent_version, consent_at,
        last_confirmation_sent_at, last_newsletter_sent_at
      ) VALUES (
        'Alice Test', 'alice@example.com', '91234567', 'newsletter', 1,
        'token-alice-123', '2026-09-01 10:00:00', '1.0', '2026-09-01 09:55:00',
        '2026-09-01 09:55:00', '2026-09-28 08:00:00'
      )
    `);

    await liveConn.run(`
      INSERT INTO leads (
        name, email, phone, lead_type, pdpa_consent,
        last_confirmation_sent_at
      ) VALUES (
        'Bob Test', 'bob@example.com', '98765432', 'agent_advisory', 1,
        '2026-09-15 14:30:00'
      )
    `);

    await liveConn.close();

    // 2. Execute rebuild using custom mock data provider
    const mockProvider = async (conn) => {
      // Ingest a minimal mock project
      await conn.run(`
        INSERT INTO projects (project_name, street_name, market_segment)
        VALUES ('REBUILD TEST CONDO', 'TEST WAY', 'OCR')
      `);
      await conn.run("INSERT INTO property_transactions(project_id,area_sqm,area_sqft,price_sgd,psqm_sgd,psft_sgd,contract_date,raw_hash) VALUES(1,100,1076.39,1000000,10000,929,'2026-01-01','rebuild-sale')");
      await conn.run("INSERT INTO rental_transactions(project_id,rent_sgd,lease_date,raw_hash) VALUES(1,4000,'2026-01','rebuild-rent')");
      return { status: 'success' };
    };

    const res = await rebuildCleanDb({
      targetLivePath: liveDbFile,
      minimumCounts: { projects: 1, sales: 1, rentals: 1 },
      isForce: true,
      dataProvider: mockProvider
    });

    expect(res.success).toBe(true);

    // 3. Verify target database has restored leads with all Migration 008 columns intact
    const verifyConn = createConnection(liveDbFile);
    try {
      const restoredLeads = await verifyConn.all(`SELECT * FROM leads ORDER BY email ASC`);
      expect(restoredLeads).toHaveLength(2);

      const alice = restoredLeads.find(l => l.email === 'alice@example.com');
      expect(alice).toBeDefined();
      expect(alice.name).toBe('Alice Test');
      expect(alice.confirmation_token).toBe('token-alice-123');
      expect(alice.last_confirmation_sent_at).toBe('2026-09-01 09:55:00');
      expect(alice.last_newsletter_sent_at).toBe('2026-09-28 08:00:00');

      const bob = restoredLeads.find(l => l.email === 'bob@example.com');
      expect(bob).toBeDefined();
      expect(bob.last_confirmation_sent_at).toBe('2026-09-15 14:30:00');
    } finally {
      await verifyConn.close();
    }
  });

  it('aborts rebuild and leaves source database untouched when provider fails (G1-5)', async () => {
    // 1. Initialize live test database with baseline data
    const liveConn = createConnection(liveDbFile);
    await runMigrations(liveConn);
    await liveConn.run(`
      INSERT INTO projects (project_name, street_name, market_segment)
      VALUES ('ORIGINAL CONDO', 'ORIGINAL STREET', 'CCR')
    `);
    await liveConn.close();

    // 2. Run rebuild with a failing data provider
    const failingProvider = async () => {
      return { status: 'failed', error: 'Simulated network timeout during URA sync' };
    };

    await expect(
      rebuildCleanDb({
        targetLivePath: liveDbFile,
        isForce: true,
        dataProvider: failingProvider
      })
    ).rejects.toThrow(/Data ingestion failed or returned partial results/);

    // 3. Verify original database was NOT damaged or modified
    const verifyConn = createConnection(liveDbFile);
    try {
      const orig = await verifyConn.get(`SELECT * FROM projects WHERE project_name = 'ORIGINAL CONDO'`);
      expect(orig).toBeDefined();
      expect(orig.street_name).toBe('ORIGINAL STREET');
    } finally {
      await verifyConn.close();
    }
  });
});
