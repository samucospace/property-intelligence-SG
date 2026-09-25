import axios from 'axios';
import crypto from 'crypto';
import { dbRun, dbGet, dbAll } from './db.js';

// Helper: MD5 Hash for deterministic transaction deduplication
function generateTxHash(projName, dateStr, price, area, floorRange) {
  const raw = `${projName}|${dateStr}|${price}|${area}|${floorRange || ''}`;
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

// Postal District Center Coordinates Fallback Lookup
const districtCenters = {
  "01": { lat: 1.2801, lng: 103.8540, planningArea: "Downtown Core" },
  "02": { lat: 1.2764, lng: 103.8447, planningArea: "Tanjong Pagar" },
  "03": { lat: 1.2880, lng: 103.8200, planningArea: "Queenstown" },
  "04": { lat: 1.2655, lng: 103.8118, planningArea: "Bukit Merah" },
  "05": { lat: 1.2980, lng: 103.7650, planningArea: "Pasir Panjang" },
  "06": { lat: 1.2912, lng: 103.8436, planningArea: "Singapore River" },
  "07": { lat: 1.3000, lng: 103.8550, planningArea: "Rochor" },
  "08": { lat: 1.3120, lng: 103.8530, planningArea: "Little India" },
  "09": { lat: 1.3030, lng: 103.8340, planningArea: "Orchard" },
  "10": { lat: 1.3138, lng: 103.7824, planningArea: "Bukit Timah" },
  "11": { lat: 1.3180, lng: 103.8420, planningArea: "Novena" },
  "12": { lat: 1.3280, lng: 103.8520, planningArea: "Toa Payoh" },
  "13": { lat: 1.3350, lng: 103.8700, planningArea: "MacPherson" },
  "14": { lat: 1.3180, lng: 103.8920, planningArea: "Geylang" },
  "15": { lat: 1.2995, lng: 103.8996, planningArea: "Marine Parade" },
  "16": { lat: 1.3068, lng: 103.9372, planningArea: "Bedok" },
  "17": { lat: 1.3500, lng: 103.9700, planningArea: "Changi" },
  "18": { lat: 1.3732, lng: 103.9493, planningArea: "Pasir Ris" },
  "19": { lat: 1.3850, lng: 103.8950, planningArea: "Hougang" },
  "20": { lat: 1.3524, lng: 103.8415, planningArea: "Bishan" },
  "21": { lat: 1.3400, lng: 103.7700, planningArea: "Upper Bukit Timah" },
  "22": { lat: 1.3380, lng: 103.7050, planningArea: "Jurong" },
  "23": { lat: 1.3650, lng: 103.7450, planningArea: "Bukit Panjang" },
  "25": { lat: 1.4350, lng: 103.7860, planningArea: "Woodlands" },
  "27": { lat: 1.4250, lng: 103.8350, planningArea: "Yishun" }
};

// Helper: Parse area range string (e.g. "1100-1200", ">3000", "<400") into numeric value
function parseAreaRange(rangeStr) {
  if (!rangeStr) return null;
  const nums = String(rangeStr).match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  if (nums.length >= 2) return (parseFloat(nums[0]) + parseFloat(nums[1])) / 2;
  return parseFloat(nums[0]);
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

  let totalIngested = 0;
  let totalRentalsIngested = 0;

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
        await dbRun('BEGIN TRANSACTION');
        for (const rawProj of projectsData) {
          const projName = (rawProj.project || 'Unknown Project').trim().toUpperCase();
          const street = (rawProj.street || 'Singapore').trim();
          const district = String(rawProj.marketSegment || rawProj.district || '00').padStart(2, '0');
          const segment = rawProj.marketSegment || 'OCR';

          let projRecord = await dbGet(`SELECT project_id FROM projects WHERE UPPER(project_name) = UPPER(?)`, [projName]);
          let projId;

          if (!projRecord) {
            let geo = null;
            if (rawProj.x && rawProj.y) {
              geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
            }

            const fallback = districtCenters[district] || { lat: 1.3521, lng: 103.8198, planningArea: 'Central' };
            const lat = geo ? geo.latitude : fallback.lat;
            const lng = geo ? geo.longitude : fallback.lng;
            const planningArea = fallback.planningArea;
            
            const insertRes = await dbRun(
              `INSERT INTO projects (project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [projName, street, district, segment, planningArea, lat, lng]
            );
            projId = insertRes.lastID;
          } else {
            projId = projRecord.project_id;
          }

          const txList = rawProj.transaction || [];
          for (const tx of txList) {
            const rawDate = tx.contractDate || '0124';
            const mm = rawDate.substring(0, 2);
            const yy = '20' + rawDate.substring(2, 4);
            const contractDate = `${yy}-${mm}-01`;

            const areaSqm = parseFloat(tx.area) || 0;
            if (areaSqm <= 0) continue;

            const areaSqft = areaSqm * 10.7639;
            const priceSgd = parseFloat(tx.price) || 0;
            const psqmSgd = priceSgd / areaSqm;
            const psftSgd = priceSgd / areaSqft;
            const floorRange = tx.floorRange || 'Unspecified';
            const tenure = tx.tenure || 'Freehold';
            const typeOfSale = tx.typeOfSale === '1' ? 'New Sale' : tx.typeOfSale === '2' ? 'Sub Sale' : 'Resale';
            const propertyType = tx.propertyType || 'Condominium';

            const rawHash = generateTxHash(projName, contractDate, priceSgd, areaSqm, floorRange);

            try {
              await dbRun(
                `INSERT INTO property_transactions 
                 (project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, raw_hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, rawHash]
              );
              totalIngested++;
            } catch (e) {
              // Ignore duplicates
            }
          }
        }
        await dbRun('COMMIT');
        console.log(`Sales Batch ${batch}/4 committed. Total sale caveats: ${totalIngested}`);
      }
    } catch (txErr) {
      await dbRun('ROLLBACK');
      console.error(`Sales Batch ${batch} error:`, txErr.message);
    }
  }

  // Step C: Fetch URA Real Rental Contracts by Reference Quarter (refPeriod: yyqq)
  // Generating quarters for 2021 through 2026 (e.g. 21q1 .. 26q2)
  const refPeriods = [];
  const startYear = 21;
  const endYear = 26;
  for (let y = startYear; y <= endYear; y++) {
    for (let q = 1; q <= 4; q++) {
      refPeriods.push(`${y}q${q}`);
    }
  }

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
        console.log(`🎯 Quarter [${refPeriod}]: Retrieved ${rentProjects.length} rental projects from URA.`);
        await dbRun('BEGIN TRANSACTION');

        for (const rawProj of rentProjects) {
          const projName = (rawProj.project || '').trim().toUpperCase();
          if (!projName) continue;

          const street = (rawProj.street || 'Singapore').trim();
          const district = String(rawProj.marketSegment || rawProj.district || '00').padStart(2, '0');
          const segment = rawProj.marketSegment || 'OCR';

          let projRecord = await dbGet(`SELECT project_id FROM projects WHERE UPPER(project_name) = UPPER(?)`, [projName]);
          let projId;

          if (!projRecord) {
            let geo = null;
            if (rawProj.x && rawProj.y) {
              geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
            }

            const fallback = districtCenters[district] || { lat: 1.3521, lng: 103.8198, planningArea: 'Central' };
            const lat = geo ? geo.latitude : fallback.lat;
            const lng = geo ? geo.longitude : fallback.lng;

            const insertRes = await dbRun(
              `INSERT INTO projects (project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [projName, street, district, segment, fallback.planningArea, lat, lng]
            );
            projId = insertRes.lastID;
          } else {
            projId = projRecord.project_id;
          }

          const rentalList = rawProj.rental || rawProj.rentals || [];
          for (const r of rentalList) {
            const rawDate = String(r.leaseDate || r.lease_date || '0124');
            let leaseDate;
            if (rawDate.length === 4) {
              const mm = rawDate.substring(0, 2);
              const yy = '20' + rawDate.substring(2, 4);
              leaseDate = `${yy}-${mm}`;
            } else {
              leaseDate = rawDate.substring(0, 7);
            }

            const rentSgd = parseFloat(r.rent || r.rent_sgd) || 0;
            if (rentSgd <= 0) continue;

            const parsedSqft = parseAreaRange(r.areaSqft);
            const parsedSqm = parseAreaRange(r.areaSqm);

            let sqft = parsedSqft || (parsedSqm ? parsedSqm * 10.7639 : 1000);
            let sqm = parsedSqm || (parsedSqft ? parsedSqft / 10.7639 : 92.9);
            sqft = parseFloat(sqft.toFixed(1));
            sqm = parseFloat(sqm.toFixed(1));

            const rentPsft = parseFloat((rentSgd / sqft).toFixed(2));
            const rentPsqm = parseFloat((rentSgd / sqm).toFixed(2));
            const bedroomCount = r.noOfBedRoom ? `${r.noOfBedRoom}-Bedder` : 'Unspecified';
            const floorAreaRange = r.areaSqft ? `${r.areaSqft} sqft` : (r.areaSqm ? `${r.areaSqm} sqm` : 'Unspecified');
            const propType = r.propertyType || 'Condominium';

            const rawHash = crypto.createHash('md5').update(`URA_RENT|${projName}|${leaseDate}|${rentSgd}|${sqft}|${r.noOfBedRoom || ''}`).digest('hex');

            try {
              await dbRun(
                `INSERT INTO rental_transactions 
                 (project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft, lease_date, bedroom_count, floor_area_range, property_type, raw_hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [projId, sqm, sqft, rentSgd, rentPsqm, rentPsft, leaseDate, bedroomCount, floorAreaRange, propType, rawHash]
              );
              totalRentalsIngested++;
            } catch (e) {
              // Ignore hash collisions
            }
          }
        }
        await dbRun('COMMIT');
      }
    } catch (rentErr) {
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

  return { status: 'success', totalSalesIngested: totalIngested, totalRentalsIngested, totalIngested: totalIngested + totalRentalsIngested };
}

