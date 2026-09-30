import { dbAll, dbRun, dbGet, createConnection, withTransaction } from './db.js';
import { seedAmenitiesData } from './amenitiesData.js';

export const AMENITIES_SEED_VERSION = 1;

// Haversine distance in kilometers
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// In-memory caches for startup pre-calculation (Phase 1.1)
let parsedAmenitiesCache = null;
const defaultLivabilityCache = new Map();
const trimmedLivabilityCache = new Map();

export async function getParsedAmenities() {
  if (parsedAmenitiesCache) return parsedAmenitiesCache;
  const rows = await dbAll(`SELECT amenity_id, category, name, latitude, longitude, details FROM amenities`);
  parsedAmenitiesCache = rows.map(a => {
    let extra = {};
    try {
      extra = typeof a.details === 'string' ? JSON.parse(a.details || '{}') : (a.details || {});
    } catch (e) {
      extra = {};
    }
    return {
      amenity_id: a.amenity_id,
      category: a.category,
      name: a.name,
      latitude: a.latitude,
      longitude: a.longitude,
      details: extra
    };
  });
  return parsedAmenitiesCache;
}

// 1. Seed or synchronize Amenities Table
export async function seedAmenities(forceRefresh = false) {
  const conn = createConnection();
  try {
    const versionRow = await conn.get(`SELECT version FROM seed_versions WHERE name = 'amenities'`);
    if (!forceRefresh && versionRow && versionRow.version >= AMENITIES_SEED_VERSION) {
      const countRow = await conn.get(`SELECT COUNT(*) as count FROM amenities WHERE source = 'seed'`);
      return countRow ? countRow.count : seedAmenitiesData.length;
    }

    console.log(`Synchronizing ${seedAmenitiesData.length} authoritative Singapore amenities (v${AMENITIES_SEED_VERSION}) into database...`);
    await withTransaction(conn, async () => {
      // Step 2.6: Delete only source = 'seed' rows; preserve OSM greenery
      await conn.run(`DELETE FROM amenities WHERE source = 'seed' OR source IS NULL`);
      for (const item of seedAmenitiesData) {
        await conn.run(
          `INSERT INTO amenities (category, name, latitude, longitude, details, source) VALUES (?, ?, ?, ?, ?, ?)`,
          [item.category, item.name, item.latitude, item.longitude, typeof item.details === 'string' ? item.details : JSON.stringify(item.details || {}), 'seed']
        );
      }

      await conn.run(
        `INSERT INTO seed_versions (name, version, updated_at) VALUES ('amenities', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET version = excluded.version, updated_at = CURRENT_TIMESTAMP`,
        [AMENITIES_SEED_VERSION]
      );
    });

    console.log(`Successfully seeded ${seedAmenitiesData.length} amenities into database.`);
    invalidateLivabilityCache();
    return seedAmenitiesData.length;
  } finally {
    await conn.close();
  }
}

// Default Lifestyle Profile Weights (Balanced)
export const DEFAULT_WEIGHTS = {
  mrt: 0.30,
  school: 0.25,
  hawker: 0.20,
  supermarket: 0.15,
  park: 0.10
};

// Lifestyle Profile Presets
export const LIFESTYLE_PROFILES = {
  balanced: { name: 'Balanced', description: 'Equal mix of all daily conveniences', weights: { mrt: 0.30, school: 0.25, hawker: 0.20, supermarket: 0.15, park: 0.10 } },
  family: { name: 'Family & Schools', description: 'Prioritizes P1 school proximity and parks', weights: { mrt: 0.20, school: 0.45, hawker: 0.15, supermarket: 0.10, park: 0.10 } },
  commuter: { name: 'Urban Commuter', description: 'Maximum weight on MRT station proximity', weights: { mrt: 0.50, school: 0.10, hawker: 0.20, supermarket: 0.15, park: 0.05 } },
  foodie: { name: 'Foodie / Hawker', description: 'Focuses on hawker centres & dining options', weights: { mrt: 0.20, school: 0.10, hawker: 0.50, supermarket: 0.15, park: 0.05 } },
  nature: { name: 'Nature & Wellness', description: 'Emphasizes parks, reservoirs & greenery', weights: { mrt: 0.15, school: 0.15, hawker: 0.15, supermarket: 0.15, park: 0.40 } }
};

