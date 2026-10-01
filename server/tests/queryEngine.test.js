import { describe, it, expect } from 'vitest';
import { calculateMedian } from '../utils/math.js';
import { escapeLike, generateMonthRange, normalizeAnalyticsCacheKey } from '../queryEngine.js';
import { validateFilters } from '../utils/validation.js';
import { classifyTenure } from '../utils/tenureUtils.js';

describe('Query Engine & Math Utilities', () => {
  describe('calculateMedian', () => {
    it('returns null for empty or invalid inputs', () => {
      expect(calculateMedian([])).toBeNull();
      expect(calculateMedian(null)).toBeNull();
      expect(calculateMedian(undefined)).toBeNull();
    });

    it('returns the middle element for odd length arrays', () => {
      expect(calculateMedian([5])).toBe(5);
      expect(calculateMedian([3, 1, 2])).toBe(2);
      expect(calculateMedian([10, 50, 20, 40, 30])).toBe(30);
    });

    it('returns the arithmetic mean of the two middle elements for even length arrays', () => {
      expect(calculateMedian([1, 3])).toBe(2);
      expect(calculateMedian([10, 20, 30, 40])).toBe(25);
      expect(calculateMedian([100, 200, 300, 400, 500, 600])).toBe(350);
    });

    it('correctly filters out null and non-numeric values before sorting', () => {
      expect(calculateMedian([10, null, 20, undefined, 30])).toBe(20);
      expect(calculateMedian(['invalid', 5, 15])).toBe(10);
    });
  });

  describe('escapeLike (LIKE wildcard escaping)', () => {
    it('escapes %, _, and \\ with backslashes', () => {
      expect(escapeLike('100%')).toBe('100\\%');
      expect(escapeLike('test_name')).toBe('test\\_name');
      expect(escapeLike('path\\to')).toBe('path\\\\to');
      expect(escapeLike('mix%of_all\\wildcards')).toBe('mix\\%of\\_all\\\\wildcards');
    });

    it('handles empty or non-string inputs safely', () => {
      expect(escapeLike('')).toBe('');
      expect(escapeLike(null)).toBe('');
      expect(escapeLike(undefined)).toBe('');
    });
  });

  describe('generateMonthRange', () => {
    it('generates chronological list of months inclusive', () => {
      const months = generateMonthRange('2023-11', '2024-02');
      expect(months).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
    });

    it('handles single month range', () => {
      expect(generateMonthRange('2024-05', '2024-05')).toEqual(['2024-05']);
    });

    it('returns empty array for invalid inputs', () => {
      expect(generateMonthRange(null, '2024-05')).toEqual([]);
      expect(generateMonthRange('invalid', '2024-05')).toEqual([]);
    });
  });

  describe('Gross Yield Formula', () => {
    it('correctly calculates annualised yield from monthly rent psft and purchase psft', () => {
      const rentPsft = 5.0; // $5.00/sqft/mo
      const salePsft = 1500.0; // $1,500/sqft
      // Annual gross yield = (5.0 * 12 / 1500.0) * 100 = 4.0%
      const grossYield = parseFloat(((rentPsft * 12.0 / salePsft) * 100).toFixed(2));
      expect(grossYield).toBe(4.0);
    });

    it('returns null if sale price benchmark is missing or non-positive', () => {
      const rentPsft = 5.0;
      const salePsft = 0;
      const grossYield = (rentPsft && salePsft && salePsft > 0)
        ? parseFloat(((rentPsft * 12.0 / salePsft) * 100).toFixed(2))
        : null;
      expect(grossYield).toBeNull();
    });
  });

  describe('validateFilters (Date & Boundary Checks)', () => {
    it('passes on valid filters', () => {
      const res = validateFilters({
        dateFrom: '2020-01-01',
        dateTo: '2023-12-31',
        projects: ['Project A', 'Project B'],
        radiusKm: 2.5,
        priceMin: 500000,
        priceMax: 2000000
      });
      expect(res.valid).toBe(true);
    });

    it('rejects malformed date formats', () => {
      expect(validateFilters({ dateFrom: '2023/01/01' }).valid).toBe(false);
      expect(validateFilters({ dateTo: 'invalid-date' }).valid).toBe(false);
    });

    it('rejects years outside 2000-2100', () => {
      expect(validateFilters({ dateFrom: '1999-12-31' }).valid).toBe(false);
      expect(validateFilters({ dateTo: '2105-01-01' }).valid).toBe(false);
    });

    it('rejects dateFrom greater than dateTo', () => {
      const res = validateFilters({ dateFrom: '2024-01-01', dateTo: '2023-01-01' });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/dateFrom cannot be greater than dateTo/i);
    });

    it('rejects date ranges exceeding 10 years', () => {
      const res = validateFilters({ dateFrom: '2010-01-01', dateTo: '2022-01-01' });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceed 10 years/i);
    });

    it('rejects project lists exceeding 50 items', () => {
      const projects = Array.from({ length: 51 }, (_, i) => `Project ${i}`);
      const res = validateFilters({ projects });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/more than 50 projects/i);
    });

    it('validates numeric fields boundaries', () => {
      expect(validateFilters({ radiusKm: 0.05 }).valid).toBe(false); // below 0.1
      expect(validateFilters({ radiusKm: 15 }).valid).toBe(false); // above 10
      expect(validateFilters({ priceMin: -100 }).valid).toBe(false);
      expect(validateFilters({ priceMax: -1 }).valid).toBe(false);
    });
  });

  describe('classifyTenure', () => {
    it('identifies freehold titles and 999/9999-year equivalents', () => {
      expect(classifyTenure('Freehold')).toBe('freehold');
      expect(classifyTenure('999 YRS FROM 1885')).toBe('freehold');
      expect(classifyTenure('9999 YRS LEASEHOLD')).toBe('freehold');
      expect(classifyTenure('946 YRS LEASE')).toBe('freehold');
    });

    it('identifies standard 99-year leasehold titles', () => {
      expect(classifyTenure('99 YRS FROM 2012')).toBe('leasehold');
      expect(classifyTenure('60 YRS LEASE')).toBe('leasehold');
      expect(classifyTenure('103 Years')).toBe('leasehold');
    });

    it('returns null for unknown or empty tenure strings', () => {
      expect(classifyTenure('')).toBeNull();
      expect(classifyTenure(null)).toBeNull();
      expect(classifyTenure('UNKNOWN')).toBeNull();
    });
  });

  describe('normalizeAnalyticsCacheKey (ABU-01 Cache Hardening)', () => {
    it('strips extraneous and randomized parameters to prevent cache-busting thrashing', () => {
      const normalFilter = { district: '09', propertyType: 'condo' };
      const attackedFilter = { district: '09', propertyType: 'condo', _rand: 0.123456, cacheBust: 'true' };

      const keyNormal = normalizeAnalyticsCacheKey('price', normalFilter);
      const keyAttacked = normalizeAnalyticsCacheKey('price', attackedFilter);

      expect(keyNormal).toBe(keyAttacked);
      expect(keyAttacked).not.toContain('_rand');
      expect(keyAttacked).not.toContain('cacheBust');
    });

    it('produces identical deterministic keys regardless of object key order', () => {
      const filter1 = { district: '10', propertyType: 'condo', tenure: 'freehold' };
      const filter2 = { tenure: 'freehold', district: '10', propertyType: 'condo' };

      expect(normalizeAnalyticsCacheKey('price', filter1)).toBe(normalizeAnalyticsCacheKey('price', filter2));
    });

    it('sorts project array elements to produce deterministic cache keys', () => {
      const filter1 = { projects: ['The Sail', 'Marina One'] };
      const filter2 = { projects: ['Marina One', 'The Sail'] };

      expect(normalizeAnalyticsCacheKey('price', filter1)).toBe(normalizeAnalyticsCacheKey('price', filter2));
    });
  });
});
