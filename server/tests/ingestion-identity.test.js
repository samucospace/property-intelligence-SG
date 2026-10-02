import { describe, it, expect } from 'vitest';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { importRealUraData, generateTxHash, generateRentHash } from '../ingestion.js';

describe('Ingestion Identity & Deduplication Integrity (GL-04)', () => {
  it('incorporates street name into transaction hashes to prevent collisions across same-name developments', () => {
    const hashAlpha = generateTxHash('ROYAL RESIDENCES', '2026-01-01', 1500000, 100, '05 to 10', 1, 1, 'Condo', '09', 'ALPHA ROAD');
    const hashBeta = generateTxHash('ROYAL RESIDENCES', '2026-01-01', 1500000, 100, '05 to 10', 1, 1, 'Condo', '09', 'BETA ROAD');

    expect(hashAlpha).not.toBe(hashBeta);

    const rentHashAlpha = generateRentHash('ROYAL RESIDENCES', '2026-01', 4500, 1000, '2', '1000-1100', 1, '09', 'ALPHA ROAD');
    const rentHashBeta = generateRentHash('ROYAL RESIDENCES', '2026-01', 4500, 1000, '2', '1000-1100', 1, '09', 'BETA ROAD');

    expect(rentHashAlpha).not.toBe(rentHashBeta);
  });

  it('preserves transactions for two same-name developments on different streets (G1-3)', async () => {
    const conn = createConnection(':memory:');
    try {
      await runMigrations(conn);

      const tx = {
        contractDate: '0926',
        area: '100',
        price: '1000000',
        floorRange: '01 to 05',
        noOfUnits: '1',
        propertyType: 'Condominium',
        district: '09',
        tenure: '99 years'
      };

      const payload = [
        { project: 'AUDIT SAME NAME', street: 'AUDIT ALPHA ROAD', marketSegment: 'CCR', transaction: [tx] },
        { project: 'AUDIT SAME NAME', street: 'AUDIT BETA ROAD', marketSegment: 'CCR', transaction: [tx] }
      ];

      await importRealUraData(payload, conn);

      const rows = await conn.all(`
        SELECT p.street_name, COUNT(t.transaction_id) as sales
        FROM projects p
        LEFT JOIN property_transactions t ON t.project_id = p.project_id
        GROUP BY p.project_id
        ORDER BY p.street_name
      `);

      expect(rows).toHaveLength(2);
      expect(rows[0].street_name).toBe('AUDIT ALPHA ROAD');
      expect(rows[0].sales).toBe(1);
      expect(rows[1].street_name).toBe('AUDIT BETA ROAD');
      expect(rows[1].sales).toBe(1);
    } finally {
      await conn.close();
    }
  });

  it('scopes updates so incoming partial batches do NOT wipe historical out-of-scope transactions (G1-4)', async () => {
    const conn = createConnection(':memory:');
    try {
      await runMigrations(conn);

      // 1. Initial import with historical 2024 transactions
      const historicalBatch = [
        {
          project: 'HORIZON TOWERS',
          street: 'LEONIE HILL ROAD',
          district: '09',
          transaction: [
            { contractDate: '0124', price: '2500000', area: '120', floorRange: '10 to 15', noOfUnits: '1', propertyType: 'Condominium' },
            { contractDate: '0624', price: '2600000', area: '120', floorRange: '10 to 15', noOfUnits: '1', propertyType: 'Condominium' }
          ]
        }
      ];
      await importRealUraData(historicalBatch, conn);

      const countBefore = await conn.get(`SELECT COUNT(*) as c FROM property_transactions`);
      expect(countBefore.c).toBe(2);

      // 2. Incremental batch arriving with ONLY 2026 transactions for the same project
      const incrementalBatch = [
        {
          project: 'HORIZON TOWERS',
          street: 'LEONIE HILL ROAD',
          district: '09',
          transaction: [
            { contractDate: '0926', price: '3000000', area: '120', floorRange: '15 to 20', noOfUnits: '1', propertyType: 'Condominium' }
          ]
        }
      ];
      await importRealUraData(incrementalBatch, conn);

      // Total count should now be 3 (2 historical + 1 new 2026 caveat)
      const countAfter = await conn.get(`SELECT COUNT(*) as c FROM property_transactions`);
      expect(countAfter.c).toBe(3);

      const dates = await conn.all(`SELECT contract_date FROM property_transactions ORDER BY contract_date ASC`);
      const dateStrings = dates.map(d => d.contract_date);
      expect(dateStrings).toContain('2024-01-01');
      expect(dateStrings).toContain('2024-06-01');
      expect(dateStrings).toContain('2026-09-01');
    } finally {
      await conn.close();
    }
  });
});