// 2. Compute Livability Score & Amenity Details for a location
export async function calculateLivabilityScore(lat, lng, customWeights = null, preloadedAmenities = null, options = { trimmed: false }) {
  if (!lat || !lng) {
    return {
      score: null,
      label: 'Location unavailable',
      color: '#94A3B8',
      subScores: { mrt: null, school: null, hawker: null, supermarket: null, park: null },
      ...(options.trimmed ? {} : { nearest: {} })
    };
  }

  const allAmenities = preloadedAmenities || await getParsedAmenities();

  const weights = customWeights ? normalizeWeights(customWeights) : DEFAULT_WEIGHTS;

  // Group by category and sort by distance
  const categorized = {
    mrt: [],
    school: [],
    hawker: [],
    supermarket: [],
    park: []
  };

  allAmenities.forEach(a => {
    const distKm = haversineKm(lat, lng, a.latitude, a.longitude);
    const distMeters = Math.round(distKm * 1000);
    const walkTimeMins = Math.round(distMeters / 80); // ~80m/min walking speed

    if (categorized[a.category]) {
      const extra = a.details || {};

      categorized[a.category].push({
        id: a.amenity_id,
        name: a.name,
        lat: a.latitude,
        lng: a.longitude,
        distMeters,
        walkTimeMins,
        details: extra
      });
    }
  });

  // Sort each category by nearest
  Object.keys(categorized).forEach(cat => {
    categorized[cat].sort((a, b) => a.distMeters - b.distMeters);
  });

  // Calculate sub-scores per category (0 - 100)
  // 1. MRT Score
  const nearestMrt = categorized.mrt[0];
  let mrtScore = 15;
  if (nearestMrt) {
    if (nearestMrt.distMeters <= 400) mrtScore = 100;
    else if (nearestMrt.distMeters <= 800) mrtScore = 75;
    else if (nearestMrt.distMeters <= 1200) mrtScore = 40;
    else mrtScore = 15;

    if (nearestMrt.details && nearestMrt.details.interchange) {
      mrtScore = Math.min(100, mrtScore + 5);
    }
  }

  // 2. Primary Schools Score (MOE P1 Zone: <1km priority)
  const schoolsWithin1km = categorized.school.filter(s => s.distMeters <= 1000);
  const nearestSchool = categorized.school[0];
  let schoolScore = 20;
  if (schoolsWithin1km.length >= 2) schoolScore = 100;
  else if (schoolsWithin1km.length === 1) schoolScore = 80;
  else if (nearestSchool && nearestSchool.distMeters <= 2000) schoolScore = 50;
  else schoolScore = 20;

  // 3. Hawker Score
  const nearestHawker = categorized.hawker[0];
  let hawkerScore = 10;
  if (nearestHawker) {
    if (nearestHawker.distMeters <= 400) hawkerScore = 100;
    else if (nearestHawker.distMeters <= 800) hawkerScore = 75;
    else if (nearestHawker.distMeters <= 1200) hawkerScore = 40;
    else hawkerScore = 10;
  }

  // 4. Supermarket & Mall Score
  const nearestSupermarket = categorized.supermarket[0];
  let supermarketScore = 30;
  if (nearestSupermarket) {
    if (nearestSupermarket.distMeters <= 400) supermarketScore = 100;
    else if (nearestSupermarket.distMeters <= 800) supermarketScore = 70;
    else supermarketScore = 30;
  }

  // 5. Park & Greenery Score
  const nearestPark = categorized.park[0];
  let parkScore = 20;
  if (nearestPark) {
    if (nearestPark.distMeters <= 500) parkScore = 100;
    else if (nearestPark.distMeters <= 1000) parkScore = 75;
    else if (nearestPark.distMeters <= 1500) parkScore = 50;
    else parkScore = 20;
  }

  const subScores = {
    mrt: mrtScore,
    school: schoolScore,
    hawker: hawkerScore,
    supermarket: supermarketScore,
    park: parkScore
  };

  // Compute composite weighted score
  const totalScore = Math.round(
    subScores.mrt * weights.mrt +
    subScores.school * weights.school +
    subScores.hawker * weights.hawker +
    subScores.supermarket * weights.supermarket +
    subScores.park * weights.park
  );

  // Determine Grade Label & Color
  let label = 'Somewhat Walkable';
  let color = '#D97706'; // Amber

  if (totalScore >= 80) {
    label = 'Walker\'s Paradise';
    color = '#10B981'; // Emerald
  } else if (totalScore >= 65) {
    label = 'Highly Walkable';
    color = '#0EA5E9'; // Teal/Blue
  } else if (totalScore >= 50) {
    label = 'Somewhat Walkable';
    color = '#F59E0B'; // Amber
  } else {
    label = 'Car Dependent';
    color = '#6B7280'; // Grey
  }

  if (options.trimmed) {
    return {
      score: totalScore,
      label,
      color,
      subScores
    };
  }

  return {
    score: totalScore,
    label,
    color,
    subScores,
    weights,
    nearest: {
      mrt: categorized.mrt.slice(0, 3),
      school: categorized.school.slice(0, 3),
      hawker: categorized.hawker.slice(0, 3),
      supermarket: categorized.supermarket.slice(0, 3),
      park: categorized.park.slice(0, 3)
    }
  };
}

