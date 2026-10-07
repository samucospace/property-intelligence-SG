import {marketVersion,loadAnalyticsSnapshot,storeAnalyticsSnapshot} from './utils/analyticsSnapshots.js';
import {medianOne,medianRows} from './utils/medianQueries.js';
import { BoundedJsonCache } from './utils/boundedJsonCache.js';
import { matchedSaleValuations, saleWindow, projectYield } from './utils/yieldMetrics.js';
import { invalidateLivabilityCache } from './livabilityEngine.js';
import { dbAll, dbGet, createConnection, withTransaction, getMetadataConnection, getPrimaryConnection } from './db.js';
import { calculateLivabilityScore, getProjectLivability, getGradeLabel, getGradeColor, DEFAULT_WEIGHTS } from './livabilityEngine.js';
import { getDefaultDateRange, getTodaySingaporeString } from './utils/dateUtils.js';
import { calculateMedian } from './utils/math.js';
import { haversineDistance, formatPlanningAreaFallback } from './utils/geo.js';

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
let valuationsLoaded=false;
let valuationsFlight=null;
const analyticsQueryCache = new BoundedJsonCache();
const analyticsFlights = new Map();
let analyticsGeneration = 0;
let refreshPromise = null;
let heavyActive=0;
const heavyQueue=[];
async function withAnalyticsCapacity(compute) {
  if(heavyActive>=1) {
    if(heavyQueue.length>=16) {const error=new Error('Analytics capacity is busy; retry shortly');error.status=503;throw error;}
    await new Promise(resolve=>heavyQueue.push(resolve));
  } else heavyActive++;
  try {return await compute();} finally {
    if(heavyQueue.length) heavyQueue.shift()();else heavyActive--;
  }
}
function getAnalyticsCache(key) { return analyticsQueryCache.get(key); }
function setAnalyticsCache(key,data,generation=analyticsGeneration) {
  if (generation===analyticsGeneration) analyticsQueryCache.set(key,data);
}
export function analyticsCacheStats() {return {...analyticsQueryCache.stats(),inFlight:analyticsFlights.size,heavyActive,queued:heavyQueue.length};}
async function queryOnce(prefix,filters,compute) {
  await syncCacheWithDataVersion();
  const key=normalizeAnalyticsCacheKey(prefix,filters);
  const cached=getAnalyticsCache(key);
  if(cached) return cached;
  const generation=analyticsGeneration,flightKey=generation+':'+key;
  if(analyticsFlights.has(flightKey)) return analyticsFlights.get(flightKey);
  const flight=(async()=>{
    const active=getPrimaryConnection(),metadata=getMetadataConnection();
    const version=await marketVersion(metadata);
    const materialized=await loadAnalyticsSnapshot(metadata,prefix,filters);
    if(materialized) {setAnalyticsCache(key,materialized,generation);return materialized;}
    const data=await withAnalyticsCapacity(()=>compute(generation));
    if(await marketVersion(metadata)!==version) {
      invalidateAnalyticsCache();const error=new Error('Market data changed during analytics; retry after preparation');error.status=503;throw error;
    }
    await storeAnalyticsSnapshot(active,prefix,filters,data,version);
    return data;
  })();
  analyticsFlights.set(flightKey,flight);
  try {return await flight;} finally {analyticsFlights.delete(flightKey);}
}

/**
 * Normalizes filter inputs into a deterministic cache key.
 * Strips arbitrary keys (e.g. _rand, cache-busting tokens) to prevent cache thrashing (ABU-01).
 */
