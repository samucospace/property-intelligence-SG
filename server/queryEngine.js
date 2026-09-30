import { dbAll, dbGet, createConnection, withTransaction } from './db.js';
import { calculateLivabilityScore, getProjectLivability, getGradeLabel, getGradeColor, DEFAULT_WEIGHTS } from './livabilityEngine.js';
import { getDefaultDateRange } from './utils/dateUtils.js';
import { calculateMedian } from './utils/math.js';
import { haversineDistance } from './utils/geo.js';

// Generate an array of YYYY-MM strings for every month between startMonth and endMonth inclusive
export function generateMonthRange(startMonth, endMonth) {
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

/**
 * Escapes special SQLite LIKE wildcards (%, _, \) to prevent query manipulation.
 * @param {string} str
 * @returns {string}
 */
export function escapeLike(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/([%_\\])/g, '\\$1');
}

// In-memory project sale valuations cache for instantaneous rental yield calculations
let saleValuationsCache = new Map();
const analyticsQueryCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

/**
 * Loads pre-computed 24-month rolling median sale benchmarks into memory cache (Step 3.1).
 * Loads in < 2ms directly from project_benchmarks table.
 */
export async function initSaleValuationsCache() {
  const rows = await dbAll(`
    SELECT project_id, rolling_24m_median_price as median_price, rolling_24m_median_psft as median_psft
    FROM project_benchmarks
  `);
  saleValuationsCache.clear();
  for (const r of rows) {
    saleValuationsCache.set(r.project_id, {
      medianPrice: Math.round(r.median_price || 0),
      medianPsft: Math.round(r.median_psft || 0)
    });
  }
}

export async function invalidateSaleValuationsCache() {
  analyticsQueryCache.clear();
  await initSaleValuationsCache();
}

export function invalidateAnalyticsCache() {
  analyticsQueryCache.clear();
}

/**
 * Refreshes the project_benchmarks table with rolling 24-month medians.
 * Called automatically after URA sync or bulk imports (Step 3.1).
 * @param {object} [conn] Optional database connection
 */
export async function refreshProjectBenchmarks(conn = null) {
  const localConn = conn || createConnection();
  const shouldClose = !conn;

  try {
    console.log('[Benchmarks] Refreshing 24-month rolling median sale benchmarks...');
    await withTransaction(localConn, async () => {
      await localConn.run(`DELETE FROM project_benchmarks`);

      await localConn.run(`
        INSERT INTO project_benchmarks (project_id, rolling_24m_median_price, rolling_24m_median_psft, sale_count, updated_at)
        WITH ranked_psft AS (
          SELECT project_id, psft_sgd,
                 ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY psft_sgd) AS rn,
                 COUNT(*) OVER (PARTITION BY project_id) AS cnt
          FROM property_transactions
          WHERE contract_date >= date('now', '-24 months')
            AND (no_of_units = 1 OR no_of_units IS NULL)
        ),
        med_psft AS (
          SELECT project_id,
                 ROUND(AVG(psft_sgd), 2) AS rolling_24m_median_psft,
                 cnt AS sale_count
          FROM ranked_psft
          WHERE rn IN ((cnt + 1)/2, (cnt + 2)/2)
          GROUP BY project_id
        ),
        ranked_price AS (
          SELECT project_id, price_sgd,
                 ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY price_sgd) AS rn,
                 COUNT(*) OVER (PARTITION BY project_id) AS cnt
          FROM property_transactions
          WHERE contract_date >= date('now', '-24 months')
            AND (no_of_units = 1 OR no_of_units IS NULL)
        ),
        med_price AS (
          SELECT project_id,
                 ROUND(AVG(price_sgd)) AS rolling_24m_median_price
          FROM ranked_price
          WHERE rn IN ((cnt + 1)/2, (cnt + 2)/2)
          GROUP BY project_id
        )
        SELECT p.project_id,
               pr.rolling_24m_median_price,
               p.rolling_24m_median_psft,
               p.sale_count,
               CURRENT_TIMESTAMP
        FROM med_psft p
        JOIN med_price pr ON p.project_id = pr.project_id
      `);
    });

    await initSaleValuationsCache();
    invalidateAnalyticsCache();
    console.log('[Benchmarks] Project benchmarks successfully updated.');
  } finally {
    if (shouldClose) {
      await localConn.close();
    }
  }
}

