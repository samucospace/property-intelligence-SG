import { dbAll, dbGet } from './db.js';
import { calculateLivabilityScore } from './livabilityEngine.js';

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
  const {
    projects = [],
    street = null,
    district = null,
    planningArea = null,
    radiusKm = null,
    centerCoords = null,
    dateFrom = '2021-01-01',
    dateTo = '2026-12-31',
    unitSizeMin = 0,
    unitSizeMax = 10000,
    unitType = 'sqft',
    priceMin = null,
    priceMax = null,
    tenure = 'all',
    lifestyleWeights = null
  } = filters;

  // Calculate size in SQM for SQL filtering (stored in SQM)
  const sizeMinSqm = unitType === 'sqft' ? unitSizeMin / 10.7639 : unitSizeMin;
  const sizeMaxSqm = unitType === 'sqft' ? unitSizeMax / 10.7639 : unitSizeMax;

  let whereClauses = ['t.contract_date >= ? AND t.contract_date <= ?', 't.area_sqm >= ? AND t.area_sqm <= ?'];
  let params = [dateFrom, dateTo, sizeMinSqm, sizeMaxSqm];

  // Specific project names
  if (Array.isArray(projects) && projects.length > 0) {
    const placeholders = projects.map(() => '?').join(',');
    whereClauses.push(`p.project_name IN (${placeholders})`);
    params.push(...projects);
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

  const sqlWhere = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Retrieve raw transaction entries joined with project lat/lng
  const rawTx = await dbAll(
    `SELECT t.transaction_id, t.contract_date, t.price_sgd, t.area_sqm, t.area_sqft, t.psqm_sgd, t.psft_sgd, t.floor_range, t.type_of_sale, t.tenure,
            p.project_id, p.project_name, p.street_name, p.postal_district, p.planning_area, p.market_segment, p.latitude, p.longitude
     FROM property_transactions t
     JOIN projects p ON t.project_id = p.project_id
     ${sqlWhere}
     ORDER BY t.contract_date ASC`,
    params
  );

  // Apply Haversine radius filter if specified
  let filteredTx = rawTx;
  if (radiusKm && centerCoords && centerCoords.lat && centerCoords.lng) {
    const lat = parseFloat(centerCoords.lat);
    const lng = parseFloat(centerCoords.lng);
    const maxRadius = parseFloat(radiusKm);

    filteredTx = rawTx.filter(tx => {
      if (!tx.latitude || !tx.longitude) return false;
      const dist = haversineDistance(lat, lng, tx.latitude, tx.longitude);
      return dist <= maxRadius;
    });
  }

  // Compute Metrics Summary Cards: strictly for the past 24 months
  let summary = {
    totalVolume: 0,
    medianPrice: 0,
    medianPsqm: 0,
    medianPsft: 0,
    minPrice: 0,
    maxPrice: 0,
    averagePrice: 0
  };

  if (filteredTx.length > 0) {
    // Determine cutoff date for the past 24 months relative to latest transaction in result set
    const latestDate = filteredTx.reduce(
      (max, t) => (t.contract_date > max ? t.contract_date : max),
      filteredTx[0].contract_date
    );
    const d = new Date(latestDate);
    d.setFullYear(d.getFullYear() - 2);
    const cutoffDate = d.toISOString().slice(0, 10);
    const past24mTx = filteredTx.filter(t => t.contract_date >= cutoffDate);
    const headlineTx = past24mTx.length > 0 ? past24mTx : filteredTx;

    const sortedPrices = [...headlineTx].map(t => t.price_sgd).sort((a, b) => a - b);
    const sortedPsqm = [...headlineTx].map(t => t.psqm_sgd).sort((a, b) => a - b);
    const sortedPsft = [...headlineTx].map(t => t.psft_sgd).sort((a, b) => a - b);

    const mid = Math.floor(sortedPrices.length / 2);
    summary.totalVolume = headlineTx.length;
    summary.medianPrice = sortedPrices.length % 2 !== 0 ? sortedPrices[mid] : (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;
    summary.medianPsqm = sortedPsqm.length % 2 !== 0 ? sortedPsqm[mid] : (sortedPsqm[mid - 1] + sortedPsqm[mid]) / 2;
    summary.medianPsft = sortedPsft.length % 2 !== 0 ? sortedPsft[mid] : (sortedPsft[mid - 1] + sortedPsft[mid]) / 2;
    summary.minPrice = sortedPrices[0];
    summary.maxPrice = sortedPrices[sortedPrices.length - 1];
    summary.averagePrice = sortedPrices.reduce((sum, p) => sum + p, 0) / sortedPrices.length;
  }

  // Time-series trend grouping (Monthly proportional scale)
  let timeSeries = [];
  if (filteredTx.length > 0) {
    const monthlyMap = new Map();
    filteredTx.forEach(tx => {
      const monthKey = tx.contract_date.substring(0, 7);
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { month: monthKey, psqmList: [], psftList: [], priceList: [] });
      }
      const item = monthlyMap.get(monthKey);
      item.psqmList.push(tx.psqm_sgd);
      item.psftList.push(tx.psft_sgd);
      item.priceList.push(tx.price_sgd);
    });

    const startMonth = (dateFrom || '2021-01-01').substring(0, 7);
    const endMonth = (dateTo || '2026-12-31').substring(0, 7);
    const allMonths = generateMonthRange(startMonth, endMonth);

    timeSeries = allMonths.map(mKey => {
      const data = monthlyMap.get(mKey);

      if (!data || data.psqmList.length === 0) {
        return {
          period: mKey,
          volume: 0,
          medianPsqm: null,
          avgPsqm: null,
          medianPsft: null,
          avgPsft: null,
          medianPrice: null
        };
      }

      const sPsqm = [...data.psqmList].sort((a, b) => a - b);
      const sPsft = [...data.psftList].sort((a, b) => a - b);
      const sPrice = [...data.priceList].sort((a, b) => a - b);
      const mid = Math.floor(sPsqm.length / 2);

      return {
        period: mKey,
        volume: data.psqmList.length,
        medianPsqm: Math.round(sPsqm.length % 2 !== 0 ? sPsqm[mid] : (sPsqm[mid - 1] + sPsqm[mid]) / 2),
        avgPsqm: Math.round(sPsqm.reduce((a, b) => a + b, 0) / sPsqm.length),
        medianPsft: Math.round(sPsft.length % 2 !== 0 ? sPsft[mid] : (sPsft[mid - 1] + sPsft[mid]) / 2),
        avgPsft: Math.round(sPsft.reduce((a, b) => a + b, 0) / sPsft.length),
        medianPrice: Math.round(sPrice.length % 2 !== 0 ? sPrice[mid] : (sPrice[mid - 1] + sPrice[mid]) / 2)
      };
    });
  }

  // Floor tier scatter plot points
  const scatterPoints = filteredTx.slice(-200).map(t => ({
    id: t.transaction_id,
    date: t.contract_date,
    floorRange: t.floor_range || 'Unknown',
    priceSgd: t.price_sgd,
    psqm: Math.round(t.psqm_sgd),
    psft: Math.round(t.psft_sgd),
    areaSqm: t.area_sqm,
    areaSqft: Math.round(t.area_sqft),
    projectName: t.project_name,
    typeOfSale: t.type_of_sale,
    projectId: t.project_id
  }));

  // Distinct Developments for Map display
  const mapProjectsMap = new Map();
  filteredTx.forEach(t => {
    if (!mapProjectsMap.has(t.project_id)) {
      mapProjectsMap.set(t.project_id, {
        id: t.project_id,
        name: t.project_name,
        street: t.street_name,
        district: t.postal_district,
        planningArea: t.planning_area,
        segment: t.market_segment,
        lat: t.latitude,
        lng: t.longitude,
        psqmList: [],
        psftList: []
      });
    }
    const item = mapProjectsMap.get(t.project_id);
    item.psqmList.push(t.psqm_sgd);
    item.psftList.push(t.psft_sgd);
  });

  // Pre-fetch all amenities once for in-memory spatial scoring
  const allAmenities = await dbAll(`SELECT amenity_id, category, name, latitude as latitude, longitude as longitude, details FROM amenities`);

  const mapProjectsList = Array.from(mapProjectsMap.values());
  const mapProjects = await Promise.all(mapProjectsList.map(async p => {
    const sPsqm = [...p.psqmList].sort((a, b) => a - b);
    const sPsft = [...p.psftList].sort((a, b) => a - b);
    const mid = Math.floor(sPsqm.length / 2);

    const livability = await calculateLivabilityScore(p.lat, p.lng, lifestyleWeights, allAmenities);

    return {
      id: p.id,
      name: p.name,
      street: p.street,
      district: p.district,
      planningArea: p.planningArea,
      segment: p.segment,
      lat: p.lat,
      lng: p.lng,
      txCount: p.psqmList.length,
      medianPsqm: Math.round(sPsqm.length % 2 !== 0 ? sPsqm[mid] : (sPsqm[mid - 1] + sPsqm[mid]) / 2),
      medianPsft: Math.round(sPsft.length % 2 !== 0 ? sPsft[mid] : (sPsft[mid - 1] + sPsft[mid]) / 2),
      livability
    };
  }));

  return {
    summary,
    timeSeries,
    scatterPoints,
    mapProjects
  };
}