export function normalizeAnalyticsCacheKey(prefix, filters = {}) {
  const allowedKeys = [
    'bedroomCount',
    'centerCoords',
    'dateFrom',
    'dateTo',
    'district',
    'lifestyleWeights',
    'limit',
    'page',
    'planningArea',
    'priceMax',
    'priceMin',
    'projects',
    'propertyType',
    'radiusKm',
    'street',
    'tenure',
    'unitSizeMax',
    'unitSizeMin',
    'unitType'
  ];

  const normalized = {};
  for (const key of allowedKeys) {
    const val = filters[key];
    if (val !== undefined && val !== null && val !== '') {
      if (key === 'projects' && Array.isArray(val)) {
        normalized.projects = [...val].map(String).sort();
      } else if (key === 'centerCoords' && typeof val === 'object') {
        const lat = parseFloat(val.lat);
        const lng = parseFloat(val.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          normalized.centerCoords = { lat, lng };
        }
      } else if (key === 'lifestyleWeights' && typeof val === 'object') {
        normalized.lifestyleWeights = Object.keys(val).sort().reduce((acc, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
      } else {
        normalized[key] = val;
      }
    }
  }

  return `${prefix}:${JSON.stringify(normalized)}`;
}

/**
 * Finds project IDs within radiusKm using SQLite bounding-box pre-filtering,
 * exact haversine distance filtering across all projects within the radius.
 */
export async function getMatchingProjectIdsByRadius(centerCoords, radiusKm, maxProjects = null) {
  if (!centerCoords || !centerCoords.lat || !centerCoords.lng || !radiusKm) {
    return [];
  }

  const lat = parseFloat(centerCoords.lat);
  const lng = parseFloat(centerCoords.lng);
  const maxRadius = parseFloat(radiusKm);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(maxRadius) || maxRadius <= 0) {
    return [];
  }

  // Singapore is at ~1.3°N. 1 deg latitude ~ 111 km. 1 deg longitude ~ 111 * cos(lat) km.
  const latDelta = maxRadius / 111.0;
  const radLat = (lat * Math.PI) / 180.0;
  const lngDelta = maxRadius / (111.0 * Math.cos(radLat));

  const latMin = lat - latDelta;
  const latMax = lat + latDelta;
  const lngMin = lng - lngDelta;
  const lngMax = lng + lngDelta;

  // Bounding box pre-filter in SQLite
  const candidateProjects = await dbAll(
    `SELECT project_id, latitude, longitude
     FROM projects
     WHERE latitude BETWEEN ? AND ?
       AND longitude BETWEEN ? AND ?
       AND (geo_source IS NULL OR geo_source != 'district_centre')`,
    [latMin, latMax, lngMin, lngMax]
  );

  let matches = candidateProjects
    .map(p => ({ id: p.project_id, dist: haversineDistance(lat, lng, p.latitude, p.longitude) }))
    .filter(p => p.dist <= maxRadius)
    .sort((a, b) => a.dist - b.dist);



  return matches.map(p => p.id);
}

let lastObservedDataVersion = null;

/**
 * Checks SQLite PRAGMA data_version and refreshes in-memory caches if another
 * connection or process has committed data changes (GL-06).
 * @param {object} [conn] Optional database connection
 */
let cacheConnection = null;
export async function syncCacheWithDataVersion(conn = null) {
  if(refreshPromise) await refreshPromise;
  const active = conn || getMetadataConnection();
  const currentVersion = await marketVersion(active);
  const invalidated = cacheConnection !== active || lastObservedDataVersion !== currentVersion;
  if(!invalidated) return false;
  if(refreshPromise) {await refreshPromise;return syncCacheWithDataVersion(conn);}
  const refresh=(async()=>{
    invalidateAnalyticsCache();invalidateLivabilityCache();
    saleValuationsCache=new Map();valuationsLoaded=false;
    cacheConnection=active;lastObservedDataVersion=currentVersion;
  })();
  refreshPromise=refresh;
  try {await refresh;} finally {if(refreshPromise===refresh) refreshPromise=null;}
  return true;
}

/**
 * Loads date-filtered current valuations using the shared sample contract.
 * @param {object} [conn] Optional database connection for transaction/test isolation
 */
export async function initSaleValuationsCache(conn = null) {
  const active=conn || getPrimaryConnection();
  const before=await marketVersion(active);
  const data=await matchedSaleValuations({propertyType:'all'},active);
  const after=await marketVersion(active);
  if(before!==after) {valuationsLoaded=false;throw new Error('Market changed during valuation preparation; retry after sync');}
  saleValuationsCache=data;valuationsLoaded=true;cacheConnection=conn || getMetadataConnection();lastObservedDataVersion=after;
}
async function ensureValuations() {
  if(valuationsLoaded) return;
  if(!valuationsFlight) valuationsFlight=initSaleValuationsCache().finally(()=>{valuationsFlight=null;});
  await valuationsFlight;
}
export async function prepareDefaultAnalytics() {
  const began=Date.now();
  await getPriceAnalytics();await getRentalYieldAnalytics();await getRentalYieldAnalytics({unitSizeMax:10000});
  return {prepared:true,durationMs:Date.now()-began,marketVersion:await marketVersion(getPrimaryConnection())};
}

export async function invalidateSaleValuationsCache(conn = null) {
  analyticsQueryCache.clear();
  await initSaleValuationsCache(conn);
}

export function invalidateAnalyticsCache() {
  analyticsGeneration++;
  analyticsQueryCache.clear();
}
export const clearAnalyticsCache = invalidateAnalyticsCache;

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
          WHERE contract_date BETWEEN date('now', '-23 months', 'start of month') AND date('now') AND price_sgd > 0 AND psft_sgd > 0
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
          WHERE contract_date BETWEEN date('now', '-23 months', 'start of month') AND date('now') AND price_sgd > 0 AND psft_sgd > 0
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
               CASE WHEN p.sale_count >= 3 THEN pr.rolling_24m_median_price END,
               CASE WHEN p.sale_count >= 3 THEN p.rolling_24m_median_psft END,
               p.sale_count,
               CURRENT_TIMESTAMP
        FROM med_psft p
        JOIN med_price pr ON p.project_id = pr.project_id
      `);
    });

    await initSaleValuationsCache(localConn);
    invalidateAnalyticsCache();
    console.log('[Benchmarks] Project benchmarks successfully updated.');
  } finally {
    if (shouldClose) {
      await localConn.close();
    }
  }
}

export async function getProjectSaleValuation(projId) {
  await syncCacheWithDataVersion();
  await ensureValuations();
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

  const projects = await getMetadataConnection().all(
    `SELECT project_id as id, project_name as name, street_name as street, postal_district as district, planning_area as planningArea,
            latitude as lat, longitude as lng, geo_source as locationQuality
     FROM projects
     WHERE (UPPER(project_name) LIKE ? ESCAPE '\\' OR UPPER(street_name) LIKE ? ESCAPE '\\') AND NOT EXISTS (SELECT 1 FROM project_identity_review q WHERE q.project_id=projects.project_id AND q.status='pending')
     LIMIT 10`,
    [term, term]
  );

  const streetsRows = await getMetadataConnection().all(
    `SELECT DISTINCT street_name FROM projects WHERE UPPER(street_name) LIKE ? ESCAPE '\\' LIMIT 5`,
    [term]
  );

  const districtRows = await getMetadataConnection().all(
    `SELECT DISTINCT postal_district FROM projects WHERE postal_district LIKE ? ESCAPE '\\' AND postal_district IS NOT NULL LIMIT 5`,
    [term]
  );

  const planningRows = await getMetadataConnection().all(
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
async function calculatePriceAnalytics(filters = {},generation=analyticsGeneration) {
  await syncCacheWithDataVersion();
  const cacheKey = normalizeAnalyticsCacheKey('price', filters);
  const cachedData = getAnalyticsCache(cacheKey);
  if (cachedData) {
    return cachedData;
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
    propertyType = projects.length > 0 ? 'all' : 'condo',
    lifestyleWeights = null,
    page = 1,
    limit = 100
  } = filters;

  const sanitizedPage = Math.max(1, parseInt(page, 10) || 1);
  const sanitizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  const offset = (sanitizedPage - 1) * sanitizedLimit;

  const effectiveDateFrom = dateFrom || defaultDates.dateFrom;
  const effectiveDateTo = dateTo || defaultDates.dateTo;

  // Calculate size in SQM for SQL filtering (stored in SQM)
  const sizeMinSqm = unitType === 'sqft' ? unitSizeMin / 10.7639 : unitSizeMin;
  const sizeMaxSqm = unitType === 'sqft' ? unitSizeMax / 10.7639 : unitSizeMax;

  let whereClauses = ['t.contract_date >= ? AND t.contract_date <= ?', 't.area_sqm >= ? AND t.area_sqm <= ?', "NOT EXISTS (SELECT 1 FROM project_identity_review q WHERE q.project_id=p.project_id AND q.status='pending')"];
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
    whereClauses.push(`COALESCE(t.source_district,p.postal_district) = ?`);
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
    const matchedIds = await getMatchingProjectIdsByRadius(centerCoords, radiusKm);
    if (matchedIds.length === 0) {
      const emptyResult = {
        summary: { totalVolume: 0, medianPrice: 0, medianPsqm: 0, medianPsft: 0, minPrice: 0, maxPrice: 0, averagePrice: 0 },
        timeSeries: [],
        scatter: [],
        scatterPoints: [],
        mapProjects: [],
        totalCount: 0,
        page: Math.max(1, parseInt(page, 10) || 1),
        limit: Math.min(Math.max(Number(limit) || 100, 1), 500)
      };
      setAnalyticsCache(cacheKey, emptyResult,generation);
      return emptyResult;
    }
    const placeholders = matchedIds.map(() => '?').join(',');
    whereClauses.push(`p.project_id IN (${placeholders})`);
    params.push(...matchedIds);
  }

  const sqlWhere = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const summaryWhereClauses = [...whereClauses];
  const summaryParams = [...params];
  summaryWhereClauses[0] = 't.contract_date >= ? AND t.contract_date <= ?';
  summaryParams[0] = effectiveDateFrom;
  summaryParams[1] = effectiveDateTo;
  const summarySqlWhere = 'WHERE ' + summaryWhereClauses.join(' AND ');

  const [countRow, summaryRow, timeSeriesRows, scatterRows, mapRows] = await Promise.all([
    // 1. Total matching count
    dbGet(
      `SELECT COUNT(*) as totalCount
       FROM property_transactions t
       JOIN projects p INDEXED BY idx_projects_filter_cover ON t.project_id = p.project_id
       ${sqlWhere}`,
      params
    ),

    medianOne(`SELECT COUNT(*) AS total_count,MIN(t.price_sgd) AS min_price,MAX(t.price_sgd) AS max_price,
      ROUND(AVG(t.price_sgd)) AS averagePrice,
      GROUP_CONCAT(CASE WHEN t.price_sgd IS NOT NULL THEN printf('%!.17g',t.price_sgd) END) AS prices,
      GROUP_CONCAT(CASE WHEN t.psqm_sgd IS NOT NULL THEN printf('%!.17g',t.psqm_sgd) END) AS psqm_values,
      GROUP_CONCAT(CASE WHEN t.psft_sgd IS NOT NULL THEN printf('%!.17g',t.psft_sgd) END) AS psft_values
      FROM property_transactions t JOIN projects p INDEXED BY idx_projects_filter_cover ON t.project_id=p.project_id
      ${summarySqlWhere} AND (t.no_of_units=1 OR t.no_of_units IS NULL)`,summaryParams,
      [{source:'prices',count:'total_count',target:'medianPrice',digits:0},{source:'psqm_values',count:'total_count',target:'medianPsqm',digits:0},{source:'psft_values',count:'total_count',target:'medianPsft',digits:0}]),

    medianRows(`SELECT substr(t.contract_date,1,7) AS period,COUNT(*) AS volume,
      ROUND(AVG(t.psqm_sgd)) AS avgPsqm,ROUND(AVG(t.psft_sgd)) AS avgPsft,
      GROUP_CONCAT(CASE WHEN t.price_sgd IS NOT NULL THEN printf('%!.17g',t.price_sgd) END) AS prices,
      GROUP_CONCAT(CASE WHEN t.psqm_sgd IS NOT NULL THEN printf('%!.17g',t.psqm_sgd) END) AS psqm_values,
      GROUP_CONCAT(CASE WHEN t.psft_sgd IS NOT NULL THEN printf('%!.17g',t.psft_sgd) END) AS psft_values
      FROM property_transactions t JOIN projects p INDEXED BY idx_projects_filter_cover ON t.project_id=p.project_id
      ${sqlWhere} AND (t.no_of_units=1 OR t.no_of_units IS NULL)
      GROUP BY substr(t.contract_date,1,7) ORDER BY period`,params,
      [{source:'prices',count:'volume',target:'medianPrice',digits:0},{source:'psqm_values',count:'volume',target:'medianPsqm',digits:0},{source:'psft_values',count:'volume',target:'medianPsft',digits:0}]),

    // 4. Scatter Points (paginated with sanitized page and limit)
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
       JOIN projects p INDEXED BY idx_projects_filter_cover ON t.project_id = p.project_id
       ${sqlWhere}
       ORDER BY t.contract_date DESC, t.transaction_id DESC
       LIMIT ? OFFSET ?`,
      [...params, sanitizedLimit, offset]
    ),

    medianRows(`WITH aggregates AS (
      SELECT t.project_id,COUNT(*) AS txCount,
        GROUP_CONCAT(CASE WHEN t.psft_sgd IS NOT NULL THEN printf('%!.17g',t.psft_sgd) END) AS psft_values,
        GROUP_CONCAT(CASE WHEN t.psft_sgd IS NULL THEN 'n' ELSE printf('%!.17g',t.psft_sgd) END || ':' || CASE WHEN t.psqm_sgd IS NULL THEN 'n' ELSE printf('%!.17g',t.psqm_sgd) END) AS paired_psqm
      FROM property_transactions t JOIN projects p INDEXED BY idx_projects_filter_cover ON t.project_id=p.project_id
      ${sqlWhere} AND (t.no_of_units=1 OR t.no_of_units IS NULL) GROUP BY t.project_id)
      SELECT p.project_id AS id,p.project_name AS name,p.street_name AS street,p.postal_district AS district,
        p.market_segment AS segment,p.planning_area AS planningArea,p.latitude AS lat,p.longitude AS lng,
        p.geo_source AS locationQuality,p.livability_score AS livabilityScore,
        CASE WHEN json_valid(p.livability_data) THEN json_object('subScores',json_extract(p.livability_data,'$.subScores')) END AS livabilityData,
        a.txCount,a.psft_values,a.paired_psqm
      FROM aggregates a JOIN projects p INDEXED BY idx_projects_filter_cover ON a.project_id=p.project_id`,params,
      [{source:'psft_values',count:'txCount',target:'medianPsft',digits:0},{source:'paired_psqm',count:'txCount',target:'medianPsqm',digits:0,paired:true}])

  ]);

  const summary = {
    totalVolume: summaryRow?.total_count || 0,
    filteredVolume: countRow?.totalCount || 0,
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

  const mapProjects = mapRows.map(p => {
    let livScore = p.livabilityScore;
    if (p.locationQuality === 'district_centre' || !p.lat || !p.lng) {
      livScore = null;
    }
    let livSubScores = { mrt: null, school: null, hawker: null, supermarket: null, park: null };
    let livNearest = {};

    if (p.livabilityData && p.locationQuality !== 'district_centre' && p.lat && p.lng) {
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
      planningArea: formatPlanningAreaFallback(p.planningArea, p.district),
      segment: p.segment,
      lat: p.lat,
      lng: p.lng,
      txCount: p.txCount,
      medianPsqm: p.medianPsqm,
      medianPsft: p.medianPsft,
      locationQuality: p.locationQuality,
      livability: {
        score: livScore,
        label: getGradeLabel(livScore, p.locationQuality),
        color: getGradeColor(livScore),
        subScores: livSubScores,
        nearest: {}
      }
    };
  });

  const result = {
    summary,
    timeSeries,
    scatter,
    scatterPoints: scatter,
    mapProjects,
    totalCount: countRow?.totalCount || 0,
    page: sanitizedPage,
    limit: sanitizedLimit,
    totalPages: Math.ceil((countRow?.totalCount || 0) / sanitizedLimit)
  };

  setAnalyticsCache(cacheKey, result,generation);
  return result;
}

