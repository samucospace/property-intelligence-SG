import axios from 'axios';
import crypto from 'crypto';
import { dbRun, dbGet, dbAll, createConnection, withTransaction } from './db.js';
import { generateRentalQuarters } from './utils/dateUtils.js';
import { normalizeStreetName, isLandedDevelopment } from './utils/streetUtils.js';

// Helper: MD5 Hash for deterministic transaction deduplication (Step 2.5: includes occurrenceIndex and all key fields)
export function generateTxHash(projName, dateStr, price, area, floorRange, occurrenceIndex = 1, noOfUnits = 1, propertyType = '', district = '') {
  const raw = `${projName}|${dateStr}|${price}|${area}|${floorRange || ''}|${occurrenceIndex}|${noOfUnits}|${propertyType || ''}|${district || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

// Helper: MD5 Hash for rental transaction deduplication
export function generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex = 1, district = '') {
  const raw = `URA_RENT|${projName}|${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}|${occurrenceIndex}|${district || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

// 1. Precise SVY21 (Singapore Transverse Mercator) to WGS84 (Lat/Lng) Math Converter
function calcM(lat, a, e2, e4, e6) {
  return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat -
              (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat) +
              (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat) -
              (35 * e6 / 3072) * Math.sin(6 * lat));
}

export function svy21ToWgs84(N, E) {
  if (!N || !E || isNaN(N) || isNaN(E)) return null;

  const rad = Math.PI / 180;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const oLat = 1.366666666666667 * rad;
  const oLon = 103.83333333333333 * rad;
  const oN = 38744.572;
  const oE = 28001.642;
  const k = 1.0;

  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const Mo = calcM(oLat, a, e2, e4, e6);
  const M = Mo + (N - oN) / k;
  const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = (e2 / (1 - e2)) * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = (E - oE) / (N1 * k);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D * D * D * D / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) * D * D * D * D * D * D / 720);
  const lon = oLon + (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) * D * D * D * D * D / 120) / cosPhi1;

  return {
    latitude: parseFloat((lat / rad).toFixed(6)),
    longitude: parseFloat((lon / rad).toFixed(6))
  };
}

// Postal District Center Coordinates Fallback Lookup (Approximate centroids for districts 01-28)
const districtCenters = {
  "01": { lat: 1.2801, lng: 103.8540 },
  "02": { lat: 1.2764, lng: 103.8447 },
  "03": { lat: 1.2880, lng: 103.8200 },
  "04": { lat: 1.2655, lng: 103.8118 },
  "05": { lat: 1.2980, lng: 103.7650 },
  "06": { lat: 1.2912, lng: 103.8436 },
  "07": { lat: 1.3000, lng: 103.8550 },
  "08": { lat: 1.3120, lng: 103.8530 },
  "09": { lat: 1.3030, lng: 103.8340 },
  "10": { lat: 1.3138, lng: 103.7824 },
  "11": { lat: 1.3180, lng: 103.8420 },
  "12": { lat: 1.3280, lng: 103.8520 },
  "13": { lat: 1.3350, lng: 103.8700 },
  "14": { lat: 1.3180, lng: 103.8920 },
  "15": { lat: 1.2995, lng: 103.8996 },
  "16": { lat: 1.3068, lng: 103.9372 },
  "17": { lat: 1.3500, lng: 103.9700 },
  "18": { lat: 1.3732, lng: 103.9493 },
  "19": { lat: 1.3850, lng: 103.8950 },
  "20": { lat: 1.3524, lng: 103.8415 },
  "21": { lat: 1.3400, lng: 103.7700 },
  "22": { lat: 1.3380, lng: 103.7050 },
  "23": { lat: 1.3650, lng: 103.7450 },
  "24": { lat: 1.3900, lng: 103.7000 },
  "25": { lat: 1.4350, lng: 103.7860 },
  "26": { lat: 1.3950, lng: 103.8250 },
  "27": { lat: 1.4250, lng: 103.8350 },
  "28": { lat: 1.4050, lng: 103.8700 }
};

/**
 * Validates and normalizes postal district to 2-digit format ('01' - '28').
 * Returns null for invalid or segment codes (e.g. '00', 'CCR', 'RCR', 'OCR').
 * @param {string|number} val
 * @returns {string|null}
 */