// 4. Rental & Gross Rental Yield Analytics Engine
export async function getRentalYieldAnalytics(filters = {}) {
  const {
    projects = [],
    street = null,
    district = null,
    planningArea = null,
    radiusKm = null,
    centerCoords = null,
    dateFrom = '2021-01-01',
    dateTo = '2026-12-31',
    bedroomCount = null,
    unitSizeMin = 0,
    unitSizeMax = 10000,
    unitType = 'sqft',
    priceMin = null,
    priceMax = null,
    tenure = 'all',
    lifestyleWeights = null
  } = filters;

  const sizeMinSqm = unitType === 'sqft' ? unitSizeMin / 10.7639 : unitSizeMin;
  const sizeMaxSqm = unitType === 'sqft' ? unitSizeMax / 10.7639 : unitSizeMax;

  let whereClauses = ['r.lease_date >= ? AND r.lease_date <= ?', 'r.area_sqm >= ? AND r.area_sqm <= ?'];
  let params = [dateFrom.substring(0, 7), dateTo.substring(0, 7), sizeMinSqm, sizeMaxSqm];

  if (Array.isArray(projects) && projects.length > 0) {
    const placeholders = projects.map(() => '?').join(',');
    whereClauses.push(`UPPER(p.project_name) IN (${placeholders})`);
    params.push(...projects.map(p => String(p).toUpperCase()));
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

  // Tenure filter for rental transactions (Freehold vs Leasehold)
  if (tenure === 'freehold') {
    whereClauses.push(`EXISTS (SELECT 1 FROM property_transactions pt WHERE pt.project_id = p.project_id AND (UPPER(pt.tenure) LIKE '%FREEHOLD%' OR pt.tenure LIKE '999%' OR pt.tenure LIKE '9999%' OR pt.tenure LIKE '999999%' OR pt.tenure LIKE '956%' OR pt.tenure LIKE '947%' OR pt.tenure LIKE '946%' OR pt.tenure LIKE '929%' OR pt.tenure LIKE '993%'))`);
  } else if (tenure === 'leasehold') {
    whereClauses.push(`NOT EXISTS (SELECT 1 FROM property_transactions pt WHERE pt.project_id = p.project_id AND (UPPER(pt.tenure) LIKE '%FREEHOLD%' OR pt.tenure LIKE '999%' OR pt.tenure LIKE '9999%' OR pt.tenure LIKE '999999%' OR pt.tenure LIKE '956%' OR pt.tenure LIKE '947%' OR pt.tenure LIKE '946%' OR pt.tenure LIKE '929%' OR pt.tenure LIKE '993%'))`);
  }

  const sql = `
    SELECT r.rental_id, r.project_id, r.area_sqm, r.area_sqft, r.rent_sgd, r.rent_psqm, r.rent_psft,
           r.lease_date, r.bedroom_count, r.floor_area_range, r.property_type,
           p.project_name, p.street_name, p.postal_district, p.market_segment, p.planning_area,
           p.latitude, p.longitude
    FROM rental_transactions r
    JOIN projects p ON r.project_id = p.project_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY r.lease_date DESC
  `;

  let rows = await dbAll(sql, params);

  // Apply Haversine radius filter if active
  if (radiusKm && centerCoords && centerCoords.lat && centerCoords.lng) {
    rows = rows.filter(r => {
      if (!r.latitude || !r.longitude) return false;
      const d = haversineDistance(centerCoords.lat, centerCoords.lng, r.latitude, r.longitude);
      return d <= radiusKm;
    });
  }

  if (rows.length === 0) {
    return {
      summary: {
        medianRent: 0,
        medianRentPsft: 0,
        medianRentPsqm: 0,
        avgGrossYield: 0,
        totalLeases: 0,
        rentMinMaxRange: { min: 0, max: 0 }
      },
      timeSeries: [],
      bedroomBreakdown: [],
      rentalCaveats: [],
      mapProjects: []
    };
  }

  // Calculate Median Sale Prices & PSFT per Project for Yield Computations
  const saleValuationsMap = new Map();
  const salesRows = await dbAll(
    `SELECT project_id, price_sgd, psft_sgd FROM property_transactions`
  );
  salesRows.forEach(s => {
    if (!saleValuationsMap.has(s.project_id)) {
      saleValuationsMap.set(s.project_id, { prices: [], psfts: [] });
    }
    const item = saleValuationsMap.get(s.project_id);
    if (s.price_sgd) item.prices.push(s.price_sgd);
    if (s.psft_sgd) item.psfts.push(s.psft_sgd);
  });

  const getProjectSaleValuation = (projId, marketSeg) => {
    const data = saleValuationsMap.get(projId);
    if (data && data.prices.length > 0) {
      const sortedPrices = [...data.prices].sort((a, b) => a - b);
      const sortedPsfts = [...data.psfts].sort((a, b) => a - b);
      const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];
      const medianPsft = sortedPsfts.length > 0 ? sortedPsfts[Math.floor(sortedPsfts.length / 2)] : 1600;
      return { medianPrice, medianPsft };
    }
    // Fallback baseline valuation estimates by segment
    const medianPrice = marketSeg === 'CCR' ? 2400000 : marketSeg === 'RCR' ? 1650000 : 1250000;
    const medianPsft = marketSeg === 'CCR' ? 2200 : marketSeg === 'RCR' ? 1650 : 1300;
    return { medianPrice, medianPsft };
  };

  // Restrict headline summary metrics to past 24 months
  let headlineRows = rows;
  if (rows.length > 0) {
    const latestLease = rows.reduce(
      (max, r) => (r.lease_date > max ? r.lease_date : max),
      rows[0].lease_date
    );
    const [yr, mo] = latestLease.split('-').map(Number);
    const cutoffLease = `${yr - 2}-${String(mo).padStart(2, '0')}`;
    const past24mRows = rows.filter(r => r.lease_date >= cutoffLease);
    if (past24mRows.length > 0) {
      headlineRows = past24mRows;
    }
  }

  const headlineRentsSgd = headlineRows.map(r => r.rent_sgd).sort((a, b) => a - b);
  const headlineRentsPsft = headlineRows.map(r => r.rent_psft).sort((a, b) => a - b);
  const headlineRentsPsqm = headlineRows.map(r => r.rent_psqm).sort((a, b) => a - b);
  const hMid = Math.floor(headlineRentsSgd.length / 2);

  const medianRent = headlineRentsSgd.length % 2 !== 0 ? headlineRentsSgd[hMid] : Math.round((headlineRentsSgd[hMid - 1] + headlineRentsSgd[hMid]) / 2);
  const medianRentPsft = headlineRentsPsft.length % 2 !== 0 ? headlineRentsPsft[hMid] : parseFloat(((headlineRentsPsft[hMid - 1] + headlineRentsPsft[hMid]) / 2).toFixed(2));
  const medianRentPsqm = headlineRentsPsqm.length % 2 !== 0 ? headlineRentsPsqm[hMid] : parseFloat(((headlineRentsPsqm[hMid - 1] + headlineRentsPsqm[hMid]) / 2).toFixed(2));

  // Compute Individual Lease Caveats & Estimated Gross Yield
  const rentalCaveats = rows.map(r => {
    const val = getProjectSaleValuation(r.project_id, r.market_segment);
    // Gross Yield = (Annual Rent per sqft / Sale Price per sqft) * 100
    const annualRentPsft = r.rent_psft * 12;
    const grossYield = parseFloat(((annualRentPsft / val.medianPsft) * 100).toFixed(2));
    const estimatedSalePrice = Math.round(r.area_sqft * val.medianPsft);

    return {
      rentalId: r.rental_id,
      projectName: r.project_name,
      streetName: r.street_name,
      district: r.postal_district,
      leaseDate: r.lease_date,
      rentSgd: r.rent_sgd,
      rentPsft: r.rent_psft,
      rentPsqm: r.rent_psqm,
      areaSqft: r.area_sqft,
      areaSqm: r.area_sqm,
      bedroomCount: r.bedroom_count || 'Unspecified',
      floorAreaRange: r.floor_area_range || `${Math.round(r.area_sqft)} sqft`,
      estimatedSaleValuation: estimatedSalePrice,
      grossYield
    };
  });

  const headlineLeaseIds = new Set(headlineRows.map(h => h.rental_id));
  const headlineCaveats = rentalCaveats.filter(r => headlineLeaseIds.has(r.rentalId));
  const targetCaveats = headlineCaveats.length > 0 ? headlineCaveats : rentalCaveats;
  const totalYieldSum = targetCaveats.reduce((sum, r) => sum + r.grossYield, 0);
  const avgGrossYield = parseFloat((totalYieldSum / targetCaveats.length).toFixed(2));

  // Bedroom Breakdown Aggregation
  const bedroomGroups = new Map();
  rentalCaveats.forEach(r => {
    const b = r.bedroomCount;
    if (!bedroomGroups.has(b)) {
      bedroomGroups.set(b, { count: 0, rentSum: 0, yieldSum: 0, psftSum: 0 });
    }
    const item = bedroomGroups.get(b);
    item.count += 1;
    item.rentSum += r.rentSgd;
    item.yieldSum += r.grossYield;
    item.psftSum += r.rentPsft;
  });

  const bedroomBreakdown = Array.from(bedroomGroups.entries()).map(([bedroom, stats]) => ({
    bedroom,
    count: stats.count,
    avgRent: Math.round(stats.rentSum / stats.count),
    avgYield: parseFloat((stats.yieldSum / stats.count).toFixed(2)),
    avgPsft: parseFloat((stats.psftSum / stats.count).toFixed(2))
  })).sort((a, b) => a.bedroom.localeCompare(b.bedroom));

  // Time Series Aggregation by Month (Proportional timeline)
  const timeMap = new Map();
  rentalCaveats.forEach(r => {
    const m = r.leaseDate;
    if (!timeMap.has(m)) {
      timeMap.set(m, { rentSum: 0, psftSum: 0, count: 0 });
    }
    const t = timeMap.get(m);
    t.rentSum += r.rentSgd;
    t.psftSum += r.rentPsft;
    t.count += 1;
  });

  const startMonth = (dateFrom || '2021-01-01').substring(0, 7);
  const endMonth = (dateTo || '2026-12-31').substring(0, 7);
  const allMonths = generateMonthRange(startMonth, endMonth);

  const timeSeries = allMonths.map(month => {
    const data = timeMap.get(month);
    if (!data || data.count === 0) {
      return {
        month,
        avgRent: null,
        avgRentPsft: null,
        count: 0
      };
    }
    return {
      month,
      avgRent: Math.round(data.rentSum / data.count),
      avgRentPsft: parseFloat((data.psftSum / data.count).toFixed(2)),
      count: data.count
    };
  });

  // Map Projects Aggregation with Gross Yield & Rental Rates
  const mapProjectsMap = new Map();
  rows.forEach(r => {
    if (!mapProjectsMap.has(r.project_id)) {
      mapProjectsMap.set(r.project_id, {
        id: r.project_id,
        name: r.project_name,
        street: r.street_name,
        district: r.postal_district,
        planningArea: r.planning_area,
        segment: r.market_segment,
        lat: r.latitude,
        lng: r.longitude,
        rents: [],
        psfts: []
      });
    }
    const p = mapProjectsMap.get(r.project_id);
    p.rents.push(r.rent_sgd);
    p.psfts.push(r.rent_psft);
  });

  const allAmenities = await dbAll(`SELECT amenity_id, category, name, latitude as latitude, longitude as longitude, details FROM amenities`);

  const mapProjects = await Promise.all(Array.from(mapProjectsMap.values()).map(async p => {
    const sortedRents = [...p.rents].sort((a, b) => a - b);
    const sortedPsfts = [...p.psfts].sort((a, b) => a - b);
    const mIndex = Math.floor(sortedRents.length / 2);
    const projMedianRent = sortedRents[mIndex];
    const projMedianPsft = sortedPsfts[mIndex];
    const val = getProjectSaleValuation(p.id, p.segment);
    const grossYield = parseFloat(((projMedianPsft * 12 / val.medianPsft) * 100).toFixed(2));
    const livability = await calculateLivabilityScore(p.lat, p.lng, lifestyleWeights, allAmenities);

    return {
      id: p.id,
      name: p.name,
      street: p.street,
      district: p.district,
      planningArea: p.planningArea,
      segment: p.segment,
      lat: p.lat,
      lng: p.lng,
      txCount: p.rents.length,
      medianRent: projMedianRent,
      medianRentPsft: projMedianPsft,
      medianSaleValuation: val.medianPrice,
      grossYield,
      livability
    };
  }));

  return {
    summary: {
      medianRent,
      medianRentPsft,
      medianRentPsqm,
      avgGrossYield,
      totalLeases: headlineRows.length,
      rentMinMaxRange: { min: headlineRentsSgd[0], max: headlineRentsSgd[headlineRentsSgd.length - 1] }
    },
    timeSeries,
    bedroomBreakdown,
    rentalCaveats,
    mapProjects
  };
}

// 5. Get all projects overview for map initialize
export async function getAllProjects(lifestyleWeights = null) {
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

  const allAmenities = await dbAll(`SELECT amenity_id, category, name, latitude as latitude, longitude as longitude, details FROM amenities`);

  return await Promise.all(projects.map(async p => {
    const livability = await calculateLivabilityScore(p.lat, p.lng, lifestyleWeights, allAmenities);
    return {
      ...p,
      livability
    };
  }));
}

