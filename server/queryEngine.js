import { dbAll, dbGet } from './db.js';
import { calculateLivabilityScore, getProjectLivability } from './livabilityEngine.js';
import { getDefaultDateRange } from './utils/dateUtils.js';

// Haversine distance in kilometers
function haversineDistance(lat1, lon1, lat2, lon2) {
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

// Generate an array of YYYY-MM strings for every month between startMonth and endMonth inclusive
function generateMonthRange(startMonth, endMonth) {
  const months = [];
  if (!startMonth || !endMonth) return months;

  let [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);

  if (isNaN(startYear) || isNaN(startM) || isNaN(endYear) || isNaN(endM)) {
    return months;
  }

  while (startYear < endYear || (startYear === endYear && startM <= endM)) {
    months.push(`${startYear}-${String(startM).padStart(2, '0')}`);
    startM++;
    if (startM > 12) {
      startM = 1;
      startYear++;
    }
  }
  return months;
}

// In-memory project sale valuations cache for instantaneous rental yield calculations
let saleValuationsCache = new Map();
const analyticsQueryCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export async function initSaleValuationsCache() {
  const rows = await dbAll(`
    WITH ranked AS (
      SELECT project_id, price_sgd, psft_sgd,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY psft_sgd) AS rn_psft,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY price_sgd) AS rn_price,
             COUNT(*) OVER (PARTITION BY project_id) AS cnt
      FROM property_transactions
      WHERE no_of_units = 1 OR no_of_units IS NULL
    )
    SELECT project_id,
           AVG(psft_sgd) as median_psft,
           AVG(price_sgd) as median_price
    FROM ranked
    WHERE rn_psft IN ((cnt + 1)/2, (cnt + 2)/2) OR rn_price IN ((cnt + 1)/2, (cnt + 2)/2)
    GROUP BY project_id
  `);
  saleValuationsCache.clear();
  for (const r of rows) {
    saleValuationsCache.set(r.project_id, {
      medianPrice: Math.round(r.median_price || 0),
      medianPsft: Math.round(r.median_psft || 1600)
    });
  }
}

export function invalidateSaleValuationsCache() {
  saleValuationsCache.clear();
  analyticsQueryCache.clear();
}

export function invalidateAnalyticsCache() {
  analyticsQueryCache.clear();
}

export function getProjectSaleValuation(projId) {
  const data = saleValuationsCache.get(projId);
  if (data && data.medianPrice && data.medianPsft) {
    return data;
  }
  // Return nulls if no qualifying recent sales exist (no fallback defaults)
  return { medianPrice: null, medianPsft: null };
}

// 1. Search Autocomplete Suggestions
export async function getSearchSuggestions(q) {
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return { projects: [], streets: [], districts: [], planningAreas: [] };
  }

  const term = `%${q.trim().toUpperCase()}%`;

  const projects = await dbAll(
    `SELECT project_id as id, project_name as name, street_name as street, postal_district as district, planning_area as planningArea
     FROM projects
     WHERE UPPER(project_name) LIKE ? OR UPPER(street_name) LIKE ?
     LIMIT 10`,
    [term, term]
  );

  const streetsRows = await dbAll(
    `SELECT DISTINCT street_name FROM projects WHERE UPPER(street_name) LIKE ? LIMIT 5`,
    [term]
  );

  const districtRows = await dbAll(
    `SELECT DISTINCT postal_district FROM projects WHERE postal_district LIKE ? LIMIT 5`,
    [`%${q.trim()}%`]
  );

  const planningRows = await dbAll(
    `SELECT DISTINCT planning_area FROM projects WHERE UPPER(planning_area) LIKE ? LIMIT 5`,
    [term]
  );

  return {
    projects,
    streets: streetsRows.map(r => r.street_name),
    districts: districtRows.map(r => r.postal_district),
    planningAreas: planningRows.map(r => r.planning_area).filter(Boolean)
  };
}