export function cleanPostalDistrict(val) {
  if (!val) return null;
  const s = String(val).trim();
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 1 && num <= 28) {
    return String(num).padStart(2, '0');
  }
  return null;
}

/**
 * Resolves canonical postal district from transaction-level or project-level records.
 * Uses the most frequent valid district ('01'-'28') across all transactions.
 * @param {object} rawProj
 * @returns {string|null}
 */
export function resolveProjectDistrict(rawProj) {
  const districtCounts = new Map();
  const txList = rawProj.transaction || rawProj.transactions || rawProj.rental || rawProj.rentals || [];
  for (const item of txList) {
    const d = cleanPostalDistrict(item.district || item.postal_district);
    if (d) {
      districtCounts.set(d, (districtCounts.get(d) || 0) + 1);
    }
  }

  const projD = cleanPostalDistrict(rawProj.district || rawProj.postal_district);
  if (projD) {
    districtCounts.set(projD, (districtCounts.get(projD) || 0) + 1);
  }

  if (districtCounts.size === 0) return null;

  let bestDistrict = null;
  let maxCount = -1;
  for (const [d, count] of districtCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestDistrict = d;
    }
  }
  return bestDistrict;
}

// Helper: Parse area range string (e.g. "1100-1200", ">3000", "<400") into numeric midpoint value
export function parseAreaRange(rangeStr) {
  if (!rangeStr) return null;
  const nums = String(rangeStr).match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  if (nums.length >= 2) return (parseFloat(nums[0]) + parseFloat(nums[1])) / 2;
  return parseFloat(nums[0]);
}

/**
 * Canonical Project Resolver & Upsert Helper (Step 2.1 & 2.3 & 5.1)
 * Eliminates duplicate upsert code across sales, rental feeds, and bulk imports.
 * Matches strictly on (project_name, street_name).
 * Strictly enforces geocoding hierarchy: SVY21 -> OneMap -> District Centroid -> NULL (no street coordinate copying).
 */
