import { describe, it, expect } from 'vitest';
import { normalizeStreetName, isLandedDevelopment } from '../utils/streetUtils.js';

describe('streetUtils (Phase 2 GL-05)', () => {
  describe('normalizeStreetName', () => {
    it('standardizes Saint prefix with dot or space to SAINT', () => {
      expect(normalizeStreetName("ST. MICHAEL'S ROAD")).toBe("SAINT MICHAEL'S ROAD");
      expect(normalizeStreetName("ST. THOMAS WALK")).toBe("SAINT THOMAS WALK");
      expect(normalizeStreetName("ST. PATRICK'S ROAD")).toBe("SAINT PATRICK'S ROAD");
      expect(normalizeStreetName("ST MICHAEL'S ROAD")).toBe("SAINT MICHAEL'S ROAD");
      expect(normalizeStreetName("ST THOMAS WALK")).toBe("SAINT THOMAS WALK");
    });

    it('corrects mistakenly expanded STREET. back to SAINT', () => {
      expect(normalizeStreetName("STREET. MICHAEL'S ROAD")).toBe("SAINT MICHAEL'S ROAD");
      expect(normalizeStreetName("STREET. THOMAS WALK")).toBe("SAINT THOMAS WALK");
      expect(normalizeStreetName("STREET. PATRICK'S ROAD")).toBe("SAINT PATRICK'S ROAD");
      expect(normalizeStreetName("STREET. ANNE'S WOOD")).toBe("SAINT ANNE'S WOOD");
    });

    it('preserves and standardizes legitimate STREET suffixes', () => {
      expect(normalizeStreetName("CHURCH ST")).toBe("CHURCH STREET");
      expect(normalizeStreetName("CHURCH STREET")).toBe("CHURCH STREET");
      expect(normalizeStreetName("BISHAN ST 21")).toBe("BISHAN STREET 21");
      expect(normalizeStreetName("CAMPBELL LANE/CLIVE ST")).toBe("CAMPBELL LANE/CLIVE STREET");
      expect(normalizeStreetName("EAST COAST PARK FIRST ST")).toBe("EAST COAST PARK FIRST STREET");
    });

    it('is idempotent across repeated calls', () => {
      const original = "ST. THOMAS WALK";
      const normalizedOnce = normalizeStreetName(original);
      const normalizedTwice = normalizeStreetName(normalizedOnce);
      expect(normalizedOnce).toBe("SAINT THOMAS WALK");
      expect(normalizedTwice).toBe("SAINT THOMAS WALK");
    });
  });

  describe('isLandedDevelopment', () => {
    it('guards non-landed residential developments from being flagged as landed aggregates', () => {
      expect(isLandedDevelopment("NON-LANDED HOUSING DEVELOPMENT")).toBe(false);
      expect(isLandedDevelopment("NON-LANDED RESIDENTIAL", "Apartment")).toBe(false);
    });

    it('correctly flags genuine landed housing developments', () => {
      expect(isLandedDevelopment("LANDED HOUSING DEVELOPMENT")).toBe(true);
      expect(isLandedDevelopment("LANDED RESIDENTIAL ESTATE")).toBe(true);
      expect(isLandedDevelopment("CORONATION ROAD WEST", "Semi-detached")).toBe(true);
      expect(isLandedDevelopment("BELMONT ROAD", "Detached")).toBe(true);
    });

    it('does not flag standard condominium developments as landed', () => {
      expect(isLandedDevelopment("THE SAIL @ MARINA BAY", "Condominium")).toBe(false);
      expect(isLandedDevelopment("D'LEEDON", "Apartment")).toBe(false);
    });
  });
});