export function getProjectSaleValuation(projId) {
  const data = saleValuationsCache.get(projId);
  if (data && data.medianPrice && data.medianPsft) {
    return data;
  }
  // Return nulls if no qualifying recent sales exist (no fallback defaults)
  return { medianPrice: null, medianPsft: null };
}

// 1. Search Autocomplete Suggestions with Wildcard Escaping (Step 3.4.5)
export async function getSearchSuggestions(q) {
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return { projects: [], streets: [], districts: [], planningAreas: [] };
  }

  const escaped = escapeLike(q.trim().toUpperCase());
  const term = `%${escaped}%`;

  const projects = await dbAll(
    `SELECT project_id as id, project_name as name, street_name as street, postal_district as district, planning_area as planningArea,
            latitude as lat, longitude as lng, geo_source as locationQuality
     FROM projects
     WHERE UPPER(project_name) LIKE ? ESCAPE '\\' OR UPPER(street_name) LIKE ? ESCAPE '\\'
     LIMIT 10`,
    [term, term]
  );

  const streetsRows = await dbAll(
    `SELECT DISTINCT street_name FROM projects WHERE UPPER(street_name) LIKE ? ESCAPE '\\' LIMIT 5`,
    [term]
  );

  const districtRows = await dbAll(
    `SELECT DISTINCT postal_district FROM projects WHERE postal_district LIKE ? ESCAPE '\\' AND postal_district IS NOT NULL LIMIT 5`,
    [term]
  );

  const planningRows = await dbAll(
    `SELECT DISTINCT planning_area FROM projects WHERE UPPER(planning_area) LIKE ? ESCAPE '\\' AND planning_area IS NOT NULL LIMIT 5`,
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
    propertyType = 'condo',
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

  // Step 3.3.5: Indexed tenure_class filtering
  if (tenure === 'freehold') {
    whereClauses.push(`t.tenure_class = 'freehold'`);
  } else if (tenure === 'leasehold') {
    whereClauses.push(`t.tenure_class = 'leasehold'`);
  }

  // Step 3.3.4: Property Type filtering (default covers condo/apartment)
  if (propertyType === 'condo') {
    whereClauses.push(`(t.property_type IN ('Condominium', 'Apartment') OR t.property_type IS NULL) AND p.is_landed_aggregate = 0`);
  } else if (propertyType === 'landed') {
    whereClauses.push(`(p.is_landed_aggregate = 1 OR t.property_type IN ('Detached', 'Semi-detached', 'Terrace', 'Strata Detached', 'Strata Semi-detached', 'Strata Terrace', 'Detached House', 'Semi-Detached House', 'Terrace House'))`);
  } else if (propertyType === 'ec') {
    whereClauses.push(`t.property_type = 'Executive Condominium'`);
  } else if (propertyType !== 'all') {
    whereClauses.push(`t.property_type = ?`);
    params.push(propertyType);
  }

  // Radius filter by project coordinates (excluding district centroids)
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
        scatter: [],
        scatterPoints: [],
        mapProjects: [],
        totalCount: 0,
        page: Number(page) || 1,
        limit: Math.min(Math.max(Number(limit) || 100, 1), 500)
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
  summaryWhereClauses[0] = 't.contract_date >= ? AND t.contract_date <= ?';
  summaryParams[0] = cutoffDate;
  summaryParams[1] = effectiveDateTo;
  const summarySqlWhere = 'WHERE ' + summaryWhereClauses.join(' AND ');

  const sanitizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const [countRow, summaryRow, timeSeriesRows, scatterRows, mapRows] = await Promise.all([
    // 1. Total matching count
    dbGet(
      `SELECT COUNT(*) as totalCount
       FROM property_transactions t
       JOIN projects p ON t.project_id = p.project_id
       ${sqlWhere}`,
      params
    ),

    // 2. Summary for past 24 months with window-function medians (excluding bulk purchases)
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
         ${summarySqlWhere} AND (t.no_of_units = 1 OR t.no_of_units IS NULL)
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
         ${sqlWhere} AND (t.no_of_units = 1 OR t.no_of_units IS NULL)
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
         ${sqlWhere} AND (t.no_of_units = 1 OR t.no_of_units IS NULL)
       )
       SELECT p.project_id AS id, p.project_name AS name, p.street_name AS street,
              p.postal_district AS district, p.market_segment AS segment, p.planning_area AS planningArea,
              p.latitude AS lat, p.longitude AS lng, p.geo_source AS locationQuality,
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
    totalVolume: countRow?.totalCount || 0,
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
  const timeMap = new Map(timeSeriesRows.map(m => [m.period, m]));
  const timeSeries = allMonths.map(period => {
    const data = timeMap.get(period);
    return data || {
      period,
      volume: 0,
      medianPsqm: null,
      avgPsqm: null,
      medianPsft: null,
      avgPsft: null,
      medianPrice: null
    };
  });

  const scatter = scatterRows.map(d => ({
    id: d.id,
    date: d.date,
    floorRange: d.floorRange,
    priceSgd: d.priceSgd,
    psqm: d.psqm,
    psft: d.psft,
    areaSqm: d.areaSqm,
    areaSqft: d.areaSqft,
    projectName: d.projectName,
    typeOfSale: d.typeOfSale,
    projectId: d.projectId
  }));

  const mapProjects = mapRows.map(p => ({
    id: p.id,
    name: p.name,
    street: p.street,
    district: p.district,
    planningArea: p.planningArea,
    segment: p.segment,
    lat: p.lat,
    lng: p.lng,
    txCount: p.txCount,
    medianPsqm: p.medianPsqm,
    medianPsft: p.medianPsft,
    locationQuality: p.locationQuality,
    livability: getProjectLivability(p.id) || null
  }));

  const result = {
    summary,
    timeSeries,
    scatter,
    scatterPoints: scatter,
    mapProjects,
    totalCount: countRow?.totalCount || 0,
    page: Number(page) || 1,
    limit: sanitizedLimit
  };

  analyticsQueryCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

// 3. Rental Yield Analytics Query Engine
export async function getRentalYieldAnalytics(filters = {}) {
  const cacheKey = 'rental:' + JSON.stringify(filters);
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
    bedroomCount = 'all',
    radiusKm = null,
    centerCoords = null,
    dateFrom = defaultDates.dateFrom,
    dateTo = defaultDates.dateTo,
    priceMin = null,
    priceMax = null,
    tenure = 'all',
    propertyType = 'condo',
    lifestyleWeights = null,
    page = 1,
    limit = 100
  } = filters;

  const effectiveDateFrom = dateFrom || defaultDates.dateFrom;
  const effectiveDateTo = dateTo || defaultDates.dateTo;

  let whereClauses = ['r.lease_date >= ? AND r.lease_date <= ?'];
  let params = [effectiveDateFrom.substring(0, 7), effectiveDateTo.substring(0, 7)];

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

  // Bedroom filter
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

  // Step 3.3.5: Indexed project tenure_class filter (clean null handling)
  if (tenure === 'freehold') {
    whereClauses.push(`p.tenure_class = 'freehold'`);
  } else if (tenure === 'leasehold') {
    whereClauses.push(`p.tenure_class = 'leasehold'`);
  }

  // Step 3.3.4: Property Type filter
  if (propertyType === 'condo') {
    whereClauses.push(`(r.property_type IN ('Condominium', 'Apartment', 'Non-landed Properties') OR r.property_type IS NULL) AND p.is_landed_aggregate = 0`);
  } else if (propertyType === 'landed') {
    whereClauses.push(`(p.is_landed_aggregate = 1 OR r.property_type IN ('Landed Properties', 'Detached House', 'Semi-Detached House', 'Terrace House'))`);
  } else if (propertyType === 'ec') {
    whereClauses.push(`r.property_type = 'Executive Condominium'`);
  } else if (propertyType !== 'all') {
    whereClauses.push(`r.property_type = ?`);
    params.push(propertyType);
  }

  // Radius filter by project coordinates (excluding district centroids)
  if (radiusKm && centerCoords && centerCoords.lat && centerCoords.lng) {
    const lat = parseFloat(centerCoords.lat);
    const lng = parseFloat(centerCoords.lng);
    const maxRadius = parseFloat(radiusKm);
    const allProjs = await dbAll(`SELECT project_id, latitude, longitude FROM projects WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND (geo_source IS NULL OR geo_source != 'district_centre')`);
    const matchedIds = allProjs.filter(p => haversineDistance(lat, lng, p.latitude, p.longitude) <= maxRadius).map(p => p.project_id);
    if (matchedIds.length === 0) {
      const emptyResult = {
        summary: { medianRent: 0, medianRentPsft: 0, medianRentPsqm: 0, avgGrossYield: null, totalLeases: 0, rentMinMaxRange: { min: 0, max: 0 } },
        timeSeries: [],
        bedroomBreakdown: [],
        rentalCaveats: [],
        mapProjects: [],
        totalCount: 0,
        page: Number(page) || 1,
        limit: Math.min(Math.max(Number(limit) || 100, 1), 500)
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

  const sanitizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const offset = ((Number(page) || 1) - 1) * sanitizedLimit;

  const [countRow, summaryRow, matchingSaleStats, timeSeriesRows, bedroomRows, caveats, mapRows] = await Promise.all([
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

    // 2b. Matching 24-month median sale psft across the same filtered projects (eliminates hardcoded 1650 psf)
    dbGet(
      `SELECT ROUND(AVG(b.rolling_24m_median_psft), 2) as medianSalePsft
       FROM project_benchmarks b
       WHERE b.rolling_24m_median_psft IS NOT NULL
         AND b.project_id IN (
           SELECT DISTINCT r.project_id
           FROM rental_transactions r
           JOIN projects p ON r.project_id = p.project_id
           ${sqlWhere}
         )`,
      params
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
              p.latitude AS lat, p.longitude AS lng, p.geo_source AS locationQuality,
              p.livability_score AS livabilityScore, p.livability_data AS livabilityData,
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
  const benchmarkSalePsft = matchingSaleStats?.medianSalePsft || null;

  // Step 3.3.2: Genuine time-matched gross yield calculation (null if no matching sales)
  const avgGrossYield = (medianRentPsft && benchmarkSalePsft && benchmarkSalePsft > 0)
    ? parseFloat(((medianRentPsft * 12.0 / benchmarkSalePsft) * 100).toFixed(2))
    : null;

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
    avgYield: (b.avgPsft && benchmarkSalePsft)
      ? parseFloat(((b.avgPsft * 12.0 / benchmarkSalePsft) * 100).toFixed(2))
      : null
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

  const mapProjects = mapRows.map(p => {
    const val = getProjectSaleValuation(p.id);
    const grossYield = (p.medianRentPsft && val?.medianPsft)
      ? parseFloat(((p.medianRentPsft * 12 / val.medianPsft) * 100).toFixed(2))
      : null;

    // Step 3.1: Synchronous livability score derivation without distance scans
    let livScore = p.livabilityScore;
    let livSubScores = { mrt: null, school: null, hawker: null, supermarket: null, park: null };
    let livNearest = {};

    if (p.livabilityData) {
      try {
        const parsedData = typeof p.livabilityData === 'string' ? JSON.parse(p.livabilityData) : p.livabilityData;
        livSubScores = parsedData.subScores || livSubScores;
        livNearest = parsedData.nearest || livNearest;
      } catch (e) {}
    }

    if (lifestyleWeights && livScore !== null) {
      const weights = {
        mrt: (lifestyleWeights.mrt || 0),
        school: (lifestyleWeights.school || 0),
        hawker: (lifestyleWeights.hawker || 0),
        supermarket: (lifestyleWeights.supermarket || 0),
        park: (lifestyleWeights.park || 0)
      };
      const sum = weights.mrt + weights.school + weights.hawker + weights.supermarket + weights.park;
      if (sum > 0) {
        livScore = Math.round(
          ((livSubScores.mrt || 0) * weights.mrt +
           (livSubScores.school || 0) * weights.school +
           (livSubScores.hawker || 0) * weights.hawker +
           (livSubScores.supermarket || 0) * weights.supermarket +
           (livSubScores.park || 0) * weights.park) / sum
        );
      }
    }

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
      livability: {
        score: livScore,
        label: getGradeLabel(livScore),
        color: getGradeColor(livScore),
        subScores: livSubScores
      }
    };
  });

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

// 5. Get all projects overview for map initialize (Step 3.1 & 3.3.4)
export async function getAllProjects(lifestyleWeights = null) {
  const cacheKey = 'allProjects:' + JSON.stringify(lifestyleWeights);
  const cached = analyticsQueryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  // Reads pre-computed benchmarks and livability directly in one lightning-fast query (< 10ms)
  const projects = await dbAll(
    `SELECT p.project_id as id, p.project_name as name, p.street_name as street, p.postal_district as district,
            p.market_segment as segment, p.planning_area as planningArea, p.latitude as lat, p.longitude as lng,
            p.geo_source as locationQuality,
            p.livability_score as livabilityScore, p.livability_data as livabilityData,
            p.tenure_class as tenureClass,
            COALESCE(b.sale_count, 0) as txCount,
            b.rolling_24m_median_psft as avgPsft,
            b.rolling_24m_median_price as medianPrice
     FROM projects p
     LEFT JOIN project_benchmarks b ON p.project_id = b.project_id
     WHERE p.is_landed_aggregate = 0`
  );

  const result = projects.map(p => {
    let livScore = p.livabilityScore;
    let subScores = { mrt: null, school: null, hawker: null, supermarket: null, park: null };

    if (p.livabilityData) {
      try {
        const parsed = typeof p.livabilityData === 'string' ? JSON.parse(p.livabilityData) : p.livabilityData;
        subScores = parsed.subScores || subScores;
      } catch (e) {}
    }

    if (lifestyleWeights && livScore !== null) {
      const weights = {
        mrt: (lifestyleWeights.mrt || 0),
        school: (lifestyleWeights.school || 0),
        hawker: (lifestyleWeights.hawker || 0),
        supermarket: (lifestyleWeights.supermarket || 0),
        park: (lifestyleWeights.park || 0)
      };
      const sum = weights.mrt + weights.school + weights.hawker + weights.supermarket + weights.park;
      if (sum > 0) {
        livScore = Math.round(
          ((subScores.mrt || 0) * weights.mrt +
           (subScores.school || 0) * weights.school +
           (subScores.hawker || 0) * weights.hawker +
           (subScores.supermarket || 0) * weights.supermarket +
           (subScores.park || 0) * weights.park) / sum
        );
      }
    }

    return {
      id: p.id,
      name: p.name,
      street: p.street,
      district: p.district,
      segment: p.segment,
      planningArea: p.planningArea,
      lat: p.lat,
      lng: p.lng,
      locationQuality: p.locationQuality,
      txCount: p.txCount,
      avgPsft: p.avgPsft,
      medianPrice: p.medianPrice,
      tenureClass: p.tenureClass,
      livability: {
        score: livScore,
        label: getGradeLabel(livScore),
        color: getGradeColor(livScore),
        subScores
      }
    };
  });

  analyticsQueryCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