// 2. Price Analytics & Filter Query Engine
export async function getPriceAnalytics(filters = {}) {
  const cacheKey = 'price:' + JSON.stringify(filters);
  const cached = analyticsQueryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const defaultDates = getDefaultDateRange(5);
  const {
    projects = [],
    street = null,
    district = null,
    planningArea = null,
    radiusKm = null,
    centerCoords = null,
    dateFrom = defaultDates.dateFrom,
    dateTo = defaultDates.dateTo,
    unitSizeMin = 0,
    unitSizeMax = 10000,
    unitType = 'sqft',
    priceMin = null,
    priceMax = null,
    tenure = 'all',
    lifestyleWeights = null,
    page = 1,
    limit = 100
  } = filters;

  const effectiveDateFrom = dateFrom || defaultDates.dateFrom;
  const effectiveDateTo = dateTo || defaultDates.dateTo;

  // Calculate size in SQM for SQL filtering (stored in SQM)
  const sizeMinSqm = unitType === 'sqft' ? unitSizeMin / 10.7639 : unitSizeMin;
  const sizeMaxSqm = unitType === 'sqft' ? unitSizeMax / 10.7639 : unitSizeMax;

  let whereClauses = ['t.contract_date >= ? AND t.contract_date <= ?', 't.area_sqm >= ? AND t.area_sqm <= ?'];
  let params = [effectiveDateFrom, effectiveDateTo, sizeMinSqm, sizeMaxSqm];

  // Specific project IDs or names
  if (Array.isArray(projects) && projects.length > 0) {
    const isIdList = projects.every(p => typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p.trim())));
    const placeholders = projects.map(() => '?').join(',');
    if (isIdList) {
      whereClauses.push(`p.project_id IN (${placeholders})`);
      params.push(...projects.map(Number));
    } else {
      whereClauses.push(`UPPER(p.project_name) IN (${placeholders})`);
      params.push(...projects.map(p => String(p).toUpperCase()));
    }
  }

  // Street filter
  if (street) {
    whereClauses.push(`UPPER(p.street_name) = UPPER(?)`);
    params.push(street);
  }

  // District filter
  if (district) {
    whereClauses.push(`p.postal_district = ?`);
    params.push(String(district).padStart(2, '0'));
  }

  // Planning area filter
  if (planningArea) {
    whereClauses.push(`UPPER(p.planning_area) = UPPER(?)`);
    params.push(planningArea);
  }

  // Min and Max Price filters
  if (priceMin != null && priceMin !== '' && !isNaN(priceMin) && Number(priceMin) > 0) {
    whereClauses.push('t.price_sgd >= ?');
    params.push(Number(priceMin));
  }
  if (priceMax != null && priceMax !== '' && !isNaN(priceMax) && Number(priceMax) > 0) {
    whereClauses.push('t.price_sgd <= ?');
    params.push(Number(priceMax));
  }

  // Tenure filter (Freehold includes 999-yr / 9999-yr tenures)
  if (tenure === 'freehold') {
    whereClauses.push(`(UPPER(t.tenure) LIKE '%FREEHOLD%' OR t.tenure LIKE '999%' OR t.tenure LIKE '9999%' OR t.tenure LIKE '999999%' OR t.tenure LIKE '956%' OR t.tenure LIKE '947%' OR t.tenure LIKE '946%' OR t.tenure LIKE '929%' OR t.tenure LIKE '993%')`);
  } else if (tenure === 'leasehold') {
    whereClauses.push(`NOT (UPPER(t.tenure) LIKE '%FREEHOLD%' OR t.tenure LIKE '999%' OR t.tenure LIKE '9999%' OR t.tenure LIKE '999999%' OR t.tenure LIKE '956%' OR t.tenure LIKE '947%' OR t.tenure LIKE '946%' OR t.tenure LIKE '929%' OR t.tenure LIKE '993%')`);
  }

  // Radius filter by project coordinates
  if (radiusKm && centerCoords && centerCoords.lat && centerCoords.lng) {
    const lat = parseFloat(centerCoords.lat);
    const lng = parseFloat(centerCoords.lng);
    const maxRadius = parseFloat(radiusKm);
    const allProjs = await dbAll(`SELECT project_id, latitude, longitude FROM projects WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND (geo_source IS NULL OR geo_source != 'district_centre')`);
    const matchedIds = allProjs.filter(p => haversineDistance(lat, lng, p.latitude, p.longitude) <= maxRadius).map(p => p.project_id);
    if (matchedIds.length === 0) {
      const emptyResult = {
        summary: { totalVolume: 0, medianPrice: 0, medianPsqm: 0, medianPsft: 0, minPrice: 0, maxPrice: 0, averagePrice: 0 },
        timeSeries: [],
        scatterPoints: [],
        mapProjects: [],
        totalCount: 0
      };
      analyticsQueryCache.set(cacheKey, { data: emptyResult, timestamp: Date.now() });
      return emptyResult;
    }
    const placeholders = matchedIds.map(() => '?').join(',');
    whereClauses.push(`p.project_id IN (${placeholders})`);
    params.push(...matchedIds);
  }

  const sqlWhere = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Determine cutoff date for the past 24 months relative to effectiveDateTo
  const dTo = new Date(effectiveDateTo);
  const cutoffYear = isNaN(dTo.getFullYear()) ? new Date().getFullYear() - 2 : dTo.getFullYear() - 2;
  const cutoffDate = `${cutoffYear}-${String(dTo.getMonth() + 1 || 12).padStart(2, '0')}-01`;

  const summaryWhereClauses = [...whereClauses];
  const summaryParams = [...params];
  // Replace the first date range condition with cutoffDate -> effectiveDateTo
  summaryWhereClauses[0] = 't.contract_date >= ? AND t.contract_date <= ?';
  summaryParams[0] = cutoffDate;
  summaryParams[1] = effectiveDateTo;
  const summarySqlWhere = 'WHERE ' + summaryWhereClauses.join(' AND ');

  const [countRow, summaryRow, timeSeriesRows, scatterRows, mapRows] = await Promise.all([
    // 1. Total matching count
    dbGet(
      `SELECT COUNT(*) as totalCount
       FROM property_transactions t
       JOIN projects p ON t.project_id = p.project_id
       ${sqlWhere}`,
      params
    ),

    // 2. Summary for past 24 months with window-function medians
    dbGet(
      `WITH ranked AS (
         SELECT t.price_sgd, t.psqm_sgd, t.psft_sgd,
                ROW_NUMBER() OVER (ORDER BY t.price_sgd) AS rn_price,
                ROW_NUMBER() OVER (ORDER BY t.psqm_sgd) AS rn_psqm,
                ROW_NUMBER() OVER (ORDER BY t.psft_sgd) AS rn_psft,
                COUNT(*) OVER () AS total_count,
                MIN(t.price_sgd) OVER () AS min_price,
                MAX(t.price_sgd) OVER () AS max_price,
                AVG(t.price_sgd) OVER () AS avg_price
         FROM property_transactions t
         JOIN projects p ON t.project_id = p.project_id
         ${summarySqlWhere}
       )
       SELECT total_count, min_price, max_price, ROUND(avg_price) as averagePrice,
              ROUND(AVG(CASE WHEN rn_price IN ((total_count + 1)/2, (total_count + 2)/2) THEN price_sgd END)) AS medianPrice,
              ROUND(AVG(CASE WHEN rn_psqm IN ((total_count + 1)/2, (total_count + 2)/2) THEN psqm_sgd END)) AS medianPsqm,
              ROUND(AVG(CASE WHEN rn_psft IN ((total_count + 1)/2, (total_count + 2)/2) THEN psft_sgd END)) AS medianPsft
       FROM ranked
       WHERE rn_price IN ((total_count + 1)/2, (total_count + 2)/2)
          OR rn_psqm IN ((total_count + 1)/2, (total_count + 2)/2)
          OR rn_psft IN ((total_count + 1)/2, (total_count + 2)/2)`,
      summaryParams
    ),

    // 3. Time Series Monthly with window-function medians
    dbAll(
      `WITH ranked AS (
         SELECT SUBSTR(t.contract_date, 1, 7) AS period, t.psqm_sgd, t.psft_sgd, t.price_sgd,
                ROW_NUMBER() OVER (PARTITION BY SUBSTR(t.contract_date, 1, 7) ORDER BY t.psqm_sgd) AS rn_psqm,
                ROW_NUMBER() OVER (PARTITION BY SUBSTR(t.contract_date, 1, 7) ORDER BY t.psft_sgd) AS rn_psft,
                ROW_NUMBER() OVER (PARTITION BY SUBSTR(t.contract_date, 1, 7) ORDER BY t.price_sgd) AS rn_price,
                COUNT(*) OVER (PARTITION BY SUBSTR(t.contract_date, 1, 7)) AS cnt,
                AVG(t.psqm_sgd) OVER (PARTITION BY SUBSTR(t.contract_date, 1, 7)) AS avg_psqm,
                AVG(t.psft_sgd) OVER (PARTITION BY SUBSTR(t.contract_date, 1, 7)) AS avg_psft
         FROM property_transactions t
         JOIN projects p ON t.project_id = p.project_id
         ${sqlWhere}
       )
       SELECT period, cnt AS volume,
              ROUND(AVG(CASE WHEN rn_psqm IN ((cnt + 1)/2, (cnt + 2)/2) THEN psqm_sgd END)) AS medianPsqm,
              ROUND(avg_psqm) AS avgPsqm,
              ROUND(AVG(CASE WHEN rn_psft IN ((cnt + 1)/2, (cnt + 2)/2) THEN psft_sgd END)) AS medianPsft,
              ROUND(avg_psft) AS avgPsft,
              ROUND(AVG(CASE WHEN rn_price IN ((cnt + 1)/2, (cnt + 2)/2) THEN price_sgd END)) AS medianPrice
       FROM ranked
       WHERE rn_psqm IN ((cnt + 1)/2, (cnt + 2)/2)
          OR rn_psft IN ((cnt + 1)/2, (cnt + 2)/2)
          OR rn_price IN ((cnt + 1)/2, (cnt + 2)/2)
       GROUP BY period
       ORDER BY period ASC`,
      params
    ),

    // 4. Scatter Points (capped at 200)
    dbAll(
      `SELECT t.transaction_id AS id, t.contract_date AS date,
              COALESCE(t.floor_range, 'Unknown') AS floorRange,
              t.price_sgd AS priceSgd,
              ROUND(t.psqm_sgd) AS psqm,
              ROUND(t.psft_sgd) AS psft,
              t.area_sqm AS areaSqm,
              ROUND(t.area_sqft) AS areaSqft,
              p.project_name AS projectName,
              t.type_of_sale AS typeOfSale,
              t.project_id AS projectId
       FROM property_transactions t
       JOIN projects p ON t.project_id = p.project_id
       ${sqlWhere}
       ORDER BY t.contract_date DESC, t.transaction_id DESC
       LIMIT 200`,
      params
    ),

    // 5. Distinct Developments for Map Display with SQL window medians
    dbAll(
      `WITH ranked AS (
         SELECT t.project_id, t.psqm_sgd, t.psft_sgd,
                ROW_NUMBER() OVER (PARTITION BY t.project_id ORDER BY t.psft_sgd) AS rn,
                COUNT(*) OVER (PARTITION BY t.project_id) AS cnt
         FROM property_transactions t
         JOIN projects p ON t.project_id = p.project_id
         ${sqlWhere}
       )
       SELECT p.project_id AS id, p.project_name AS name, p.street_name AS street,
              p.postal_district AS district, p.market_segment AS segment, p.planning_area AS planningArea,
              p.latitude AS lat, p.longitude AS lng,
              r.cnt AS txCount,
              ROUND(AVG(CASE WHEN r.rn IN ((r.cnt + 1)/2, (r.cnt + 2)/2) THEN r.psqm_sgd END)) AS medianPsqm,
              ROUND(AVG(CASE WHEN r.rn IN ((r.cnt + 1)/2, (r.cnt + 2)/2) THEN r.psft_sgd END)) AS medianPsft
       FROM ranked r
       JOIN projects p ON r.project_id = p.project_id
       WHERE r.rn IN ((r.cnt + 1)/2, (r.cnt + 2)/2)
       GROUP BY r.project_id`,
      params
    )
  ]);

  const summary = {
    totalVolume: summaryRow?.total_count || 0,
    medianPrice: summaryRow?.medianPrice || 0,
    medianPsqm: summaryRow?.medianPsqm || 0,
    medianPsft: summaryRow?.medianPsft || 0,
    minPrice: summaryRow?.min_price || 0,
    maxPrice: summaryRow?.max_price || 0,
    averagePrice: summaryRow?.averagePrice || 0
  };

  const startMonth = effectiveDateFrom.substring(0, 7);
  const endMonth = effectiveDateTo.substring(0, 7);
  const allMonths = generateMonthRange(startMonth, endMonth);
  const timeMap = new Map(timeSeriesRows.map(r => [r.period, r]));
  const timeSeries = allMonths.map(mKey => {
    const data = timeMap.get(mKey);
    return data || {
      period: mKey,
      volume: 0,
      medianPsqm: null,
      avgPsqm: null,
      medianPsft: null,
      avgPsft: null,
      medianPrice: null
    };
  });

  const mapProjects = await Promise.all(mapRows.map(async p => {
    const livability = await getProjectLivability(p.id, p.lat, p.lng, lifestyleWeights, { trimmed: true });
    return {
      ...p,
      livability
    };
  }));

  const result = {
    summary,
    timeSeries,
    scatterPoints: scatterRows.reverse(),
    mapProjects,
    totalCount: countRow?.totalCount || 0
  };

  analyticsQueryCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