export async function getOrCreateProject(conn, rawProj) {
  const projName = (rawProj.project || rawProj.project_name || 'Unknown Project').trim().toUpperCase();
  const rawStreet = (rawProj.street || rawProj.street_name || 'Singapore').trim();
  const street = normalizeStreetName(rawStreet);
  const segment = rawProj.marketSegment || rawProj.market_segment || 'OCR';

  let projRecord = await conn.get(
    `SELECT project_id, postal_district, latitude, longitude, geo_source, planning_area FROM projects WHERE UPPER(project_name) = UPPER(?) AND UPPER(street_name) = UPPER(?)`,
    [projName, street]
  );

  const resolvedDistrict = resolveProjectDistrict(rawProj);

  if (!projRecord) {
    let geo = null;
    if (rawProj.x && rawProj.y) {
      geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
    }

    let lat = null, lng = null, geoSource = null;
    // Step 2.3: Never fabricate planningArea from district; only store if provided by authority/payload
    const planningArea = rawProj.planningArea || rawProj.planning_area || null;

    if (geo) {
      lat = geo.latitude;
      lng = geo.longitude;
      geoSource = 'svy21';
    } else if (rawProj.latitude && rawProj.longitude) {
      lat = parseFloat(rawProj.latitude);
      lng = parseFloat(rawProj.longitude);
      geoSource = 'onemap';
    } else if (resolvedDistrict && districtCenters[resolvedDistrict]) {
      lat = districtCenters[resolvedDistrict].lat;
      lng = districtCenters[resolvedDistrict].lng;
      geoSource = 'district_centre';
    }

    const isLanded = isLandedDevelopment(projName);
    const insertRes = await conn.run(
      `INSERT INTO projects (project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude, geo_source, is_landed_aggregate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projName, street, resolvedDistrict, segment, planningArea, lat, lng, geoSource, isLanded ? 1 : 0]
    );
    return { projId: insertRes.lastID, projName, street, resolvedDistrict, isNew: true };
  }

  const projId = projRecord.project_id;
  // If existing record was missing district or coordinates, enrich it if incoming record has higher fidelity
  if (!projRecord.postal_district && resolvedDistrict) {
    await conn.run(`UPDATE projects SET postal_district = ? WHERE project_id = ?`, [resolvedDistrict, projId]);
  }
  if ((projRecord.latitude == null || projRecord.geo_source === 'district_centre') && rawProj.x && rawProj.y) {
    const geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
    if (geo) {
      await conn.run(
        `UPDATE projects SET latitude = ?, longitude = ?, geo_source = 'svy21' WHERE project_id = ?`,
        [geo.latitude, geo.longitude, projId]
      );
    }
  }

  return {
    projId,
    projName,
    street,
    resolvedDistrict: projRecord.postal_district || resolvedDistrict,
    isNew: false
  };
}

// 2. Fetch live data from official URA API with SQLite TRANSACTION batching
export async function fetchUraData(accessKey) {
  if (!accessKey) {
    throw new Error('URA AccessKey is required for live ingestion.');
  }

  const cleanKey = accessKey.trim();
  console.log(`Requesting daily URA token...`);

  // Step A: Get Token
  const tokenUrl = 'https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1';
  const tokenRes = await axios.get(tokenUrl, {
    headers: {
      AccessKey: cleanKey,
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const body = tokenRes.data || {};
  if (body.Status === 'Error' || !body.Result) {
    throw new Error(`URA API Error: ${body.Message || 'Invalid Access Key. Please double check your URA Access Key.'}`);
  }

  const dailyToken = body.Result;
  console.log('Daily URA Token obtained successfully.');

  const conn = createConnection();
  let totalIngested = 0;
  let totalRentalsIngested = 0;
  let skippedSalesNoDate = 0;
  let skippedRentalsNoDate = 0;
  const salesBatchErrors = [];
  const quarterErrors = [];

  try {
    // Step B: Fetch Sales Transactions (batches 1 to 4)
    for (let batch = 1; batch <= 4; batch++) {
      console.log(`Fetching URA Sales Batch ${batch}/4...`);
      const dataUrl = `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`;

      try {
        const batchRes = await axios.get(dataUrl, {
          headers: {
            AccessKey: cleanKey,
            Token: dailyToken,
            'User-Agent': 'Mozilla/5.0'
          }
        });

        const batchBody = batchRes.data || {};
        const projectsData = batchBody.Result || batchBody.result || [];
        console.log(`Batch ${batch} URA Sales Status:`, batchBody.Status, 'Projects count:', Array.isArray(projectsData) ? projectsData.length : 0);

        if (Array.isArray(projectsData) && projectsData.length > 0) {
          let batchInserted = 0;
          await withTransaction(conn, async () => {
            for (const rawProj of projectsData) {
              const { projId, projName, resolvedDistrict } = await getOrCreateProject(conn, rawProj);

              const txList = rawProj.transaction || [];
              const txOccurrenceTracker = new Map();

              for (const tx of txList) {
                // Step 2.4: Skip records with no contract date instead of defaulting to '0124'
                const rawDate = tx.contractDate;
                if (!rawDate) {
                  skippedSalesNoDate++;
                  continue;
                }

                const rawDateStr = String(rawDate).trim();
                let contractDate;
                if (rawDateStr.length === 4) {
                  const mm = rawDateStr.substring(0, 2);
                  const yy = '20' + rawDateStr.substring(2, 4);
                  contractDate = `${yy}-${mm}-01`;
                } else {
                  contractDate = rawDateStr;
                }

                const areaSqm = parseFloat(tx.area) || 0;
                if (areaSqm <= 0) continue;

                const areaSqft = areaSqm * 10.7639;
                const priceSgd = parseFloat(tx.price) || 0;
                if (priceSgd <= 0) continue;

                const noOfUnits = parseInt(tx.noOfUnits, 10) || 1;
                const psqmSgd = priceSgd / areaSqm;
                const psftSgd = priceSgd / areaSqft;
                // Step 2.4: Store null instead of invented defaults
                const floorRange = tx.floorRange || null;
                const tenure = tx.tenure || null;
                const typeOfSale = tx.typeOfSale === '1' ? 'New Sale' : tx.typeOfSale === '2' ? 'Sub Sale' : (tx.typeOfSale === '3' ? 'Resale' : (tx.typeOfSale || null));
                const propertyType = tx.propertyType || null;

                // Step 2.5: Occurrence tracking preserves genuine duplicate records with identical price/area
                const sig = `${contractDate}|${priceSgd}|${areaSqm}|${floorRange || ''}|${noOfUnits}`;
                const occurrenceIndex = (txOccurrenceTracker.get(sig) || 0) + 1;
                txOccurrenceTracker.set(sig, occurrenceIndex);

                const rawHash = generateTxHash(projName, contractDate, priceSgd, areaSqm, floorRange, occurrenceIndex, noOfUnits, propertyType, resolvedDistrict);

                try {
                  await conn.run(
                    `INSERT INTO property_transactions 
                     (project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, no_of_units, raw_hash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, noOfUnits, rawHash]
                  );
                  batchInserted++;
                  totalIngested++;
                } catch (e) {
                  if (e.message && e.message.includes('raw_hash')) {
                    // Ignore duplicate hash on retry
                  } else {
                    throw e;
                  }
                }
              }
            }
          });
          console.log(`Sales Batch ${batch}/4 committed: ${batchInserted} caveats added (Total: ${totalIngested}, Skipped without date: ${skippedSalesNoDate}).`);
        }
      } catch (txErr) {
        salesBatchErrors.push({ batch, error: txErr.message });
        console.error(`Sales Batch ${batch} error:`, txErr.message);
      }
    }

    // Step C: Fetch URA Real Rental Contracts by Reference Quarter (refPeriod: yyqq)
    const refPeriods = generateRentalQuarters();
    console.log(`Fetching URA Rental Contracts across ${refPeriods.length} reference quarters (${refPeriods[0]} to ${refPeriods[refPeriods.length - 1]})...`);

    for (const refPeriod of refPeriods) {
      try {
        const rentUrl = `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Rental&refPeriod=${refPeriod}`;
        const rentRes = await axios.get(rentUrl, {
          headers: { AccessKey: cleanKey, Token: dailyToken, 'User-Agent': 'Mozilla/5.0' }
        });

        const rentBody = rentRes.data || {};
        const rentProjects = rentBody.Result || rentBody.result || [];

        if (rentBody.Status === 'Success' && Array.isArray(rentProjects) && rentProjects.length > 0) {
          console.log(`Quarter [${refPeriod}]: Retrieved ${rentProjects.length} rental projects from URA.`);
          let quarterInserted = 0;
          await withTransaction(conn, async () => {
            for (const rawProj of rentProjects) {
              const { projId, projName, resolvedDistrict, isNew, street } = await getOrCreateProject(conn, rawProj);
              if (isNew) {
                console.log(`[Rental Feed] Created new project entry: ${projName} at ${street}`);
              }

              const rentalList = rawProj.rental || rawProj.rentals || [];
              const rentOccurrenceTracker = new Map();

              for (const r of rentalList) {
                // Step 2.4: Skip rental records with no lease date
                const rawDate = r.leaseDate || r.lease_date;
                if (!rawDate) {
                  skippedRentalsNoDate++;
                  continue;
                }

                const rawDateStr = String(rawDate).trim();
                let leaseDate;
                if (rawDateStr.length === 4) {
                  const mm = rawDateStr.substring(0, 2);
                  const yy = '20' + rawDateStr.substring(2, 4);
                  leaseDate = `${yy}-${mm}`;
                } else {
                  leaseDate = rawDateStr.substring(0, 7);
                }

                const rentSgd = parseFloat(r.rent || r.rent_sgd) || 0;
                if (rentSgd <= 0) continue;

                // Step 2.4: Eliminate invented 1,000 sqft / 92.9 sqm defaults; store null if missing
                let sqft = null;
                let sqm = null;
                let rentPsft = null;
                let rentPsqm = null;

                const parsedSqft = parseAreaRange(r.areaSqft);
                const parsedSqm = parseAreaRange(r.areaSqm);

                if (parsedSqft) {
                  sqft = parseFloat(parsedSqft.toFixed(1));
                  sqm = parseFloat((sqft / 10.7639).toFixed(1));
                } else if (parsedSqm) {
                  sqm = parseFloat(parsedSqm.toFixed(1));
                  sqft = parseFloat((sqm * 10.7639).toFixed(1));
                }

                if (sqft && sqft > 0) {
                  rentPsft = parseFloat((rentSgd / sqft).toFixed(2));
                  rentPsqm = parseFloat((rentSgd / sqm).toFixed(2));
                }

                const bedroomCount = r.noOfBedRoom ? `${r.noOfBedRoom}-Bedder` : null;
                const floorAreaRange = r.areaSqft ? `${r.areaSqft} sqft` : (r.areaSqm ? `${r.areaSqm} sqm` : null);
                const propType = r.propertyType || null;

                const sig = `${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}`;
                const occurrenceIndex = (rentOccurrenceTracker.get(sig) || 0) + 1;
                rentOccurrenceTracker.set(sig, occurrenceIndex);

                const rawHash = generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex, resolvedDistrict);

                try {
                  await conn.run(
                    `INSERT INTO rental_transactions 
                     (project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft, lease_date, bedroom_count, floor_area_range, property_type, raw_hash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [projId, sqm, sqft, rentSgd, rentPsqm, rentPsft, leaseDate, bedroomCount, floorAreaRange, propType, rawHash]
                  );
                  quarterInserted++;
                  totalRentalsIngested++;
                } catch (e) {
                  if (e.message && e.message.includes('raw_hash')) {
                    // Ignore duplicate hash on retry
                  } else {
                    throw e;
                  }
                }
              }
            }
          });
          console.log(`Quarter [${refPeriod}] committed: ${quarterInserted} rental records added (Total: ${totalRentalsIngested}, Skipped without date: ${skippedRentalsNoDate}).`);
        }
      } catch (rentErr) {
        quarterErrors.push({ quarter: refPeriod, error: rentErr.message });
        console.warn(`Quarter [${refPeriod}] rental fetch warning:`, rentErr.message);
      }
    }

    // Step D: Also fetch Median Rental Benchmarks (PMI_Resi_Rental_Median)
    try {
      const medianUrl = `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Rental_Median`;
      const medianRes = await axios.get(medianUrl, {
        headers: { AccessKey: cleanKey, Token: dailyToken, 'User-Agent': 'Mozilla/5.0' }
      });

      const medianProjects = medianRes.data?.Result || medianRes.data?.result || [];
      console.log(`Median Rental Service returned ${medianProjects.length} records.`);
    } catch (mErr) {
      console.warn('Median rental benchmark warning:', mErr.message);
    }

    return {
      status: salesBatchErrors.length === 0 && quarterErrors.length === 0 ? 'success' : 'partial_success',
      salesBatchesProcessed: 4,
      salesBatchErrors,
      rentalQuartersProcessed: refPeriods.length,
      rentalQuarterErrors: quarterErrors,
      totalSalesIngested: totalIngested,
      totalRentalsIngested,
      skippedSalesNoDate,
      skippedRentalsNoDate,
      totalIngested: totalIngested + totalRentalsIngested
    };
  } finally {
    await conn.close();
  }
}

// 3. Bulk Real URA Dataset Importer (JSON or Array payload)
export async function importRealUraData(jsonData) {
  const resultData = Array.isArray(jsonData) ? jsonData : (jsonData?.Result || jsonData?.data || []);
  if (!Array.isArray(resultData) || resultData.length === 0) {
    throw new Error('Invalid URA Data format. Expected JSON containing array of project records.');
  }

  const conn = createConnection();
  let totalSalesIngested = 0;
  let totalRentalsIngested = 0;
  let skippedSalesNoDate = 0;
  let skippedRentalsNoDate = 0;

  try {
    await withTransaction(conn, async () => {
      for (const rawProj of resultData) {
        const projName = (rawProj.project || rawProj.project_name || '').trim().toUpperCase();
        if (!projName) continue;

        const { projId, resolvedDistrict } = await getOrCreateProject(conn, rawProj);

        // Process Sales Transactions
        const txList = rawProj.transaction || rawProj.transactions || [];
        const txOccurrenceTracker = new Map();

        for (const tx of txList) {
          const rawDate = tx.contractDate || tx.contract_date;
          if (!rawDate) {
            skippedSalesNoDate++;
            continue;
          }

          const rawDateStr = String(rawDate).trim();
          let contractDate;
          if (rawDateStr.length === 4) {
            const mm = rawDateStr.substring(0, 2);
            const yy = '20' + rawDateStr.substring(2, 4);
            contractDate = `${yy}-${mm}-01`;
          } else {
            contractDate = rawDateStr;
          }

          const areaSqm = parseFloat(tx.area || tx.area_sqm) || 0;
          if (areaSqm <= 0) continue;

          const areaSqft = areaSqm * 10.7639;
          const priceSgd = parseFloat(tx.price || tx.price_sgd) || 0;
          if (priceSgd <= 0) continue;

          const noOfUnits = parseInt(tx.noOfUnits || tx.no_of_units, 10) || 1;
          const psqmSgd = priceSgd / areaSqm;
          const psftSgd = priceSgd / areaSqft;
          const floorRange = tx.floorRange || tx.floor_range || null;
          const tenure = tx.tenure || null;
          const typeOfSale = tx.typeOfSale === '1' ? 'New Sale' : tx.typeOfSale === '2' ? 'Sub Sale' : (tx.typeOfSale === '3' ? 'Resale' : (tx.typeOfSale || null));
          const propertyType = tx.propertyType || tx.property_type || null;

          const sig = `${contractDate}|${priceSgd}|${areaSqm}|${floorRange || ''}|${noOfUnits}`;
          const occurrenceIndex = (txOccurrenceTracker.get(sig) || 0) + 1;
          txOccurrenceTracker.set(sig, occurrenceIndex);

          const rawHash = generateTxHash(projName, contractDate, priceSgd, areaSqm, floorRange, occurrenceIndex, noOfUnits, propertyType, resolvedDistrict);

          try {
            await conn.run(
              `INSERT INTO property_transactions 
               (project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, no_of_units, raw_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, noOfUnits, rawHash]
            );
            totalSalesIngested++;
          } catch (e) {
            if (e.message && e.message.includes('raw_hash')) {
              // Ignore genuine duplicates
            } else {
              throw e;
            }
          }
        }

        // Process Rental Contracts
        const rentalList = rawProj.rental || rawProj.rentals || [];
        const rentOccurrenceTracker = new Map();

        for (const r of rentalList) {
          const rawDate = r.leaseDate || r.lease_date;
          if (!rawDate) {
            skippedRentalsNoDate++;
            continue;
          }

          const rawDateStr = String(rawDate).trim();
          let leaseDate;
          if (rawDateStr.length === 4) {
            const mm = rawDateStr.substring(0, 2);
            const yy = '20' + rawDateStr.substring(2, 4);
            leaseDate = `${yy}-${mm}`;
          } else {
            leaseDate = rawDateStr.substring(0, 7);
          }

          const rentSgd = parseFloat(r.rent || r.rent_sgd) || 0;
          if (rentSgd <= 0) continue;

          // Step 2.4: Unit handling without arbitrary < 350 guessing
          let sqft = null;
          let sqm = null;
          let rentPsft = null;
          let rentPsqm = null;

          if (r.areaSqft) {
            const parsed = parseAreaRange(r.areaSqft);
            if (parsed) {
              sqft = parseFloat(parsed.toFixed(1));
              sqm = parseFloat((sqft / 10.7639).toFixed(1));
            }
          } else if (r.areaSqm) {
            const parsed = parseAreaRange(r.areaSqm);
            if (parsed) {
              sqm = parseFloat(parsed.toFixed(1));
              sqft = parseFloat((sqm * 10.7639).toFixed(1));
            }
          } else if (r.floor_area_range) {
            const rangeStr = String(r.floor_area_range).toLowerCase();
            const parsed = parseAreaRange(rangeStr);
            if (parsed) {
              if (rangeStr.includes('sqm')) {
                sqm = parseFloat(parsed.toFixed(1));
                sqft = parseFloat((sqm * 10.7639).toFixed(1));
              } else if (rangeStr.includes('sqft')) {
                sqft = parseFloat(parsed.toFixed(1));
                sqm = parseFloat((sqft / 10.7639).toFixed(1));
              }
            }
          }

          if (sqft && sqft > 0) {
            rentPsft = parseFloat((rentSgd / sqft).toFixed(2));
            rentPsqm = parseFloat((rentSgd / sqm).toFixed(2));
          }

          const bedroomCount = r.noOfBedRoom ? `${r.noOfBedRoom}-Bedder` : (r.bedroom_count || null);
          const floorAreaRange = r.areaSqft ? `${r.areaSqft} sqft` : (r.areaSqm ? `${r.areaSqm} sqm` : (r.floor_area_range || null));
          const propertyType = r.propertyType || r.property_type || null;

          const sig = `${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}`;
          const occurrenceIndex = (rentOccurrenceTracker.get(sig) || 0) + 1;
          rentOccurrenceTracker.set(sig, occurrenceIndex);

          const rawHash = generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex, resolvedDistrict);

          try {
            await conn.run(
              `INSERT INTO rental_transactions 
               (project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft, lease_date, bedroom_count, floor_area_range, property_type, raw_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [projId, sqm, sqft, rentSgd, rentPsqm, rentPsft, leaseDate, bedroomCount, floorAreaRange, propertyType, rawHash]
            );
            totalRentalsIngested++;
          } catch (e) {
            if (e.message && e.message.includes('raw_hash')) {
              // Ignore genuine duplicates
            } else {
              throw e;
            }
          }
        }
      }
    });

    console.log(`Real URA Data Import complete: ${totalSalesIngested} sales (skipped ${skippedSalesNoDate} without date), ${totalRentalsIngested} rentals (skipped ${skippedRentalsNoDate} without date).`);
    return { status: 'success', totalSalesIngested, totalRentalsIngested, skippedSalesNoDate, skippedRentalsNoDate };
  } finally {
    await conn.close();
  }
}

export async function seedSoraRates() {
  console.log('Seeding 1M & 3M Compounded SORA benchmark historical rate data...');
  
  // Step 2.4: Removed future months (2026-10 to 2026-12)
  const soraData = [
    // 2021
    { month: '2021-01', sora1m: 0.24, sora3m: 0.28 },
    { month: '2021-02', sora1m: 0.25, sora3m: 0.29 },
    { month: '2021-03', sora1m: 0.23, sora3m: 0.27 },
    { month: '2021-04', sora1m: 0.24, sora3m: 0.26 },
    { month: '2021-05', sora1m: 0.25, sora3m: 0.28 },
    { month: '2021-06', sora1m: 0.26, sora3m: 0.29 },
    { month: '2021-07', sora1m: 0.28, sora3m: 0.31 },
    { month: '2021-08', sora1m: 0.27, sora3m: 0.30 },
    { month: '2021-09', sora1m: 0.29, sora3m: 0.32 },
    { month: '2021-10', sora1m: 0.31, sora3m: 0.33 },
    { month: '2021-11', sora1m: 0.32, sora3m: 0.35 },
    { month: '2021-12', sora1m: 0.34, sora3m: 0.37 },
    // 2022
    { month: '2022-01', sora1m: 0.38, sora3m: 0.35 },
    { month: '2022-02', sora1m: 0.45, sora3m: 0.40 },
    { month: '2022-03', sora1m: 0.55, sora3m: 0.48 },
    { month: '2022-04', sora1m: 0.72, sora3m: 0.61 },
    { month: '2022-05', sora1m: 0.98, sora3m: 0.82 },
    { month: '2022-06', sora1m: 1.25, sora3m: 1.02 },
    { month: '2022-07', sora1m: 1.58, sora3m: 1.34 },
    { month: '2022-08', sora1m: 1.92, sora3m: 1.62 },
    { month: '2022-09', sora1m: 2.22, sora3m: 1.85 },
    { month: '2022-10', sora1m: 2.55, sora3m: 2.18 },
    { month: '2022-11', sora1m: 2.88, sora3m: 2.52 },
    { month: '2022-12', sora1m: 3.10, sora3m: 2.82 },
    // 2023
    { month: '2023-01', sora1m: 3.25, sora3m: 3.05 },
    { month: '2023-02', sora1m: 3.42, sora3m: 3.28 },
    { month: '2023-03', sora1m: 3.58, sora3m: 3.45 },
    { month: '2023-04', sora1m: 3.61, sora3m: 3.52 },
    { month: '2023-05', sora1m: 3.63, sora3m: 3.58 },
    { month: '2023-06', sora1m: 3.65, sora3m: 3.60 },
    { month: '2023-07', sora1m: 3.68, sora3m: 3.62 },
    { month: '2023-08', sora1m: 3.71, sora3m: 3.65 },
    { month: '2023-09', sora1m: 3.68, sora3m: 3.66 },
    { month: '2023-10', sora1m: 3.69, sora3m: 3.67 },
    { month: '2023-11', sora1m: 3.70, sora3m: 3.68 },
    { month: '2023-12', sora1m: 3.70, sora3m: 3.68 },
    // 2024
    { month: '2024-01', sora1m: 3.68, sora3m: 3.68 },
    { month: '2024-02', sora1m: 3.65, sora3m: 3.66 },
    { month: '2024-03', sora1m: 3.62, sora3m: 3.64 },
    { month: '2024-04', sora1m: 3.60, sora3m: 3.62 },
    { month: '2024-05', sora1m: 3.59, sora3m: 3.61 },
    { month: '2024-06', sora1m: 3.58, sora3m: 3.60 },
    { month: '2024-07', sora1m: 3.55, sora3m: 3.57 },
    { month: '2024-08', sora1m: 3.48, sora3m: 3.52 },
    { month: '2024-09', sora1m: 3.42, sora3m: 3.48 },
    { month: '2024-10', sora1m: 3.30, sora3m: 3.38 },
    { month: '2024-11', sora1m: 3.18, sora3m: 3.26 },
    { month: '2024-12', sora1m: 3.05, sora3m: 3.18 },
    // 2025
    { month: '2025-01', sora1m: 2.95, sora3m: 3.08 },
    { month: '2025-02', sora1m: 2.90, sora3m: 3.00 },
    { month: '2025-03', sora1m: 2.85, sora3m: 2.92 },
    { month: '2025-04', sora1m: 2.78, sora3m: 2.86 },
    { month: '2025-05', sora1m: 2.70, sora3m: 2.80 },
    { month: '2025-06', sora1m: 2.65, sora3m: 2.75 },
    { month: '2025-07', sora1m: 2.60, sora3m: 2.68 },
    { month: '2025-08', sora1m: 2.55, sora3m: 2.62 },
    { month: '2025-09', sora1m: 2.50, sora3m: 2.58 },
    { month: '2025-10', sora1m: 2.45, sora3m: 2.52 },
    { month: '2025-11', sora1m: 2.42, sora3m: 2.48 },
    { month: '2025-12', sora1m: 2.40, sora3m: 2.45 },
    // 2026 (Past and current months only; future months deleted)
    { month: '2026-01', sora1m: 2.38, sora3m: 2.43 },
    { month: '2026-02', sora1m: 2.36, sora3m: 2.42 },
    { month: '2026-03', sora1m: 2.35, sora3m: 2.40 },
    { month: '2026-04', sora1m: 2.35, sora3m: 2.40 },
    { month: '2026-05', sora1m: 2.36, sora3m: 2.41 },
    { month: '2026-06', sora1m: 2.38, sora3m: 2.42 },
    { month: '2026-07', sora1m: 2.40, sora3m: 2.44 },
    { month: '2026-08', sora1m: 2.42, sora3m: 2.45 },
    { month: '2026-09', sora1m: 2.40, sora3m: 2.44 }
  ];

  const conn = createConnection();
  try {
    await withTransaction(conn, async () => {
      // Clean out any previously seeded future months
      await conn.run(`DELETE FROM sora_rates WHERE reference_month > '2026-09'`);

      for (const item of soraData) {
        await conn.run(
          `INSERT INTO sora_rates (reference_month, sora_1m, sora_3m)
           VALUES (?, ?, ?)
           ON CONFLICT(reference_month) DO UPDATE SET
             sora_1m = excluded.sora_1m,
             sora_3m = excluded.sora_3m,
             updated_at = CURRENT_TIMESTAMP`,
          [item.month, item.sora1m, item.sora3m]
        );
      }
    });
    console.log(`Successfully seeded ${soraData.length} SORA rate monthly entries.`);
  } finally {
    await conn.close();
  }
}
