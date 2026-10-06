import fs from 'fs';
import axios from 'axios';
import crypto from 'crypto';
import { dbRun, dbGet, dbAll, createConnection, withTransaction } from './db.js';
import { generateRentalQuarters } from './utils/dateUtils.js';
import { normalizeStreetName } from './utils/streetUtils.js';
import { classifyTenure } from './utils/tenureUtils.js';
import { normalizeBedroom } from './utils/bedroomUtils.js';
import { refreshProjectBenchmarks } from './queryEngine.js';
import { precomputeAllProjectLivability } from './livabilityEngine.js';
import { svy21ToWgs84, DISTRICT_CENTERS, getDistrictCenter } from './utils/geo.js';
import { getOrCreateProject, cleanPostalDistrict, resolveProjectDistrict, isLandedDevelopment } from './utils/projectUpsert.js';

// Re-export shared utilities for external modules and scripts (Step 5.1)
export { svy21ToWgs84, getOrCreateProject, cleanPostalDistrict, resolveProjectDistrict, isLandedDevelopment };

// Helper: Normalize contract date (e.g., '0124' -> '2024-01-01')
export function normalizeContractDate(rawDate) {
  if (!rawDate) return null;
  const rawDateStr = String(rawDate).trim();
  if (rawDateStr.length === 4) {
    const mm = rawDateStr.substring(0, 2);
    const yy = '20' + rawDateStr.substring(2, 4);
    return `${yy}-${mm}-01`;
  }
  return rawDateStr;
}

// Helper: Normalize lease date (e.g., '0124' -> '2024-01')
export function normalizeLeaseDate(rawDate) {
  if (!rawDate) return null;
  const rawDateStr = String(rawDate).trim();
  if (!/^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(rawDateStr)) return null;
  if (rawDateStr.length === 10 && (!Number.isFinite(Date.parse(rawDateStr)) || new Date(rawDateStr).toISOString().slice(0,10) !== rawDateStr)) return null;
  if (rawDateStr.length === 4) {
    const mm = rawDateStr.substring(0, 2);
    const yy = '20' + rawDateStr.substring(2, 4);
    return `${yy}-${mm}`;
  }
  return rawDateStr.substring(0, 7);
}

// Helper: MD5 Hash for deterministic transaction deduplication (includes street & full identity)
export function generateTxHash(projName, dateStr, price, area, floorRange, occurrenceIndex = 1, noOfUnits = 1, propertyType = '', district = '', street = '') {
  const raw = `${projName}|${street || ''}|${dateStr}|${price}|${area}|${floorRange || ''}|${occurrenceIndex}|${noOfUnits}|${propertyType || ''}|${district || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

// Helper: MD5 Hash for rental transaction deduplication (includes street & full identity)
export function generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex = 1, district = '', street = '') {
  const raw = `URA_RENT|${projName}|${street || ''}|${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}|${occurrenceIndex}|${district || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

// Helper: Parse area range string (e.g. "1100-1200", ">3000", "<400") into numeric midpoint value
export function parseAreaRange(rangeStr) {
  if (!rangeStr || /[<>]|above|below|more than|less than/i.test(String(rangeStr))) return null;
  const nums = String(rangeStr).match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  if (nums.length >= 2) return (parseFloat(nums[0]) + parseFloat(nums[1])) / 2;
  return parseFloat(nums[0]);
}

// Step 2.3 / ING-01: Resilient Axios Client with 30s timeout and Exponential Backoff Retries
export const uraClient = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'SingaporeHomeIntel/1.0 (URA Data Sync Service)'
  }
});

