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
  if (!rangeStr) return null;
  const nums = String(rangeStr).match(/\d+/g);
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

// 2. Fetch live data from official URA API with SQLite TRANSACTION batching
export async function fetchUraData(accessKey, targetConn = null) {
  if (!accessKey) {
    throw new Error('URA AccessKey is required for live ingestion.');
  }

  const cleanKey = accessKey.trim();
  console.log(`Requesting daily URA token...`);

  // Step A: Get Token
  const tokenUrl = 'https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1';
  const tokenRes = await fetchWithRetry(tokenUrl, {
    headers: {
      AccessKey: cleanKey
    }
  });

  const body = tokenRes.data || {};
  if (body.Status === 'Error' || !body.Result) {
    throw new Error(`URA API Error: ${body.Message || 'Invalid Access Key. Please double check your URA Access Key.'}`);
  }

  const dailyToken = body.Result;
  console.log('Daily URA Token obtained successfully.');

  const conn = targetConn || createConnection();
  const shouldClose = !targetConn;
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
        const batchRes = await fetchWithRetry(dataUrl, {
          headers: {
            AccessKey: cleanKey,
            Token: dailyToken
          }
        });

        const batchBody = batchRes.data || {};
        const projectsData = batchBody.Result || batchBody.result || [];
        console.log(`Batch ${batch} URA Sales Status:`, batchBody.Status, 'Projects count:', Array.isArray(projectsData) ? projectsData.length : 0);

        if (batchBody.Status && batchBody.Status !== 'Success') {
          salesBatchErrors.push({ batch, error: batchBody.Message || `Sales batch status: ${batchBody.Status}` });
        }

        if (Array.isArray(projectsData) && projectsData.length > 0) {
          let batchInserted = 0;
          await withTransaction(conn, async () => {
            for (const rawProj of projectsData) {
              const { projId, projName, resolvedDistrict, street } = await getOrCreateProject(conn, rawProj);

              const txList = rawProj.transaction || [];
              if (txList.length > 0) {
                // Scoped replacement: delete ONLY records within the incoming batch's contract dates for this project
                const incomingDates = [...new Set(txList.map(t => normalizeContractDate(t.contractDate)).filter(Boolean))];
                if (incomingDates.length > 0) {
                  const placeholders = incomingDates.map(() => '?').join(',');
                  await conn.run(`DELETE FROM property_transactions WHERE project_id = ? AND contract_date IN (${placeholders})`, [projId, ...incomingDates]);
                }
              }
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
                const tenureClass = classifyTenure(tenure);
                const typeOfSale = tx.typeOfSale === '1' ? 'New Sale' : tx.typeOfSale === '2' ? 'Sub Sale' : (tx.typeOfSale === '3' ? 'Resale' : (tx.typeOfSale || null));
                const propertyType = tx.propertyType || null;

                if (tenureClass) {
                  await conn.run(
                    `UPDATE projects SET tenure_class = ? WHERE project_id = ? AND (tenure_class IS NULL OR (tenure_class != 'freehold' AND ? = 'freehold'))`,
                    [tenureClass, projId, tenureClass]
                  );
                }

                // Step 2.5: Occurrence tracking preserves genuine duplicate records with identical price/area
                const sig = `${contractDate}|${priceSgd}|${areaSqm}|${floorRange || ''}|${noOfUnits}`;
                const occurrenceIndex = (txOccurrenceTracker.get(sig) || 0) + 1;
                txOccurrenceTracker.set(sig, occurrenceIndex);

                const rawHash = generateTxHash(projName, contractDate, priceSgd, areaSqm, floorRange, occurrenceIndex, noOfUnits, propertyType, resolvedDistrict, street);

                try {
                  await conn.run(
                    `INSERT INTO property_transactions 
                     (project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, no_of_units, tenure_class, raw_hash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, noOfUnits, tenureClass, rawHash]
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
        const rentRes = await fetchWithRetry(rentUrl, {
          headers: { AccessKey: cleanKey, Token: dailyToken }
        });

        const rentBody = rentRes.data || {};
        const rentProjects = rentBody.Result || rentBody.result || [];

        if (rentBody.Status && rentBody.Status !== 'Success') {
          quarterErrors.push({ quarter: refPeriod, error: rentBody.Message || `Rental quarter status: ${rentBody.Status}` });
        }

        if (rentBody.Status === 'Success' && Array.isArray(rentProjects) && rentProjects.length > 0) {
          console.log(`Quarter [${refPeriod}]: Retrieved ${rentProjects.length} rental projects from URA.`);
          let quarterInserted = 0;
          await withTransaction(conn, async () => {
            // Step 2.5.1: Replace-by-period: delete existing records for this quarter before inserting fresh URA data
            const qMatch = /^(\d{2})q([1-4])$/i.exec(String(refPeriod).trim());
            if (qMatch) {
              const yy = qMatch[1];
              const qNum = parseInt(qMatch[2], 10);
              const qMonths = [
                `20${yy}-${String((qNum - 1) * 3 + 1).padStart(2, '0')}`,
                `20${yy}-${String((qNum - 1) * 3 + 2).padStart(2, '0')}`,
                `20${yy}-${String((qNum - 1) * 3 + 3).padStart(2, '0')}`
              ];
              await conn.run(`DELETE FROM rental_transactions WHERE lease_date IN (?, ?, ?)`, qMonths);
            }

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

                const bedroomCount = normalizeBedroom(r.noOfBedRoom);
                const floorAreaRange = r.areaSqft ? `${r.areaSqft} sqft` : (r.areaSqm ? `${r.areaSqm} sqm` : null);
                const propType = r.propertyType || null;

                const sig = `${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}`;
                const occurrenceIndex = (rentOccurrenceTracker.get(sig) || 0) + 1;
                rentOccurrenceTracker.set(sig, occurrenceIndex);

                const rawHash = generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex, resolvedDistrict, street);

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
      const medianRes = await fetchWithRetry(medianUrl, {
        headers: { AccessKey: cleanKey, Token: dailyToken }
      });

      const medianProjects = medianRes.data?.Result || medianRes.data?.result || [];
      console.log(`Median Rental Service returned ${medianProjects.length} records.`);
    } catch (mErr) {
      console.warn('Median rental benchmark warning:', mErr.message);
    }

    // Step 3.1: Automatically refresh project benchmarks after live ingestion
    await refreshProjectBenchmarks(conn);
    await precomputeAllProjectLivability(conn);

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
    if (shouldClose) {
      await conn.close();
    }
  }
}

// 3. Bulk Real URA Dataset Importer (JSON or Array payload)
export async function importRealUraData(jsonData, targetConn = null) {
  const resultData = Array.isArray(jsonData) ? jsonData : (jsonData?.Result || jsonData?.data || []);
  if (!Array.isArray(resultData) || resultData.length === 0) {
    throw new Error('Invalid URA Data format. Expected JSON containing array of project records.');
  }

  const conn = targetConn || createConnection();
  const shouldClose = !targetConn;
  let totalSalesIngested = 0;
  let totalRentalsIngested = 0;
  let skippedSalesNoDate = 0;
  let skippedRentalsNoDate = 0;

  try {
    await withTransaction(conn, async () => {
      for (const rawProj of resultData) {
        const projName = (rawProj.project || rawProj.project_name || '').trim().toUpperCase();
        if (!projName) continue;

        const { projId, resolvedDistrict, street } = await getOrCreateProject(conn, rawProj);

        // Process Sales Transactions
        const txList = rawProj.transaction || rawProj.transactions || [];
        if (txList.length > 0) {
          const incomingDates = [...new Set(txList.map(t => normalizeContractDate(t.contractDate || t.contract_date)).filter(Boolean))];
          if (incomingDates.length > 0) {
            const placeholders = incomingDates.map(() => '?').join(',');
            await conn.run(`DELETE FROM property_transactions WHERE project_id = ? AND contract_date IN (${placeholders})`, [projId, ...incomingDates]);
          }
        }
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

          try {
            await conn.run(
              `INSERT INTO property_transactions 
               (project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, no_of_units, tenure_class, raw_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, noOfUnits, tenureClass, rawHash]
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
        if (rentalList.length > 0) {
          const incomingLeaseDates = [...new Set(rentalList.map(r => normalizeLeaseDate(r.leaseDate || r.lease_date)).filter(Boolean))];
          if (incomingLeaseDates.length > 0) {
            const placeholders = incomingLeaseDates.map(() => '?').join(',');
            await conn.run(`DELETE FROM rental_transactions WHERE project_id = ? AND lease_date IN (${placeholders})`, [projId, ...incomingLeaseDates]);
          }
        }
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

          const bedroomCount = normalizeBedroom(r.noOfBedRoom || r.bedroom_count);
          const floorAreaRange = r.areaSqft ? `${r.areaSqft} sqft` : (r.areaSqm ? `${r.areaSqm} sqm` : (r.floor_area_range || null));
          const propertyType = r.propertyType || r.property_type || null;

          const sig = `${leaseDate}|${rentSgd}|${sqft ?? 'null'}|${bedroomCount || ''}|${floorAreaRange || ''}`;
          const occurrenceIndex = (rentOccurrenceTracker.get(sig) || 0) + 1;
          rentOccurrenceTracker.set(sig, occurrenceIndex);

          const rawHash = generateRentHash(projName, leaseDate, rentSgd, sqft, bedroomCount, floorAreaRange, occurrenceIndex, resolvedDistrict, street);

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

    // Step 3.1: Automatically refresh project benchmarks after bulk import
    await refreshProjectBenchmarks(conn);

    console.log(`Real URA Data Import complete: ${totalSalesIngested} sales (skipped ${skippedSalesNoDate} without date), ${totalRentalsIngested} rentals (skipped ${skippedRentalsNoDate} without date).`);
    return { status: 'success', totalSalesIngested, totalRentalsIngested, skippedSalesNoDate, skippedRentalsNoDate };
  } finally {
    if (shouldClose) {
      await conn.close();
    }
  }
}

export async function seedSoraRates(targetConn = null) {
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

  const conn = targetConn || createConnection();
  const shouldClose = !targetConn;
  try {
    await withTransaction(conn, async () => {
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
    if (shouldClose) {
      await conn.close();
    }
  }
}
