import { describe, it, expect } from 'vitest';
import { svy21ToWgs84, haversineDistance } from '../utils/geo.js';
import {
  cleanPostalDistrict,
  resolveProjectDistrict,
  isLandedDevelopment
} from '../utils/projectUpsert.js';
import { generateRentalQuarters } from '../utils/dateUtils.js';
import { createConnection, withTransaction } from '../db.js';
import { generateTxHash, generateRentHash, importRealUraData, fetchWithRetry } from '../ingestion.js';
import { runMigrations } from '../migrations/index.js';

describe('Ingestion & Geospatial Integrity', () => {
  describe('svy21ToWgs84', () => {
    it('converts SVY21 projection origin to Singapore center coordinates (1.366667, 103.833333)', () => {
      const origin = svy21ToWgs84(38744.572, 28001.642);
      expect(origin).not.toBeNull();
      expect(origin.latitude).toBeCloseTo(1.366667, 4);
      expect(origin.longitude).toBeCloseTo(103.833333, 4);
    });

    it('converts Raffles Place benchmark coordinates accurately', () => {
      // Benchmark: Raffles Place MRT ~ (N: 29744, E: 30040) -> (~1.2838, ~103.8515)
      const res = svy21ToWgs84(29744, 30040);
      expect(res).not.toBeNull();
      expect(res.latitude).toBeCloseTo(1.2838, 2);
      expect(res.longitude).toBeCloseTo(103.8515, 2);
    });

    it('returns null for zero, NaN, or missing coordinate values', () => {
      expect(svy21ToWgs84(0, 0)).toBeNull();
      expect(svy21ToWgs84(null, 28000)).toBeNull();
      expect(svy21ToWgs84('invalid', 'coords')).toBeNull();
    });
  });

  describe('haversineDistance', () => {
    it('calculates 0 km distance between identical points', () => {
      expect(haversineDistance(1.3521, 103.8198, 1.3521, 103.8198)).toBe(0);
    });

    it('calculates approximately correct distance across Singapore (~20-25 km)', () => {
      // Jurong East (1.3329, 103.7436) to Changi Airport (1.3644, 103.9915)
      const dist = haversineDistance(1.3329, 103.7436, 1.3644, 103.9915);
      expect(dist).toBeGreaterThan(25);
      expect(dist).toBeLessThan(30);
    });

    it('returns Infinity for missing coordinates', () => {
      expect(haversineDistance(null, 103.8, 1.3, 103.8)).toBe(Infinity);
    });
  });

  describe('cleanPostalDistrict', () => {
    it('normalizes single and double-digit districts into zero-padded 2-digit strings', () => {
      expect(cleanPostalDistrict(9)).toBe('09');
      expect(cleanPostalDistrict('9')).toBe('09');
      expect(cleanPostalDistrict('09')).toBe('09');
      expect(cleanPostalDistrict('15')).toBe('15');
      expect(cleanPostalDistrict('28')).toBe('28');
    });

    it('strips "D" or "d" prefixes', () => {
      expect(cleanPostalDistrict('D09')).toBe('09');
      expect(cleanPostalDistrict('d9')).toBe('09');
      expect(cleanPostalDistrict('D15')).toBe('15');
    });

    it('rejects market segment abbreviations (CCR, RCR, OCR)', () => {
      expect(cleanPostalDistrict('CCR')).toBeNull();
      expect(cleanPostalDistrict('RCR')).toBeNull();
      expect(cleanPostalDistrict('OCR')).toBeNull();
    });

    it('rejects numbers outside the valid 1-28 postal district range', () => {
      expect(cleanPostalDistrict(0)).toBeNull();
      expect(cleanPostalDistrict(29)).toBeNull();
      expect(cleanPostalDistrict(99)).toBeNull();
      expect(cleanPostalDistrict('invalid')).toBeNull();
    });
  });

  describe('resolveProjectDistrict', () => {
    it('resolves district from 6-digit postal code', () => {
      // Postal 238801 has prefix 23 -> District 09 (Orchard / River Valley)
      expect(resolveProjectDistrict({ postalCode: '238801' })).toBe('09');
      // Postal 529538 has prefix 52 -> District 18 (Tampines / Pasir Ris)
      expect(resolveProjectDistrict({ postalCode: '529538' })).toBe('18');
    });

    it('falls back to raw project district when postal code is absent', () => {
      expect(resolveProjectDistrict({ district: '10' })).toBe('10');
      expect(resolveProjectDistrict({ district: 'D15' })).toBe('15');
    });

    it('ignores invalid district names like CCR', () => {
      expect(resolveProjectDistrict({ district: 'CCR' })).toBeNull();
    });
  });

  describe('isLandedDevelopment', () => {
    it('identifies landed housing developments', () => {
      expect(isLandedDevelopment('LANDED HOUSING DEVELOPMENT')).toBe(true);
      expect(isLandedDevelopment('DETACHED HOUSES AT MEYER ROAD')).toBe(true);
      expect(isLandedDevelopment('SEMI-DETACHED HOUSES')).toBe(true);
      expect(isLandedDevelopment('TERRACE HOUSES')).toBe(true);
      expect(isLandedDevelopment('GOOD CLASS BUNGALOW')).toBe(true);
    });

    it('does not classify standard condominiums or apartments as landed aggregates', () => {
      expect(isLandedDevelopment('THE SAIL @ MARINA BAY')).toBe(false);
      expect(isLandedDevelopment("D'LEEDON")).toBe(false);
      expect(isLandedDevelopment('TREASURE AT TAMPINES')).toBe(false);
      expect(isLandedDevelopment('CANBERRA RESIDENCES')).toBe(false);
      expect(isLandedDevelopment('NON-LANDED HOUSING DEVELOPMENT')).toBe(false);
    });
  });

  describe('generateRentalQuarters', () => {
    it('generates chronological URA quarter strings up to fixed date', () => {
      const fixedDate = new Date('2024-08-15T00:00:00Z');
      const quarters = generateRentalQuarters('24q1', fixedDate);
      expect(quarters).toEqual(['24q1', '24q2', '24q3']);
    });

    it('generates multi-year quarter sequence', () => {
      const fixedDate = new Date('2023-05-10T00:00:00Z');
      const quarters = generateRentalQuarters('22q3', fixedDate);
      expect(quarters).toEqual(['22q3', '22q4', '23q1', '23q2']);
    });
  });

  describe('withTransaction (Database Transaction Rollback)', () => {
    it('commits changes when function completes successfully', async () => {
      const conn = createConnection(':memory:');
      try {
        await conn.run(`CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT)`);
        await withTransaction(conn, async () => {
          await conn.run(`INSERT INTO test_items (name) VALUES (?)`, ['item 1']);
        });

        const rows = await conn.all(`SELECT * FROM test_items`);
        expect(rows.length).toBe(1);
        expect(rows[0].name).toBe('item 1');
      } finally {
        await conn.close();
      }
    });

    it('rolls back all changes on simulated error, leaving no dirty state', async () => {
      const conn = createConnection(':memory:');
      try {
        await conn.run(`CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT)`);
        await conn.run(`INSERT INTO test_items (name) VALUES (?)`, ['initial item']);

        await expect(
          withTransaction(conn, async () => {
            await conn.run(`INSERT INTO test_items (name) VALUES (?)`, ['failed item']);
            throw new Error('Simulated network / ingestion error');
          })
        ).rejects.toThrow('Simulated network / ingestion error');

        const rows = await conn.all(`SELECT * FROM test_items`);
        expect(rows.length).toBe(1);
        expect(rows[0].name).toBe('initial item');
      } finally {
        await conn.close();
      }
    });
  });

  describe('Deduplication & Transaction Hashing', () => {
    it('generates deterministic transaction hashes and distinguishes occurrence indices', () => {
      const hash1 = generateTxHash('TEST CONDO', '2024-01-01', 1500000, 85, '06 to 10', 1, 1, 'Condominium', '09');
      const hash1Dup = generateTxHash('TEST CONDO', '2024-01-01', 1500000, 85, '06 to 10', 1, 1, 'Condominium', '09');
      const hash2 = generateTxHash('TEST CONDO', '2024-01-01', 1500000, 85, '06 to 10', 2, 1, 'Condominium', '09');

      expect(hash1).toBe(hash1Dup);
      expect(hash1).not.toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates deterministic rental hashes and distinguishes occurrence indices', () => {
      const rHash1 = generateRentHash('TEST CONDO', '2024-01', 4500, 850, '2-Bedder', '800-900 sqft', 1, '09');
      const rHash1Dup = generateRentHash('TEST CONDO', '2024-01', 4500, 850, '2-Bedder', '800-900 sqft', 1, '09');
      const rHash2 = generateRentHash('TEST CONDO', '2024-01', 4500, 850, '2-Bedder', '800-900 sqft', 2, '09');

      expect(rHash1).toBe(rHash1Dup);
      expect(rHash1).not.toBe(rHash2);
      expect(rHash1).toMatch(/^[0-9a-f]{32}$/);
    });

    it('idempotently imports and replaces transactions on subsequent syncs without accumulating duplicates', async () => {
      const conn = createConnection(':memory:');
      try {
        await runMigrations(conn);

        const samplePayload = [
          {
            project: 'EMERALD GARDENS',
            street: 'EMERALD HILL ROAD',
            district: '09',
            x: 28000,
            y: 30000,
            transaction: [
              { contractDate: '0124', price: '2000000', area: '100', floorRange: '01 to 05', noOfUnits: '1', propertyType: 'Condominium' },
              { contractDate: '0124', price: '2000000', area: '100', floorRange: '01 to 05', noOfUnits: '1', propertyType: 'Condominium' } // genuine duplicate in same payload
            ],
            rental: [
              { leaseDate: '0124', rent: '5000', areaSqft: '1000-1100', noOfBedRoom: '2' }
            ]
          }
        ];

        // First import
        const res1 = await importRealUraData(samplePayload, conn);
        expect(res1.status).toBe('success');
        expect(res1.totalSalesIngested).toBe(2);
        expect(res1.totalRentalsIngested).toBe(1);

        const salesCount1 = await conn.get(`SELECT COUNT(*) as c FROM property_transactions`);
        const rentalCount1 = await conn.get(`SELECT COUNT(*) as c FROM rental_transactions`);
        expect(salesCount1.c).toBe(2);
        expect(rentalCount1.c).toBe(1);

        // Second import (simulating scheduled re-sync with replace-by-project)
        const res2 = await importRealUraData(samplePayload, conn);
        expect(res2.status).toBe('success');

        const salesCount2 = await conn.get(`SELECT COUNT(*) as c FROM property_transactions`);
        const rentalCount2 = await conn.get(`SELECT COUNT(*) as c FROM rental_transactions`);
        // Counts must remain identical — NO duplicate record accumulation
        expect(salesCount2.c).toBe(2);
        expect(rentalCount2.c).toBe(1);
      } finally {
        await conn.close();
      }
    });
  });

  describe('fetchWithRetry (ING-01 Resilience & Backoff)', () => {
    it('returns data directly when request succeeds on first attempt', async () => {
      const mockClient = {
        get: async () => ({ status: 200, data: { Status: 'Success' } })
      };
      const res = await fetchWithRetry('https://api.example.com', {}, 3, mockClient);
      expect(res.data.Status).toBe('Success');
    });

    it('retries on transient 503 error and succeeds on subsequent attempt', async () => {
      let callCount = 0;
      const mockClient = {
        get: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('Service Unavailable');
            err.response = { status: 503 };
            throw err;
          }
          return { status: 200, data: { Status: 'Success', attempt: callCount } };
        }
      };

      const res = await fetchWithRetry('https://api.example.com', {}, 3, mockClient);
      expect(callCount).toBe(2);
      expect(res.data.attempt).toBe(2);
    });

    it('fails immediately without retrying on non-retryable 401 client error', async () => {
      let callCount = 0;
      const mockClient = {
        get: async () => {
          callCount++;
          const err = new Error('Unauthorized');
          err.response = { status: 401 };
          throw err;
        }
      };

      await expect(fetchWithRetry('https://api.example.com', {}, 3, mockClient)).rejects.toThrow('Unauthorized');
      expect(callCount).toBe(1);
    });
  });
});