// 4. Rental & Gross Rental Yield Analytics Engine
export async function getRentalYieldAnalytics(filters = {}) {
  const cacheKey = 'rental:' + JSON.stringify(filters);
  const cached = analyticsQueryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  // Ensure valuations cache is ready
  if (saleValuationsCache.size === 0) {
    await initSaleValuationsCache();
  }

  const defaultDates = getDefaultDateRange(5);
  const {
    projects = [],
    street = null,
    district = null,
    planningArea = null,
    radiusKm = null,
    centerCoords = null,
    dateFrom = defaultDates.dateFrom,
    dateTo = defaultDates.dateTo,
    bedroomCount = null,
    unitSizeMin = 0,
    unitSizeMax = 10000,
    unitType = 'sqft',
    priceMin = null,
    priceMax = null,
    tenure = 'all',
    lifestyleWeights = null,
    page = 1,
    limit = 100
  } = filters;

  const effectiveDateFrom = dateFrom || defaultDates.dateFrom;
  const effectiveDateTo = dateTo || defaultDates.dateTo;

  const sanitizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 150);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * sanitizedLimit;

  const sizeMinSqm = unitType === 'sqft' ? unitSizeMin / 10.7639 : unitSizeMin;
  const sizeMaxSqm = unitType === 'sqft' ? unitSizeMax / 10.7639 : unitSizeMax;

  let whereClauses = ['r.lease_date >= ? AND r.lease_date <= ?', 'r.area_sqm >= ? AND r.area_sqm <= ?'];
  let params = [effectiveDateFrom.substring(0, 7), effectiveDateTo.substring(0, 7), sizeMinSqm, sizeMaxSqm];

  if (Array.isArray(projects) && projects.length > 0) {
    const isIdList = projects.every(p => typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p.trim())));
    const placeholders = projects.map(() => '?').join(',');
    if (isIdList) {
      whereClauses.push(`p.project_id IN (${placeholders})`);
      params.push(...projects.map(Number));
    } else {
      whereClauses.push(`UPPER(p.project_name) IN (${placeholders})`);
      params.push(...projects.map(p => String(p).toUpperCase()));
    }
  }

  if (street) {
    whereClauses.push(`UPPER(p.street_name) = UPPER(?)`);
    params.push(street);
  }

  if (district) {
    whereClauses.push(`p.postal_district = ?`);
    params.push(String(district).padStart(2, '0'));
  }

  if (planningArea) {
    whereClauses.push(`UPPER(p.planning_area) = UPPER(?)`);
    params.push(planningArea);
  }

  if (bedroomCount && bedroomCount !== 'all') {
    whereClauses.push(`r.bedroom_count = ?`);
    params.push(bedroomCount);
  }

  // Min and Max Rent
  if (priceMin != null && priceMin !== '' && !isNaN(priceMin) && Number(priceMin) > 0) {
    whereClauses.push('r.rent_sgd >= ?');
    params.push(Number(priceMin));
  }
  if (priceMax != null && priceMax !== '' && !isNaN(priceMax) && Number(priceMax) > 0) {
    whereClauses.push('r.rent_sgd <= ?');
    params.push(Number(priceMax));
  }

  // Tenure filter for rental transactions
  if (tenure === 'freehold') {
    whereClauses.push(`EXISTS (SELECT 1 FROM property_transactions pt WHERE pt.project_id = p.project_id AND (UPPER(pt.tenure) LIKE '%FREEHOLD%' OR pt.tenure LIKE '999%' OR pt.tenure LIKE '9999%' OR pt.tenure LIKE '999999%' OR pt.tenure LIKE '956%' OR pt.tenure LIKE '947%' OR pt.tenure LIKE '946%' OR pt.tenure LIKE '929%' OR pt.tenure LIKE '993%'))`);
  } else if (tenure === 'leasehold') {
    whereClauses.push(`NOT EXISTS (SELECT 1 FROM property_transactions pt WHERE pt.project_id = p.project_id AND (UPPER(pt.tenure) LIKE '%FREEHOLD%' OR pt.tenure LIKE '999%' OR pt.tenure LIKE '9999%' OR pt.tenure LIKE '999999%' OR pt.tenure LIKE '956%' OR pt.tenure LIKE '947%' OR pt.tenure LIKE '946%' OR pt.tenure LIKE '929%' OR pt.tenure LIKE '993%'))`);
  }

  // Radius filter by project coordinates
  if (radiusKm && centerCoords && centerCoords.lat && centerCoords.lng) {
    const lat = parseFloat(centerCoords.lat);
    const lng = parseFloat(centerCoords.lng);
    const maxRadius = parseFloat(radiusKm);
    const allProjs = await dbAll(`SELECT project_id, latitude, longitude FROM projects WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND (geo_source IS NULL OR geo_source != 'district_centre')`);
    const matchedIds = allProjs.filter(p => haversineDistance(lat, lng, p.latitude, p.longitude) <= maxRadius).map(p => p.project_id);
    if (matchedIds.length === 0) {
      const emptyResult = {
        summary: { medianRent: 0, medianRentPsft: 0, medianRentPsqm: 0, avgGrossYield: 0, totalLeases: 0, rentMinMaxRange: { min: 0, max: 0 } },
        timeSeries: [],
        bedroomBreakdown: [],
        rentalCaveats: [],
        mapProjects: [],
        totalCount: 0,
        page: Number(page) || 1,
        limit: sanitizedLimit
      };
      analyticsQueryCache.set(cacheKey, { data: emptyResult, timestamp: Date.now() });
      return emptyResult;
    }
    const placeholders = matchedIds.map(() => '?').join(',');
    whereClauses.push(`p.project_id IN (${placeholders})`);
    params.push(...matchedIds);
  }

  const sqlWhere = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // 24-month cutoff date for headline summary metrics
  const endMonth = effectiveDateTo.substring(0, 7);
  const yr = Number(endMonth.slice(0, 4));
  const cutoff24m = `${isNaN(yr) ? new Date().getFullYear() - 2 : yr - 2}-${endMonth.slice(5, 7)}`;

  const summaryWhereClauses = [...whereClauses];
  const summaryParams = [...params];
  summaryWhereClauses[0] = 'r.lease_date >= ? AND r.lease_date <= ?';
  summaryParams[0] = cutoff24m;
  summaryParams[1] = endMonth;
  const summarySqlWhere = 'WHERE ' + summaryWhereClauses.join(' AND ');

  const [countRow, summaryRow, timeSeriesRows, bedroomRows, caveats, mapRows] = await Promise.all([
    // 1. Total Count
    dbGet(
      `SELECT COUNT(*) as totalCount
       FROM rental_transactions r
       JOIN projects p ON r.project_id = p.project_id
       ${sqlWhere}`,
      params
    ),

    // 2. Headline Summary for past 24 months with SQL medians
    dbGet(
      `WITH ranked_rent AS (
         SELECT r.rent_sgd,
                ROW_NUMBER() OVER (ORDER BY r.rent_sgd) AS rn_rent,
                COUNT(*) OVER () AS total_count,
                MIN(r.rent_sgd) OVER () AS min_rent,
                MAX(r.rent_sgd) OVER () AS max_rent
         FROM rental_transactions r
         JOIN projects p ON r.project_id = p.project_id
         ${summarySqlWhere}
       ),
       ranked_psft AS (
         SELECT r.rent_psft, r.rent_psqm,
                ROW_NUMBER() OVER (ORDER BY r.rent_psft) AS rn_psft,
                ROW_NUMBER() OVER (ORDER BY r.rent_psqm) AS rn_psqm,
                COUNT(*) OVER () AS psft_count
         FROM rental_transactions r
         JOIN projects p ON r.project_id = p.project_id
         ${summarySqlWhere} AND r.rent_psft IS NOT NULL
       )
       SELECT 
         (SELECT total_count FROM ranked_rent LIMIT 1) AS total_count,
         (SELECT min_rent FROM ranked_rent LIMIT 1) AS min_rent,
         (SELECT max_rent FROM ranked_rent LIMIT 1) AS max_rent,
         (SELECT ROUND(AVG(rent_sgd)) FROM ranked_rent WHERE rn_rent IN ((total_count + 1)/2, (total_count + 2)/2)) AS median_rent,
         (SELECT ROUND(AVG(rent_psft), 2) FROM ranked_psft WHERE rn_psft IN ((psft_count + 1)/2, (psft_count + 2)/2)) AS median_rent_psft,
         (SELECT ROUND(AVG(rent_psqm), 2) FROM ranked_psft WHERE rn_psqm IN ((psft_count + 1)/2, (psft_count + 2)/2)) AS median_rent_psqm`,
      [...summaryParams, ...summaryParams]
    ),

    // 3. Time Series Monthly Breakdown
    dbAll(
      `SELECT r.lease_date as month,
              COUNT(*) as count,
              ROUND(AVG(r.rent_sgd)) as avgRent,
              ROUND(AVG(r.rent_psft), 2) as avgRentPsft
       FROM rental_transactions r
       JOIN projects p ON r.project_id = p.project_id
       ${sqlWhere}
       GROUP BY r.lease_date
       ORDER BY r.lease_date ASC`,
      params
    ),

    // 4. Bedroom Breakdown Aggregation
    dbAll(
      `SELECT COALESCE(r.bedroom_count, 'Unspecified') as bedroom,
              COUNT(*) as count,
              ROUND(AVG(r.rent_sgd)) as avgRent,
              ROUND(AVG(r.rent_psft), 2) as avgPsft
       FROM rental_transactions r
       JOIN projects p ON r.project_id = p.project_id
       ${sqlWhere}
       GROUP BY r.bedroom_count
       ORDER BY bedroom ASC`,
      params
    ),

    // 5. Paginated Rental Caveats
    dbAll(
      `SELECT r.rental_id as rentalId, r.project_id as projectId, r.area_sqm as areaSqm, r.area_sqft as areaSqft,
              r.rent_sgd as rentSgd, r.rent_psqm as rentPsqm, r.rent_psft as rentPsft,
              r.lease_date as leaseDate, COALESCE(r.bedroom_count, 'Unspecified') as bedroomCount,
              COALESCE(r.floor_area_range, CASE WHEN r.area_sqft IS NOT NULL THEN ROUND(r.area_sqft) || ' sqft' ELSE 'Unspecified' END) as floorAreaRange,
              r.property_type as propertyType,
              p.project_name as projectName, p.street_name as streetName, p.postal_district as district,
              p.market_segment as marketSegment, p.planning_area as planningArea
       FROM rental_transactions r
       JOIN projects p ON r.project_id = p.project_id
       ${sqlWhere}
       ORDER BY r.lease_date DESC
       LIMIT ? OFFSET ?`,
      [...params, sanitizedLimit, offset]
    ),

    // 6. Map Projects Aggregation with window-function medians
    dbAll(
      `WITH ranked AS (
         SELECT r.project_id, r.rent_sgd, r.rent_psft,
                ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY r.rent_sgd) AS rn_rent,
                ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY CASE WHEN r.rent_psft IS NULL THEN 1 ELSE 0 END, r.rent_psft) AS rn_psft,
                COUNT(*) OVER (PARTITION BY r.project_id) AS cnt,
                COUNT(r.rent_psft) OVER (PARTITION BY r.project_id) AS psft_cnt
         FROM rental_transactions r
         JOIN projects p ON r.project_id = p.project_id
         ${sqlWhere}
       )
       SELECT p.project_id AS id, p.project_name AS name, p.street_name AS street,
              p.postal_district AS district, p.market_segment AS segment, p.planning_area AS planningArea,
              p.latitude AS lat, p.longitude AS lng,
              r.cnt AS txCount,
              ROUND(AVG(CASE WHEN r.rn_rent IN ((r.cnt + 1)/2, (r.cnt + 2)/2) THEN r.rent_sgd END)) AS medianRent,
              ROUND(AVG(CASE WHEN r.psft_cnt > 0 AND r.rn_psft IN ((r.psft_cnt + 1)/2, (r.psft_cnt + 2)/2) THEN r.rent_psft END), 2) AS medianRentPsft
       FROM ranked r
       JOIN projects p ON r.project_id = p.project_id
       GROUP BY r.project_id`,
      params
    )
  ]);

  const medianRentPsft = summaryRow?.median_rent_psft || 0;
  const avgGrossYield = parseFloat(((medianRentPsft * 12.0 / 1650) * 100).toFixed(2));
  const summary = {
    medianRent: summaryRow?.median_rent || 0,
    medianRentPsft,
    medianRentPsqm: summaryRow?.median_rent_psqm || 0,
    avgGrossYield,
    totalLeases: summaryRow?.total_count || 0,
    rentMinMaxRange: { min: summaryRow?.min_rent || 0, max: summaryRow?.max_rent || 0 }
  };

  const startMonth = effectiveDateFrom.substring(0, 7);
  const allMonths = generateMonthRange(startMonth, endMonth);
  const timeMap = new Map(timeSeriesRows.map(m => [m.month, m]));
  const timeSeries = allMonths.map(month => {
    const data = timeMap.get(month);
    return data || {
      month,
      avgRent: null,
      avgRentPsft: null,
      count: 0
    };
  });

  const bedroomBreakdown = bedroomRows.map(b => ({
    bedroom: b.bedroom,
    count: b.count,
    avgRent: b.avgRent,
    avgPsft: b.avgPsft,
    avgYield: parseFloat(((b.avgPsft * 12.0 / 1650) * 100).toFixed(2))
  }));

  const rentalCaveats = caveats.map(r => {
    const val = getProjectSaleValuation(r.projectId);
    const annualRentPsft = r.rentPsft ? r.rentPsft * 12 : null;
    const grossYield = (annualRentPsft && val?.medianPsft)
      ? parseFloat(((annualRentPsft / val.medianPsft) * 100).toFixed(2))
      : null;
    const estimatedSalePrice = (r.areaSqft && val?.medianPsft)
      ? Math.round(r.areaSqft * val.medianPsft)
      : null;
    return {
      ...r,
      estimatedSaleValuation: estimatedSalePrice,
      grossYield
    };
  });

  const mapProjects = await Promise.all(mapRows.map(async p => {
    const val = getProjectSaleValuation(p.id);
    const grossYield = (p.medianRentPsft && val?.medianPsft)
      ? parseFloat(((p.medianRentPsft * 12 / val.medianPsft) * 100).toFixed(2))
      : null;
    const livability = await getProjectLivability(p.id, p.lat, p.lng, lifestyleWeights, { trimmed: true });
    return {
      id: p.id,
      name: p.name,
      street: p.street,
      district: p.district,
      planningArea: p.planningArea,
      segment: p.segment,
      lat: p.lat,
      lng: p.lng,
      txCount: p.txCount,
      medianRent: p.medianRent,
      medianRentPsft: p.medianRentPsft,
      medianSaleValuation: val.medianPrice,
      grossYield,
      livability
    };
  }));

  const result = {
    summary,
    timeSeries,
    bedroomBreakdown,
    rentalCaveats,
    mapProjects,
    totalCount: countRow?.totalCount || 0,
    page: Number(page) || 1,
    limit: sanitizedLimit
  };

  analyticsQueryCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

// 5. Get all projects overview for map initialize
export async function getAllProjects(lifestyleWeights = null) {
  const cacheKey = 'allProjects:' + JSON.stringify(lifestyleWeights);
  const cached = analyticsQueryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const projects = await dbAll(
    `SELECT p.project_id as id, p.project_name as name, p.street_name as street, p.postal_district as district,
            p.market_segment as segment, p.planning_area as planningArea, p.latitude as lat, p.longitude as lng,
            COUNT(t.transaction_id) as txCount,
            ROUND(AVG(t.psqm_sgd)) as avgPsqm,
            ROUND(AVG(t.psft_sgd)) as avgPsft
     FROM projects p
     LEFT JOIN property_transactions t ON p.project_id = t.project_id
     GROUP BY p.project_id`
  );

  const result = await Promise.all(projects.map(async p => {
    const livability = await getProjectLivability(p.id, p.lat, p.lng, lifestyleWeights, { trimmed: true });
    return {
      ...p,
      livability
    };
  }));

  analyticsQueryCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