// 3. Rental Yield Analytics Query Engine
async function calculateRentalAnalytics(filters = {},generation=analyticsGeneration) {
  await syncCacheWithDataVersion();
  const cacheKey = normalizeAnalyticsCacheKey('rental', filters);
  const cachedData = getAnalyticsCache(cacheKey);
  if (cachedData) {
    return cachedData;
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
    unitSizeMin = 0,
    unitSizeMax = null,
    unitType = 'sqft',
    priceMin = null,
    priceMax = null,
    tenure = 'all',
    propertyType = projects.length > 0 ? 'all' : 'condo',
    lifestyleWeights = null,
    page = 1,
    limit = 100
  } = filters;

  const sanitizedPage = Math.max(1, parseInt(page, 10) || 1);
  const sanitizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  const offset = (sanitizedPage - 1) * sanitizedLimit;

  const effectiveDateFrom = dateFrom || defaultDates.dateFrom;
  const effectiveDateTo = dateTo || defaultDates.dateTo;

  let whereClauses = ['substr(r.lease_date,1,7) >= ? AND substr(r.lease_date,1,7) <= ?', "NOT EXISTS (SELECT 1 FROM project_identity_review q WHERE q.project_id=p.project_id AND q.status='pending')"];
  let params = [effectiveDateFrom.substring(0, 7), effectiveDateTo.substring(0, 7)];

  // Unit size / Floor area band filtering
  if (unitSizeMin > 0 || (unitSizeMax != null && Number(unitSizeMax) < 100000)) {
    const minSqft = unitType === 'sqft' ? Number(unitSizeMin) : Number(unitSizeMin) * 10.7639;
    const maxSqft = unitType === 'sqft' ? Number(unitSizeMax || 100000) : Number(unitSizeMax || 10000) * 10.7639;
    whereClauses.push('(r.area_sqft >= ? AND r.area_sqft <= ?)');
    params.push(minSqft, maxSqft);
  }

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
    whereClauses.push(`COALESCE(r.source_district,p.postal_district) = ?`);
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
    const matchedIds = await getMatchingProjectIdsByRadius(centerCoords, radiusKm);
    if (matchedIds.length === 0) {
      const emptyResult = {
        summary: { medianRent: 0, medianRentPsft: 0, medianRentPsqm: 0, avgGrossYield: null, totalLeases: 0, rentMinMaxRange: { min: 0, max: 0 } },
        timeSeries: [],
        bedroomBreakdown: [],
        rentalCaveats: [],
        mapProjects: [],
        totalCount: 0,
        page: Math.max(1, parseInt(page, 10) || 1),
        limit: Math.min(Math.max(Number(limit) || 100, 1), 500)
      };
      setAnalyticsCache(cacheKey, emptyResult,generation);
      return emptyResult;
    }
    const placeholders = matchedIds.map(() => '?').join(',');
    whereClauses.push(`p.project_id IN (${placeholders})`);
    params.push(...matchedIds);
  }

  const sqlWhere = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Rental headline summaries use the selected month window.
  const endMonth = effectiveDateTo.substring(0, 7);

  const summaryWhereClauses = [...whereClauses];
  const summaryParams = [...params];
  summaryWhereClauses[0] = 'substr(r.lease_date,1,7) >= ? AND substr(r.lease_date,1,7) <= ?';
  summaryParams[0] = effectiveDateFrom.substring(0,7);
  summaryParams[1] = endMonth;
  const summarySqlWhere = 'WHERE ' + summaryWhereClauses.join(' AND ');

  const [countRow, summaryRow, matchingSaleStats, timeSeriesRows, bedroomRows, caveats, mapRows] = await Promise.all([
    // 1. Total Count
    dbGet(
      `SELECT COUNT(*) as totalCount
       FROM rental_transactions r
       JOIN projects p INDEXED BY idx_projects_filter_cover ON r.project_id = p.project_id
       ${sqlWhere}`,
      params
    ),

    medianOne(`SELECT COUNT(*) AS total_count,MIN(r.rent_sgd) AS min_rent,MAX(r.rent_sgd) AS max_rent,
      COUNT(CASE WHEN r.rent_psft>0 THEN 1 END) AS psft_count,
      GROUP_CONCAT(CASE WHEN r.rent_sgd IS NOT NULL THEN printf('%!.17g',r.rent_sgd) END) AS rents,
      GROUP_CONCAT(CASE WHEN r.rent_psft>0 THEN printf('%!.17g',r.rent_psft) END) AS psft_values,
      GROUP_CONCAT(CASE WHEN r.rent_psft>0 AND r.rent_psqm IS NOT NULL THEN printf('%!.17g',r.rent_psqm) END) AS psqm_values
      FROM rental_transactions r JOIN projects p INDEXED BY idx_projects_filter_cover ON r.project_id=p.project_id ${summarySqlWhere}`,summaryParams,
      [{source:'rents',count:'total_count',target:'median_rent',digits:0},{source:'psft_values',count:'psft_count',target:'median_rent_psft',digits:2},{source:'psqm_values',count:'psft_count',target:'median_rent_psqm',digits:2}]),

    matchedSaleValuations({ ...filters, propertyType, dateTo: effectiveDateTo }),

    // 3. Time Series Monthly Breakdown
    dbAll(
      `SELECT substr(r.lease_date,1,7) as month,
              COUNT(*) as count,
              ROUND(AVG(r.rent_sgd)) as avgRent,
              ROUND(AVG(r.rent_psft), 2) as avgRentPsft
       FROM rental_transactions r
       JOIN projects p INDEXED BY idx_projects_filter_cover ON r.project_id = p.project_id
       ${sqlWhere}
       GROUP BY substr(r.lease_date,1,7)
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
       JOIN projects p INDEXED BY idx_projects_filter_cover ON r.project_id = p.project_id
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
       JOIN projects p INDEXED BY idx_projects_filter_cover ON r.project_id = p.project_id
       ${sqlWhere}
       ORDER BY r.lease_date DESC, r.rental_id DESC
       LIMIT ? OFFSET ?`,
      [...params, sanitizedLimit, offset]
    ),

    medianRows(`WITH aggregates AS (
      SELECT r.project_id,COUNT(*) AS txCount,COUNT(CASE WHEN r.rent_psft>0 THEN 1 END) AS usableRentalCount,
        GROUP_CONCAT(CASE WHEN r.rent_sgd IS NOT NULL THEN printf('%!.17g',r.rent_sgd) END) AS rents,
        GROUP_CONCAT(CASE WHEN r.rent_psft>0 THEN printf('%!.17g',r.rent_psft) END) AS psft_values
      FROM rental_transactions r JOIN projects p INDEXED BY idx_projects_filter_cover ON r.project_id=p.project_id ${sqlWhere} GROUP BY r.project_id)
      SELECT p.project_id AS id,p.project_name AS name,p.street_name AS street,p.postal_district AS district,
        p.market_segment AS segment,p.planning_area AS planningArea,p.latitude AS lat,p.longitude AS lng,
        p.geo_source AS locationQuality,p.livability_score AS livabilityScore,
        CASE WHEN json_valid(p.livability_data) THEN json_object('subScores',json_extract(p.livability_data,'$.subScores')) END AS livabilityData,
        a.txCount,a.usableRentalCount,a.rents,a.psft_values
      FROM aggregates a JOIN projects p INDEXED BY idx_projects_filter_cover ON a.project_id=p.project_id`,params,
      [{source:'rents',count:'txCount',target:'medianRent',digits:0},{source:'psft_values',count:'usableRentalCount',target:'medianRentPsft',digits:2}])

  ]);

  const medianRentPsft = summaryRow?.median_rent_psft ?? null;

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
    bedroom: b.bedroom, count: b.count, avgRent: b.avgRent, avgPsft: b.avgPsft,
    avgYield: null, yieldReason: 'No bedroom-matched sales field is available.'
  }));
  const rentalSamples = new Map(mapRows.map(p => [p.id, p.usableRentalCount]));
  const benchmarkWindow = saleWindow(effectiveDateTo);
  const metricContract = {version: 'phase2-v1', formula: 'median rent psf * 12 / median sale psf * 100',
    aggregation: 'median of eligible project yields', minimumSales: 3, minimumUsableRentals: 3,
    rentalWindow: {dateFrom: effectiveDateFrom.slice(0,7), dateTo: endMonth}, saleWindow: benchmarkWindow,
    matching: 'same project, property type, tenure and unit-size filters; bedrooms and rent-price filters apply to rentals only',
    areaMethod: 'rental area-band midpoint estimate; open-ended bands excluded from psf estimates'};
  const rentalCaveats = caveats.map(r => {
    const val = matchingSaleStats.get(r.projectId);
    const annualRentPsft = r.rentPsft ? r.rentPsft * 12 : null;
    const grossYield = projectYield(r.rentPsft, rentalSamples.get(r.projectId), val);
    const estimatedSalePrice = (r.areaSqft && val?.medianPsft)
      ? Math.round(r.areaSqft * val.medianPsft)
      : null;
    return {
      ...r,
      estimatedSaleValuation: estimatedSalePrice,
      saleBenchmark: val || { ...benchmarkWindow, saleCount: 0, medianPsft: null },
      usableRentalCount: rentalSamples.get(r.projectId) || 0,
      grossYield
    };
  });

  const projectYields = [];
  const mapProjects = mapRows.map(p => {
    const val = matchingSaleStats.get(p.id) || { ...benchmarkWindow, saleCount: 0, medianPrice: null, medianPsft: null };
    const grossYield = projectYield(p.medianRentPsft, p.usableRentalCount, val);

    // Option A: Only include projects with >= 3 transactions in the window for median headline calculation
    if (grossYield !== null && isFinite(grossYield) && grossYield > 0) {
      projectYields.push(grossYield);
    }

    // Step 3.1: Synchronous livability score derivation without distance scans
    let livScore = p.livabilityScore;
    if (p.locationQuality === 'district_centre' || !p.lat || !p.lng) {
      livScore = null;
    }

    let livSubScores = { mrt: null, school: null, hawker: null, supermarket: null, park: null };
    let livNearest = {};

    if (p.livabilityData && p.locationQuality !== 'district_centre' && p.lat && p.lng) {
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
      planningArea: formatPlanningAreaFallback(p.planningArea, p.district),
      segment: p.segment,
      lat: p.lat,
      lng: p.lng,
      txCount: p.txCount,
      medianRent: p.medianRent,
      medianRentPsft: p.medianRentPsft,
      medianSaleValuation: val.medianPrice,
      medianSalePsft: val.medianPsft,
      saleBenchmark: val,
      usableRentalCount: p.usableRentalCount,
      grossYield,
      locationQuality: p.locationQuality,
      livability: {
        score: livScore,
        label: getGradeLabel(livScore, p.locationQuality),
        color: getGradeColor(livScore),
        subScores: livSubScores,
        nearest: {}
      }
    };
  });

  // Option A (Approved): Headline gross yield is the median of development-level gross yields
  let avgGrossYield = null;
  if (projectYields.length > 0) {
    projectYields.sort((a, b) => a - b);
    const mid = Math.floor(projectYields.length / 2);
    const medianYield = projectYields.length % 2 !== 0
      ? projectYields[mid]
      : (projectYields[mid - 1] + projectYields[mid]) / 2;
    avgGrossYield = parseFloat(medianYield.toFixed(2));
  }

  const summary = {
    medianRent: summaryRow?.median_rent ?? null,
    medianRentPsft,
    medianRentPsqm: summaryRow?.median_rent_psqm ?? null,
    avgGrossYield,
    grossYieldPct: avgGrossYield,
    yieldSampleProjects: projectYields.length,
    totalLeases: summaryRow?.total_count || 0,
    rentMinMaxRange: { min: summaryRow?.min_rent || 0, max: summaryRow?.max_rent || 0 }
  };

  const result = {
    summary,
    timeSeries,
    bedroomBreakdown,
    rentalCaveats,
    scatter: rentalCaveats,
    mapProjects,
    metricContract,
    totalCount: countRow?.totalCount || 0,
    page: sanitizedPage,
    limit: sanitizedLimit,
    totalPages: Math.ceil((countRow?.totalCount || 0) / sanitizedLimit)
  };

  setAnalyticsCache(cacheKey, result,generation);
  return result;
}

