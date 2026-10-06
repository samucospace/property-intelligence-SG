import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createConnection, getPrimaryConnection, closeDb } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { normalizeStreetName, isLandedDevelopment } from '../utils/streetUtils.js';
import { formatPlanningAreaFallback } from '../utils/geo.js';
import {
  getPriceAnalytics,
  getRentalYieldAnalytics,
  getMatchingProjectIdsByRadius,
  getAllProjects,
  syncCacheWithDataVersion,
  clearAnalyticsCache,
  refreshProjectBenchmarks
} from '../queryEngine.js';
import { precomputeAllProjectLivability, getGradeLabel } from '../livabilityEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDbPath = path.join(__dirname, 'test_phase2_db.sqlite');

describe('Phase 2: Dataset Reconciliation & Analytics Hardening', () => {
  let conn;

  beforeEach(async () => {
    await closeDb();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

    process.env.DB_PATH = testDbPath;
    conn = getPrimaryConnection();
    await runMigrations(conn);
    clearAnalyticsCache();
  });

  afterEach(async () => {
    clearAnalyticsCache();
    await closeDb();
    delete process.env.DB_PATH;
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  });

  // T-P2-01: Street name normalization regex
  describe('T-P2-01: Street Name Normalization & Landed Detection', () => {
    it('normalizes ST./STREET prefix to SAINT while preserving STREET suffix', () => {
      expect(normalizeStreetName("ST. PATRICK'S ROAD")).toBe("SAINT PATRICK'S ROAD");
      expect(normalizeStreetName("ST PATRICK'S ROAD")).toBe("SAINT PATRICK'S ROAD");
      expect(normalizeStreetName("STREET. PATRICK'S ROAD")).toBe("SAINT PATRICK'S ROAD");
      expect(normalizeStreetName("ST. MICHAEL'S ROAD")).toBe("SAINT MICHAEL'S ROAD");
      expect(normalizeStreetName("CHURCH STREET")).toBe("CHURCH STREET");
      expect(normalizeStreetName("HIGH STREET")).toBe("HIGH STREET");
      expect(normalizeStreetName("NORTH BRIDGE ROAD")).toBe("NORTH BRIDGE ROAD");
    });

    it('classifies landed vs non-landed developments correctly', () => {
      expect(isLandedDevelopment('LANDED HOUSING DEVELOPMENT')).toBe(true);
      expect(isLandedDevelopment('SEMI-DETACHED HOUSE')).toBe(true);
      expect(isLandedDevelopment('NON-LANDED RESIDENTIAL')).toBe(false);
      expect(isLandedDevelopment('NON-LANDED HOUSING DEVELOPMENT')).toBe(false);
      expect(isLandedDevelopment('CONDOMINIUM')).toBe(false);
    });
  });

  // T-P2-02 & T-P2-03: Deduplication, FK integrity, and landed flag repair
  describe('T-P2-02 & T-P2-03: Deduplication, FK Integrity & Landed Flag Repair', () => {
    it('consolidates duplicate project groups, moves all transactions, repairs landed flag, and passes FK check', async () => {
      // Seed duplicate projects: one with ST. PATRICK'S RD (svy21 coords), one with SAINT PATRICK'S RD (no coords)
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, latitude, longitude, geo_source, is_landed_aggregate, planning_area)
        VALUES
          (101, 'PATRICK RESIDENCES', "ST. PATRICK'S ROAD", '15', 'RCR', 1.305, 103.912, 'svy21', 0, 'BEDOK'),
          (102, 'PATRICK RESIDENCES', "SAINT PATRICK'S ROAD", '15', 'RCR', NULL, NULL, NULL, 0, 'Central'),
          (103, 'NON-LANDED RESIDENTIAL ON ORCHARD', 'ORCHARD ROAD', '09', 'CCR', 1.301, 103.838, 'svy21', 1, 'ORCHARD')
      `);

      // Seed transactions under both projects
      await conn.run(`
        INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, raw_hash)
        VALUES
          (101, date('now', '-1 month'), 1800000, 1800, 19375, 1000, 92.9, 1, 'Resale', 'h1'),
          (102, date('now', '-2 month'), 1850000, 1850, 19913, 1000, 92.9, 1, 'Resale', 'h2')
      `);

      await conn.run(`
        INSERT INTO rental_transactions (project_id, lease_date, rent_sgd, area_sqft, rent_psft, bedroom_count, raw_hash)
        VALUES
          (102, date('now', '-1 month'), 5000, 1000, 5.0, 3, 'rh1')
      `);

      // Run migration 010 explicitly
      const migration010 = await import('../migrations/010_reconcile_duplicate_projects.js');
      await migration010.up(conn, {adjudications:[{sourceId:102,targetId:101,status:'approved',approvedBy:'fixture-owner',approvedAt:'2026-10-05',sourceEvidence:'synthetic fixture',expectedSource:{project_name:'PATRICK RESIDENCES',street_name:"SAINT PATRICK'S ROAD",postal_district:'15'},expectedTarget:{project_name:'PATRICK RESIDENCES',street_name:"ST. PATRICK'S ROAD",postal_district:'15'}}]});

      // Verify FK integrity
      const fkErrors = await conn.all('PRAGMA foreign_key_check');
      expect(fkErrors.length).toBe(0);

      // Verify canonical project exists with normalized street name and merged transactions
      const remainingProjects = await conn.all('SELECT * FROM projects ORDER BY project_id');
      const projectIds = remainingProjects.map(p => p.project_id);
      expect(projectIds).toContain(101);
      expect(projectIds).not.toContain(102);

      const canonical = remainingProjects.find(p => p.project_id === 101);
      expect(canonical.street_name).toBe("SAINT PATRICK'S ROAD");
      expect(canonical.geo_source).toBe('svy21');

      // Verify transaction totals are invariant (both sales belong to project 101 now)
      const sales = await conn.all('SELECT * FROM property_transactions WHERE project_id = 101');
      expect(sales.length).toBe(2);
      const rentals = await conn.all('SELECT * FROM rental_transactions WHERE project_id = 101');
      expect(rentals.length).toBe(1);

      // T-P2-03: Verify is_landed_aggregate on NON-LANDED was repaired to 0
      const nonLanded = remainingProjects.find(p => p.project_id === 103);
      expect(nonLanded.is_landed_aggregate).toBe(0);

      // Verify generic 'Central' planning area was cleaned to NULL
      const cleaned = await conn.get('SELECT planning_area FROM projects WHERE project_id = 101');
      expect(cleaned.planning_area).toBe('BEDOK');
    });
  });

  // T-P2-04: Planning area fallback
  describe('T-P2-04: Planning Area Fallback Logic', () => {
    it('returns official URA planning area when valid', () => {
      expect(formatPlanningAreaFallback('BEDOK', 15)).toBe('BEDOK');
      expect(formatPlanningAreaFallback('DOWNTOWN CORE', 1)).toBe('DOWNTOWN CORE');
      expect(formatPlanningAreaFallback('QUEENSTOWN', 3)).toBe('QUEENSTOWN');
    });

    it('falls back to descriptive postal district when planning area is NULL or legacy generic', () => {
      expect(formatPlanningAreaFallback(null, 9)).toBe('District 09 (Orchard / River Valley)');
      expect(formatPlanningAreaFallback(undefined, 10)).toBe('District 10 (Tanglin / Holland / Bukit Timah)');
      expect(formatPlanningAreaFallback('Central', 1)).toBe('District 01 (Raffles Place / Marina / Cecil)');
      expect(formatPlanningAreaFallback('Central', 15)).toBe('District 15 (East Coast / Marine Parade / Katong)');
    });

    it('falls back to Singapore or District number for unmapped values', () => {
      expect(formatPlanningAreaFallback(null, null)).toBe('Singapore');
      expect(formatPlanningAreaFallback(null, 99)).toBe('District 99');
    });
  });

  // T-P2-05: Price analytics scatter pagination disjointness
  describe('T-P2-05: Scatter Pagination Disjointness (GL-06)', () => {
    it('returns non-overlapping disjoint scatter points across pages with accurate totalPages', async () => {
      // Seed 1 project and 10 transactions
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, is_landed_aggregate)
        VALUES (200, 'PAGINATION TOWER', 'TEST ROAD', '10', 'CCR', 0)
      `);

      for (let i = 1; i <= 10; i++) {
        await conn.run(`
          INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, raw_hash)
          VALUES (200, date('now', '-${i} day'), ${1000000 + i * 100000}, ${1500 + i * 50}, 16000, 800, 74.3, 1, 'Resale', 'ph_${i}')
        `);
      }

      // Query page 1 (limit 4)
      const resPage1 = await getPriceAnalytics({ projects: [200], page: 1, limit: 4 });
      expect(resPage1.scatter.length).toBe(4);
      expect(resPage1.page).toBe(1);
      expect(resPage1.totalPages).toBe(3);
      expect(resPage1.totalCount).toBe(10);

      // Query page 2 (limit 4)
      const resPage2 = await getPriceAnalytics({ projects: [200], page: 2, limit: 4 });
      expect(resPage2.scatter.length).toBe(4);
      expect(resPage2.page).toBe(2);

      // Query page 3 (limit 4)
      const resPage3 = await getPriceAnalytics({ projects: [200], page: 3, limit: 4 });
      expect(resPage3.scatter.length).toBe(2);
      expect(resPage3.page).toBe(3);

      // Check disjointness: none of the points on page 1, 2, or 3 share transaction IDs
      const p1Ids = new Set(resPage1.scatter.map(p => p.id));
      const p2Ids = new Set(resPage2.scatter.map(p => p.id));
      const p3Ids = new Set(resPage3.scatter.map(p => p.id));

      for (const id of p2Ids) {
        expect(p1Ids.has(id)).toBe(false);
      }
      for (const id of p3Ids) {
        expect(p1Ids.has(id)).toBe(false);
        expect(p2Ids.has(id)).toBe(false);
      }
      expect(p1Ids.size + p2Ids.size + p3Ids.size).toBe(10);
    });
  });

  // T-P2-06 & T-P2-07: Rental Yield unit filters & Option A median formula
  describe('T-P2-06 & T-P2-07: Rental Yield Analytics & Option A Median Formula (GL-04, GL-07)', () => {
    it('applies unit size and bedroom filters consistently to rental transactions', async () => {
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, is_landed_aggregate)
        VALUES (300, 'RENTAL SUITES', 'ORCHARD ROAD', '09', 'CCR', 0)
      `);

      // Seed sales (500 sqft, 1000 sqft)
      await conn.run(`
        INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, property_type, raw_hash)
        VALUES
          (300, date('now', '-1 month'), 1000000, 2000, 21528, 500, 46.5, 1, 'Resale', 'Apartment', 'hs1'),
          (300, date('now', '-2 month'), 1050000, 2100, 22604, 500, 46.5, 1, 'Resale', 'Apartment', 'hs2'),
          (300, date('now', '-3 month'), 1100000, 2200, 23681, 500, 46.5, 1, 'Resale', 'Apartment', 'hs3')
      `);

      // Seed rentals: small (500 sqft, 1 bed), large (1200 sqft, 3 bed)
      await conn.run(`
        INSERT INTO rental_transactions (project_id, lease_date, rent_sgd, area_sqft, rent_psft, bedroom_count, raw_hash)
        VALUES
          (300, date('now', '-1 month'), 3000, 500, 6.0, 1, 'hr1'),
          (300, date('now', '-2 month'), 3200, 500, 6.4, 1, 'hr2'),
          (300, date('now', '-3 month'), 3100, 500, 6.2, 1, 'hr3'),
          (300, date('now', '-1 month'), 7000, 1200, 5.8, 3, 'hr4')
      `);

      await refreshProjectBenchmarks(conn);

      // Query with unitSizeMax = 600 (should exclude the 1200 sqft rental)
      const res = await getRentalYieldAnalytics({ projects: [300], unitSizeMax: 600 });
      expect(res.scatter.length).toBe(3);
      for (const pt of res.scatter) {
        expect(pt.rentSgd).toBeLessThan(4000);
      }
    });

    it('calculates headline gross yield using Option A (median of development-level gross yields)', async () => {
      // Create Project A (yield 4.0%) and Project B (yield 3.0%), and Project C (insufficient transactions < 3)
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, is_landed_aggregate)
        VALUES
          (310, 'PROJECT A RESIDENCES', 'A ROAD', '10', 'CCR', 0),
          (320, 'PROJECT B SUITES', 'B ROAD', '10', 'CCR', 0),
          (330, 'PROJECT C PARK', 'C ROAD', '10', 'CCR', 0)
      `);

      // Project A: 3 sales median $1,200,000 / $2000 psft, 3 rentals median $4,000/mo ($6.67 psft)
      // yield = 6.67 * 12 / 2000 = 4.00%
      await conn.run(`
        INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, raw_hash)
        VALUES
          (310, date('now', '-1 month'), 1200000, 2000, 21528, 600, 55.7, 1, 'Resale', 'hpa1'),
          (310, date('now', '-2 month'), 1200000, 2000, 21528, 600, 55.7, 1, 'Resale', 'hpa2'),
          (310, date('now', '-3 month'), 1200000, 2000, 21528, 600, 55.7, 1, 'Resale', 'hpa3')
      `);
      await conn.run(`
        INSERT INTO rental_transactions (project_id, lease_date, rent_sgd, area_sqft, rent_psft, bedroom_count, raw_hash)
        VALUES
          (310, date('now', '-1 month'), 4000, 600, 6.67, 2, 'hra1'),
          (310, date('now', '-2 month'), 4000, 600, 6.67, 2, 'hra2'),
          (310, date('now', '-3 month'), 4000, 600, 6.67, 2, 'hra3')
      `);

      // Project B: 3 sales median $2,000,000 / $2000 psft, 3 rentals median $5,000/mo ($5.00 psft)
      // yield = 5.00 * 12 / 2000 = 3.00%
      await conn.run(`
        INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, raw_hash)
        VALUES
          (320, date('now', '-1 month'), 2000000, 2000, 21528, 1000, 92.9, 1, 'Resale', 'hpb1'),
          (320, date('now', '-2 month'), 2000000, 2000, 21528, 1000, 92.9, 1, 'Resale', 'hpb2'),
          (320, date('now', '-3 month'), 2000000, 2000, 21528, 1000, 92.9, 1, 'Resale', 'hpb3')
      `);
      await conn.run(`
        INSERT INTO rental_transactions (project_id, lease_date, rent_sgd, area_sqft, rent_psft, bedroom_count, raw_hash)
        VALUES
          (320, date('now', '-1 month'), 5000, 1000, 5.0, 3, 'hrb1'),
          (320, date('now', '-2 month'), 5000, 1000, 5.0, 3, 'hrb2'),
          (320, date('now', '-3 month'), 5000, 1000, 5.0, 3, 'hrb3')
      `);

      // Project C: only 1 sale and 1 rental (should not have valid 24m median sale benchmark or qualifies)
      await conn.run(`
        INSERT INTO property_transactions (project_id, contract_date, price_sgd, psft_sgd, psqm_sgd, area_sqft, area_sqm, no_of_units, type_of_sale, raw_hash)
        VALUES (330, date('now', '-1 month'), 1000000, 2000, 21528, 500, 46.5, 1, 'Resale', 'hpc1')
      `);
      await conn.run(`
        INSERT INTO rental_transactions (project_id, lease_date, rent_sgd, area_sqft, rent_psft, bedroom_count, raw_hash)
        VALUES (330, date('now', '-1 month'), 10000, 500, 20.0, 1, 'hrc1')
      `);

      // Refresh project benchmarks so project valuations are populated
      await refreshProjectBenchmarks(conn);

      // Query rental yield analytics for District 10
      const analytics = await getRentalYieldAnalytics({ district: 10 });
      // Option A median of Project A (4.00%) and Project B (3.00%) is (4.00 + 3.00) / 2 = 3.50%
      expect(analytics.summary.grossYieldPct).toBe(3.5);
    });
  });

  // T-P2-08: Radius project matching without 200 truncation cap
  describe('T-P2-08: Radius Project Matching Without 200 Cap', () => {
    it('returns all matching projects beyond 200 without silent truncation', async () => {
      // Seed 250 projects in proximity to center (1.3000, 103.8000)
      const centerLat = 1.3000;
      const centerLng = 103.8000;

      for (let i = 1; i <= 250; i++) {
        const lat = centerLat + (i * 0.0001);
        const lng = centerLng + (i * 0.0001);
        await conn.run(`
          INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, latitude, longitude, geo_source, is_landed_aggregate)
          VALUES (${400 + i}, 'RADIUS PROJECT ${i}', 'RADIUS ROAD', '10', 'CCR', ${lat}, ${lng}, 'svy21', 0)
        `);
      }

      const matchedIds = await getMatchingProjectIdsByRadius({ lat: centerLat, lng: centerLng }, 10);
      expect(matchedIds.length).toBe(250);
      expect(matchedIds.length).toBeGreaterThan(200);
    });
  });

  // T-P2-09: Livability quarantine for district_centre
  describe('T-P2-09: Livability Quarantine for Approximate Coordinates (GL-08)', () => {
    it('suppresses livability calculation for district_centre projects and labels Location approximate', async () => {
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, latitude, longitude, geo_source, is_landed_aggregate)
        VALUES
          (501, 'EXACT CONDO', 'EXACT ROAD', '10', 'CCR', 1.300, 103.800, 'svy21', 0),
          (502, 'APPROXIMATE CONDO', 'APPROX ROAD', '10', 'CCR', 1.300, 103.800, 'district_centre', 0)
      `);

      // Seed an MRT amenity nearby
      await conn.run(`
        INSERT INTO amenities (category, name, latitude, longitude)
        VALUES ('mrt', 'ORCHARD MRT', 1.301, 103.801)
      `);

      // Run precomputeAllProjectLivability
      await precomputeAllProjectLivability(conn);

      const pExact = await conn.get('SELECT livability_score, livability_data FROM projects WHERE project_id = 501');
      const pApprox = await conn.get('SELECT livability_score, livability_data FROM projects WHERE project_id = 502');

      expect(pExact.livability_score).not.toBeNull();
      expect(pApprox.livability_score).toBeNull();
      expect(pApprox.livability_data).toBeNull();

      // Verify label helper
      expect(getGradeLabel(null, 'district_centre')).toBe('Location approximate');

      // Verify getAllProjects formats livability correctly
      const allProjects = await getAllProjects();
      const approxProj = allProjects.find(p => p.id === 502);
      expect(approxProj.livability.score).toBeNull();
      expect(approxProj.livability.label).toBe('Location approximate');
    });
  });

  // T-P2-10: Cross-process PRAGMA data_version cache invalidation
  describe('T-P2-10: Cache Invalidation via PRAGMA data_version (GL-04)', () => {
    it('detects database modification and refreshes cache', async () => {
      await conn.run(`
        INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, is_landed_aggregate)
        VALUES (600, 'CACHE PROJECT', 'CACHE ROAD', '10', 'CCR', 0)
      `);

      // Populate cache via getAllProjects
      const p1 = await getAllProjects();
      expect(p1.length).toBe(1);

      // Verify second call hits cache
      const pCached = await getAllProjects();
      expect(pCached).toStrictEqual(p1);

      // Open a second connection to the file database and commit a mutation
      const secondConn = createConnection(testDbPath);
      try {
        await secondConn.run(`
          INSERT INTO projects (project_id, project_name, street_name, postal_district, market_segment, is_landed_aggregate)
          VALUES (601, 'NEW CACHE PROJECT', 'CACHE ROAD 2', '10', 'CCR', 0)
        `);
      } finally {
        await secondConn.close();
      }

      // syncCacheWithDataVersion should detect the version change from the second connection
      const wasInvalidated = await syncCacheWithDataVersion(conn);
      expect(wasInvalidated).toBe(true);

      const pRefreshed = await getAllProjects();
      expect(pRefreshed.length).toBe(2);
      expect(pRefreshed).not.toBe(p1);
    });
  });
});