/**
 * Outbound HTTP GET helper with exponential backoff retry (1s, 2s, 4s)
 * on rate limits (429), gateway errors (502, 503, 504), and socket timeouts.
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3, client = uraClient) {
  let attempt = 0;
  while (true) {
    try {
      return await client.get(url, options);
    } catch (err) {
      attempt++;
      const status = err.response?.status;
      const isRetryable =
        attempt < maxRetries &&
        (!status || status === 429 || status === 502 || status === 503 || status === 504 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
      if (!isRetryable) {
        throw err;
      }
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      console.warn(`[Ingestion] Outbound request failed (${err.message}). Retrying attempt ${attempt}/${maxRetries} after ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// Fetch and validate every requested source scope before writing anything.
export async function fetchUraData(accessKey, targetConn = null) {
  if (!accessKey?.trim()) throw new Error('URA AccessKey is required for live ingestion.');
  const headers = { AccessKey: accessKey.trim() };
  const token = (await fetchWithRetry('https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1', { headers })).data;
  if (token?.Status !== 'Success' || typeof token.Result !== 'string' || !token.Result) throw new Error('Invalid URA token response');
  headers.Token = token.Result;
  const projects = [];
  const refPeriods = generateRentalQuarters();
  const request = async (service, scope) => {
    const response = (await fetchWithRetry('https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=' + service + '&' + scope, { headers })).data;
    if (response?.Status !== 'Success' || !Array.isArray(response.Result) || !response.Result.length) throw new Error('Empty or unsuccessful URA scope: ' + service + ' ' + scope);
    return response.Result;
  };
  for (let batch = 1; batch <= 4; batch++) {
    const rows = await request('PMI_Resi_Transaction', 'batch=' + batch);
    validateImportPayload(rows, 'sales');
    projects.push(...rows);
  }
  for (const period of refPeriods) {
    const rows = await request('PMI_Resi_Rental', 'refPeriod=' + period);
    validateImportPayload(rows, 'rentals');
    const match = /^(\d{2})q([1-4])$/i.exec(period);
    if (!match) throw new Error('Invalid rental quarter');
    for (const project of rows) for (const rental of project.rental || project.rentals) {
      const date = normalizeLeaseDate(rental.leaseDate || rental.lease_date);
      if (date.slice(0, 4) !== '20' + match[1] || Math.ceil(Number(date.slice(5, 7)) / 3) !== Number(match[2])) throw new Error('Rental outside requested quarter');
    }
    projects.push(...rows);
  }
  const result = await importRealUraData(projects, targetConn);
  return { ...result, salesBatchesProcessed: 4, rentalQuartersProcessed: refPeriods.length,
    salesBatchErrors: [], rentalQuarterErrors: [], totalIngested: result.totalSalesIngested + result.totalRentalsIngested,
    mode: 'additive', sourceCompleteness: 'unverified' };
}

// A nonempty response cannot prove an authoritative complete period. Imports are
// additive multiset unions; source corrections/deletions require reconciliation.
export function validateImportPayload(projects, required = null) {
  if (!Array.isArray(projects) || !projects.length) throw new Error('Empty import payload');
  for (const project of projects) {
    if (!project || typeof (project.project || project.project_name) !== 'string' || !(project.project || project.project_name).trim() ||
        typeof (project.street || project.street_name) !== 'string' || !(project.street || project.street_name).trim()) throw new Error('Project name and street are required');
    const sales = project.transaction ?? project.transactions ?? [];
    const rentals = project.rental ?? project.rentals ?? [];
    if (!Array.isArray(sales) || !Array.isArray(rentals) || (required === 'sales' && !sales.length) || (required === 'rentals' && !rentals.length) || (!sales.length && !rentals.length)) throw new Error('Missing transaction records');
    for (const tx of sales) {
      const date = normalizeContractDate(tx?.contractDate || tx?.contract_date);
      if (!date || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date ||
          !Number.isFinite(Number(tx.price ?? tx.price_sgd)) || Number(tx.price ?? tx.price_sgd) <= 0 ||
          !Number.isFinite(Number(tx.area ?? tx.area_sqm)) || Number(tx.area ?? tx.area_sqm) <= 0) throw new Error('Malformed sale record');
      const units = tx.noOfUnits ?? tx.no_of_units ?? 1;
      if (!Number.isInteger(Number(units)) || Number(units) < 1) throw new Error('Malformed sale unit count');
    }
    for (const rental of rentals) {
      const date = normalizeLeaseDate(rental?.leaseDate || rental?.lease_date);
      if (!date || !/^\d{4}-(0[1-9]|1[0-2])$/.test(date) || !Number.isFinite(Number(rental.rent ?? rental.rent_sgd)) || Number(rental.rent ?? rental.rent_sgd) <= 0) throw new Error('Malformed rental record');
      for (const area of [rental.areaSqft, rental.areaSqm]) if (area != null && !/^\s*[<>]=?\s*\d+(?:\.\d+)?\s*$/.test(String(area)) && (!parseAreaRange(area) || parseAreaRange(area) <= 0)) throw new Error('Malformed rental area');
    }
  }
}

async function insertOccurrence(conn, table, columns, values, occurrence, existing) {
  const fields = columns.split(',').map(c => c.trim());
  // Ignore derived values for identity, allowing legacy rounding and raw hashes.
  const identity = fields.map((name, i) => ({name, i})).filter(({name}) => !['raw_hash', 'area_sqft', 'psqm_sgd', 'psft_sgd', 'rent_psqm', 'rent_psft', 'tenure_class'].includes(name));
  const params = identity.map(({i}) => values[i]);
  const key = table + JSON.stringify(params);
  const ordinal = (occurrence.get(key) || 0) + 1;
  occurrence.set(key, ordinal);
  if (!existing.has(key)) {
    const districtIndex = identity.findIndex(({name}) => name === 'source_district');
    const legacy = [...params];
    if (districtIndex >= 0) legacy[districtIndex] = null;
    existing.set(key, districtIndex >= 0 && params[districtIndex] != null ? (existing.get(table + JSON.stringify(legacy)) || 0) : 0);
  }
  if (ordinal <= existing.get(key)) return false;
  values[fields.indexOf('raw_hash')] = crypto.createHash('sha256').update(key + '|' + ordinal).digest('hex');
  await conn.run('INSERT INTO ' + table + ' (' + columns + ') VALUES (' + fields.map(() => '?').join(',') + ')', values);
  return true;
}

// 3. Bulk Real URA Dataset Importer (JSON or Array payload)
export async function importRealUraData(jsonData, targetConn = null) {
  if (!Array.isArray(jsonData) && jsonData?.Status && jsonData.Status !== 'Success') throw new Error('Unsuccessful URA import envelope');
  const resultData = Array.isArray(jsonData) ? jsonData : (jsonData?.Result || jsonData?.data || []);
  if (!Array.isArray(resultData) || resultData.length === 0) {
    throw new Error('Invalid URA Data format. Expected JSON containing array of project records.');
  }

  validateImportPayload(resultData);
  const occurrences = new Map();
  const existing = new Map();
  const conn = targetConn || createConnection();
  const shouldClose = !targetConn;
  let totalSalesIngested = 0;
  let totalRentalsIngested = 0;
  let skippedSalesNoDate = 0;
  let skippedRentalsNoDate = 0;

  try {
    await withTransaction(conn, async () => {
      // Load original multiplicities once, before inserting. Per-record COUNT scans
      // become quadratic for high-volume projects during a full source rehearsal.
      for (const [table, fields] of [
        ['property_transactions', ['project_id','area_sqm','price_sgd','contract_date','floor_range','tenure','type_of_sale','property_type','no_of_units','source_district']],
        ['rental_transactions', ['project_id','area_sqm','rent_sgd','lease_date','bedroom_count','floor_area_range','property_type','source_district']]
      ]) {
        const rows = await conn.all(`SELECT ${fields.join(',')}, COUNT(*) AS original_count FROM ${table} GROUP BY ${fields.join(',')}`);
        for (const row of rows) existing.set(table + JSON.stringify(fields.map(field => row[field])), row.original_count);
      }
      for (const rawProj of resultData) {
        const projName = (rawProj.project || rawProj.project_name || '').trim().toUpperCase();
        if (!projName) continue;

        const { projId, resolvedDistrict, street } = await getOrCreateProject(conn, rawProj);

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

          const areaSqm = Number(tx.area ?? tx.area_sqm);
          if (areaSqm <= 0) continue;

          const areaSqft = areaSqm * 10.7639;
          const priceSgd = Number(tx.price ?? tx.price_sgd);
          if (priceSgd <= 0) continue;

          const noOfUnits = Number(tx.noOfUnits ?? tx.no_of_units ?? 1);
          const psqmSgd = priceSgd / areaSqm;
          const psftSgd = priceSgd / areaSqft;
          const floorRange = tx.floorRange || tx.floor_range || null;
          const tenure = tx.tenure || null;
          const tenureClass = classifyTenure(tenure);
          const typeOfSale = tx.typeOfSale === '1' ? 'New Sale' : tx.typeOfSale === '2' ? 'Sub Sale' : (tx.typeOfSale === '3' ? 'Resale' : (tx.typeOfSale || null));
          const propertyType = tx.propertyType || tx.property_type || null;

          if (tenureClass) {
            await conn.run(
              `UPDATE projects SET tenure_class = ? WHERE project_id = ? AND (tenure_class IS NULL OR (tenure_class != 'freehold' AND ? = 'freehold'))`,
              [tenureClass, projId, tenureClass]
            );
          }

          const sig = `${contractDate}|${priceSgd}|${areaSqm}|${floorRange || ''}|${noOfUnits}`;
          const occurrenceIndex = (txOccurrenceTracker.get(sig) || 0) + 1;
          txOccurrenceTracker.set(sig, occurrenceIndex);

          const rawHash = generateTxHash(projName, contractDate, priceSgd, areaSqm, floorRange, occurrenceIndex, noOfUnits, propertyType, resolvedDistrict, street);

          if (await insertOccurrence(conn, 'property_transactions',
            'project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, no_of_units, tenure_class, raw_hash, source_district',
            [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, noOfUnits, tenureClass, rawHash, tx.district ? String(tx.district).padStart(2,'0') : null], occurrences, existing)) totalSalesIngested++;

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

          const rentSgd = Number(r.rent ?? r.rent_sgd);
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

          const bedroomCount = normalizeBedroom(r.noOfBedRoom || r.bedroom_count);
          const floorAreaRange = r.areaSqft ? `${r.areaSqft} sqft` : (r.areaSqm ? `${r.areaSqm} sqm` : (r.floor_area_range || null));
          const propertyType = r.propertyType || r.property_type || null;

          const sig = `${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}`;
          const occurrenceIndex = (rentOccurrenceTracker.get(sig) || 0) + 1;
          rentOccurrenceTracker.set(sig, occurrenceIndex);

          const rawHash = generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex, resolvedDistrict, street);

          if (await insertOccurrence(conn, 'rental_transactions',
            'project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft, lease_date, bedroom_count, floor_area_range, property_type, raw_hash, source_district',
            [projId, sqm, sqft, rentSgd, rentPsqm, rentPsft, leaseDate, bedroomCount, floorAreaRange, propertyType, rawHash, r.district ? String(r.district).padStart(2,'0') : null], occurrences, existing)) totalRentalsIngested++;

        }
      }
      await refreshProjectBenchmarks(conn);
    });

    console.log(`Real URA Data Import complete: ${totalSalesIngested} sales (skipped ${skippedSalesNoDate} without date), ${totalRentalsIngested} rentals (skipped ${skippedRentalsNoDate} without date).`);
    return { status: 'success', mode: 'additive', sourceCompleteness: 'unverified', totalSalesIngested, totalRentalsIngested, totalIngested: totalSalesIngested + totalRentalsIngested, skippedSalesNoDate, skippedRentalsNoDate };
  } finally {
    if (shouldClose) {
      await conn.close();
    }
  }
}

export async function seedSoraRates(targetConn = null) {
  console.log('Seeding 1M & 3M Compounded SORA benchmark historical rate data...');
  
  // Step 2.4: Removed future months (2026-10 to 2026-12)
  const soraData = JSON.parse(fs.readFileSync(new URL('./data/sora_rates_historical.json', import.meta.url),'utf8')).rates;

  const conn = targetConn || createConnection();
  const shouldClose = !targetConn;
  try {
    await withTransaction(conn, async () => {
      for (const item of soraData) {
        await conn.run(
          `INSERT INTO sora_rates (reference_month, sora_1m, sora_3m, source, verified)
           VALUES (?, ?, ?, 'legacy-seed-unverified', 0)
           ON CONFLICT(reference_month) DO NOTHING`,
          [item.month, item.sora1m, item.sora3m]
        );
      }
    });
    console.log(`Successfully seeded ${soraData.length} SORA rate monthly entries.`);
  } finally {
    if (shouldClose) {
      await conn.close();
    }
  }
}