// 5. Get all projects overview for map initialize (Step 3.1 & 3.3.4)
async function calculateAllProjects(lifestyleWeights = null,generation=analyticsGeneration) {
  await syncCacheWithDataVersion();
  await ensureValuations();
  const cacheKey = normalizeAnalyticsCacheKey('allProjects',{lifestyleWeights});
  const cachedData = getAnalyticsCache(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  // Reads pre-computed benchmarks and livability directly in one lightning-fast query (< 10ms)
  const projects = await dbAll(
    `SELECT p.project_id as id, p.project_name as name, p.street_name as street, p.postal_district as district,
            p.market_segment as segment, p.planning_area as planningArea, p.latitude as lat, p.longitude as lng,
            p.geo_source as locationQuality,
            p.livability_score as livabilityScore, CASE WHEN json_valid(p.livability_data) THEN json_object('subScores',json_extract(p.livability_data,'$.subScores')) END AS livabilityData,
            p.tenure_class as tenureClass,
            COALESCE(b.sale_count, 0) as txCount,
            CASE WHEN b.sale_count >= 3 THEN b.rolling_24m_median_psft END as avgPsft,
            CASE WHEN b.sale_count >= 3 THEN b.rolling_24m_median_price END as medianPrice
     FROM projects p
     LEFT JOIN project_benchmarks b ON p.project_id = b.project_id
     WHERE p.is_landed_aggregate = 0 AND NOT EXISTS (SELECT 1 FROM project_identity_review q WHERE q.project_id=p.project_id AND q.status='pending')`
  );

  const result = projects.map(p => {
    const currentValuation = saleValuationsCache.get(p.id);
    let livScore = p.livabilityScore;
    if (p.locationQuality === 'district_centre' || !p.lat || !p.lng) {
      livScore = null;
    }
    let subScores = { mrt: null, school: null, hawker: null, supermarket: null, park: null };

    if (p.livabilityData && p.locationQuality !== 'district_centre' && p.lat && p.lng) {
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
      planningArea: formatPlanningAreaFallback(p.planningArea, p.district),
      lat: p.lat,
      lng: p.lng,
      locationQuality: p.locationQuality,
      txCount: currentValuation?.saleCount || 0,
      avgPsft: currentValuation?.medianPsft ?? null,
      medianPrice: currentValuation?.medianPrice ?? null,
      tenureClass: p.tenureClass,
      livability: {
        score: livScore,
        label: getGradeLabel(livScore, p.locationQuality),
        color: getGradeColor(livScore),
        subScores
      }
    };
  });

  setAnalyticsCache(cacheKey, result,generation);
  return result;
}

export function getPriceAnalytics(filters={}) {return queryOnce('price',filters,generation=>calculatePriceAnalytics(filters,generation));}
export function getRentalYieldAnalytics(filters={}) {return queryOnce('rental',filters,generation=>calculateRentalAnalytics(filters,generation));}
export function getAllProjects(lifestyleWeights=null) {return queryOnce('allProjects',{lifestyleWeights},generation=>calculateAllProjects(lifestyleWeights,generation));}