// Invalidate in-memory caches
export function invalidateLivabilityCache() {
  parsedAmenitiesCache = null;
  defaultLivabilityCache.clear();
  trimmedLivabilityCache.clear();
}

// Initialize in-memory cache for all developments (called on server start)
export async function initLivabilityCache() {
  invalidateLivabilityCache();
  const amenities = await getParsedAmenities();
  const projects = await dbAll(`SELECT project_id, latitude, longitude FROM projects WHERE latitude IS NOT NULL AND longitude IS NOT NULL`);

  for (const p of projects) {
    const full = await calculateLivabilityScore(p.latitude, p.longitude, null, amenities, { trimmed: false });
    defaultLivabilityCache.set(p.project_id, full);
    trimmedLivabilityCache.set(p.project_id, {
      score: full.score,
      label: full.label,
      color: full.color,
      subScores: full.subScores
    });
  }
}

// Fast access helper using in-memory cache
export async function getProjectLivability(projectId, lat, lng, customWeights = null, { trimmed = false } = {}) {
  if (!customWeights && projectId) {
    if (trimmed && trimmedLivabilityCache.has(projectId)) {
      return trimmedLivabilityCache.get(projectId);
    }
    if (!trimmed && defaultLivabilityCache.has(projectId)) {
      return defaultLivabilityCache.get(projectId);
    }
  }

  const res = await calculateLivabilityScore(lat, lng, customWeights, null, { trimmed });
  if (!customWeights && projectId) {
    if (trimmed) {
      trimmedLivabilityCache.set(projectId, res);
    } else {
      defaultLivabilityCache.set(projectId, res);
    }
  }
  return res;
}

function normalizeWeights(raw) {
  const sum = (raw.mrt || 0) + (raw.school || 0) + (raw.hawker || 0) + (raw.supermarket || 0) + (raw.park || 0);
  if (sum === 0) return DEFAULT_WEIGHTS;
  return {
    mrt: (raw.mrt || 0) / sum,
    school: (raw.school || 0) / sum,
    hawker: (raw.hawker || 0) / sum,
    supermarket: (raw.supermarket || 0) / sum,
    park: (raw.park || 0) / sum
  };
}