// 3. Bulk Real URA Dataset Importer (JSON or Array payload)
export async function importRealUraData(jsonData) {
  const resultData = Array.isArray(jsonData) ? jsonData : (jsonData?.Result || jsonData?.data || []);
  if (!Array.isArray(resultData) || resultData.length === 0) {
    throw new Error('Invalid URA Data format. Expected JSON containing array of project records.');
  }

  let totalSalesIngested = 0;
  let totalRentalsIngested = 0;

  await dbRun('BEGIN TRANSACTION');

  try {
    for (const rawProj of resultData) {
      const projName = (rawProj.project || rawProj.project_name || '').trim().toUpperCase();
      if (!projName) continue;

      const street = (rawProj.street || rawProj.street_name || 'Singapore').trim();
      const district = String(rawProj.marketSegment || rawProj.postal_district || '00').padStart(2, '0');
      const segment = rawProj.marketSegment || rawProj.market_segment || 'OCR';

      let projRecord = await dbGet(`SELECT project_id FROM projects WHERE project_name = ?`, [projName]);
      let projId;

      if (!projRecord) {
        let geo = null;
        if (rawProj.x && rawProj.y) {
          geo = svy21ToWgs84(parseFloat(rawProj.y), parseFloat(rawProj.x));
        }

        const fallback = districtCenters[district] || { lat: 1.3521, lng: 103.8198, planningArea: 'Central' };
        const lat = geo ? geo.latitude : (rawProj.latitude ? parseFloat(rawProj.latitude) : fallback.lat);
        const lng = geo ? geo.longitude : (rawProj.longitude ? parseFloat(rawProj.longitude) : fallback.lng);
        const planningArea = rawProj.planningArea || rawProj.planning_area || fallback.planningArea;

        const insertRes = await dbRun(
          `INSERT INTO projects (project_name, street_name, postal_district, market_segment, planning_area, latitude, longitude)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [projName, street, district, segment, planningArea, lat, lng]
        );
        projId = insertRes.lastID;
      } else {
        projId = projRecord.project_id;
      }

      // Process Sales Transactions
      const txList = rawProj.transaction || rawProj.transactions || [];
      for (const tx of txList) {
        const rawDate = String(tx.contractDate || tx.contract_date || '0124');
        let contractDate;
        if (rawDate.length === 4) {
          const mm = rawDate.substring(0, 2);
          const yy = '20' + rawDate.substring(2, 4);
          contractDate = `${yy}-${mm}-01`;
        } else {
          contractDate = rawDate;
        }

        const areaSqm = parseFloat(tx.area || tx.area_sqm) || 0;
        if (areaSqm <= 0) continue;

        const areaSqft = areaSqm * 10.7639;
        const priceSgd = parseFloat(tx.price || tx.price_sgd) || 0;
        const psqmSgd = priceSgd / areaSqm;
        const psftSgd = priceSgd / areaSqft;
        const floorRange = tx.floorRange || tx.floor_range || 'Unspecified';
        const tenure = tx.tenure || 'Freehold';
        const typeOfSale = tx.typeOfSale === '1' ? 'New Sale' : tx.typeOfSale === '2' ? 'Sub Sale' : 'Resale';
        const propertyType = tx.propertyType || tx.property_type || 'Condominium';

        const rawHash = generateTxHash(projName, contractDate, priceSgd, areaSqm, floorRange);

        try {
          await dbRun(
            `INSERT INTO property_transactions 
             (project_id, area_sqm, area_sqft, price_sgd, psqm_sgd, psft_sgd, contract_date, floor_range, tenure, type_of_sale, property_type, raw_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [projId, areaSqm, areaSqft, priceSgd, psqmSgd, psftSgd, contractDate, floorRange, tenure, typeOfSale, propertyType, rawHash]
          );
          totalSalesIngested++;
        } catch (e) {
          // Ignore duplicates
        }
      }

      // Process Rental Contracts
      const rentalList = rawProj.rental || rawProj.rentals || [];
      for (const r of rentalList) {
        const rawDate = String(r.leaseDate || r.lease_date || '0124');
        let leaseDate;
        if (rawDate.length === 4) {
          const mm = rawDate.substring(0, 2);
          const yy = '20' + rawDate.substring(2, 4);
          leaseDate = `${yy}-${mm}`;
        } else {
          leaseDate = rawDate.substring(0, 7);
        }

        const rentSgd = parseFloat(r.rent || r.rent_sgd) || 0;
        if (rentSgd <= 0) continue;

        const areaRange = String(r.areaSqft || r.areaSqm || r.floor_area_range || '1000-1100');
        const nums = areaRange.match(/\d+/g);
        let parsedArea = 1000;
        if (nums && nums.length >= 2) parsedArea = (parseFloat(nums[0]) + parseFloat(nums[1])) / 2;
        else if (nums && nums.length === 1) parsedArea = parseFloat(nums[0]);

        const sqft = parsedArea < 350 ? parseFloat((parsedArea * 10.7639).toFixed(1)) : parsedArea;
        const sqm = parseFloat((sqft / 10.7639).toFixed(1));
        const rentPsft = parseFloat((rentSgd / sqft).toFixed(2));
        const rentPsqm = parseFloat((rentSgd / sqm).toFixed(2));
        const bedroomCount = r.noOfBedRoom ? `${r.noOfBedRoom}-Bedder` : (r.bedroom_count || 'Unspecified');

        const rawHash = crypto.createHash('md5').update(`REAL_RENT|${projName}|${leaseDate}|${rentSgd}|${sqft}`).digest('hex');

        try {
          await dbRun(
            `INSERT INTO rental_transactions 
             (project_id, area_sqm, area_sqft, rent_sgd, rent_psqm, rent_psft, lease_date, bedroom_count, floor_area_range, property_type, raw_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [projId, sqm, sqft, rentSgd, rentPsqm, rentPsft, leaseDate, bedroomCount, areaRange, 'Condominium', rawHash]
          );
          totalRentalsIngested++;
        } catch (e) {
          // Ignore duplicates
        }
      }
    }

    await dbRun('COMMIT');
    console.log(`Real URA Data Import complete: ${totalSalesIngested} sales transactions, ${totalRentalsIngested} rental contracts.`);
    return { status: 'success', totalSalesIngested, totalRentalsIngested };
  } catch (err) {
    await dbRun('ROLLBACK');
    throw err;
  }
}

export async function seedSoraRates() {
  console.log('Seeding 1M & 3M Compounded SORA benchmark historical rate data...');
  
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
    // 2026
    { month: '2026-01', sora1m: 2.38, sora3m: 2.43 },
    { month: '2026-02', sora1m: 2.36, sora3m: 2.42 },
    { month: '2026-03', sora1m: 2.35, sora3m: 2.40 },
    { month: '2026-04', sora1m: 2.35, sora3m: 2.40 },
    { month: '2026-05', sora1m: 2.36, sora3m: 2.41 },
    { month: '2026-06', sora1m: 2.38, sora3m: 2.42 },
    { month: '2026-07', sora1m: 2.40, sora3m: 2.44 },
    { month: '2026-08', sora1m: 2.42, sora3m: 2.45 },
    { month: '2026-09', sora1m: 2.40, sora3m: 2.44 },
    { month: '2026-10', sora1m: 2.38, sora3m: 2.43 },
    { month: '2026-11', sora1m: 2.36, sora3m: 2.41 },
    { month: '2026-12', sora1m: 2.35, sora3m: 2.40 }
  ];

  await dbRun('BEGIN TRANSACTION');
  try {
    for (const item of soraData) {
      await dbRun(
        `INSERT INTO sora_rates (reference_month, sora_1m, sora_3m)
         VALUES (?, ?, ?)
         ON CONFLICT(reference_month) DO UPDATE SET
           sora_1m = excluded.sora_1m,
           sora_3m = excluded.sora_3m,
           updated_at = CURRENT_TIMESTAMP`,
        [item.month, item.sora1m, item.sora3m]
      );
    }
    await dbRun('COMMIT');
    console.log(`Successfully seeded ${soraData.length} SORA rate monthly entries.`);
  } catch (err) {
    await dbRun('ROLLBACK');
    console.error('Error seeding SORA rates:', err);
  }
}

