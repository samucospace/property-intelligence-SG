import { dbAll } from '../../server/db.js';
import { calculateMedian } from '../../server/utils/math.js';
import {getTodaySingaporeString} from '../../server/utils/dateUtils.js';

export const MIN_YIELD_SAMPLE = 3;
export function saleWindow(dateTo) {
  const end = dateTo.slice(0, 10);
  const start = new Date(end.slice(0,7)+'-01T00:00:00Z');
  start.setUTCMonth(start.getUTCMonth()-23);
  return { dateFrom: start.toISOString().slice(0,10), dateTo: end };
}

// Sales have no bedroom field. Rent-price and bedroom filters select rentals only.
export async function matchedSaleValuations(filters = {}, conn = null) {
  const all = conn ? conn.all.bind(conn) : dbAll;
  const window = saleWindow(filters.dateTo || getTodaySingaporeString());
  const sqft = filters.unitType !== 'sqm';
  const min = Number(filters.unitSizeMin || 0) / (sqft ? 10.7639 : 1);
  const max = Number(filters.unitSizeMax ?? 100000) / (sqft ? 10.7639 : 1);
  const clauses = ['t.contract_date BETWEEN ? AND ?', 't.area_sqm BETWEEN ? AND ?',
    '(t.no_of_units = 1 OR t.no_of_units IS NULL)', 't.price_sgd > 0', 't.psft_sgd > 0', "NOT EXISTS (SELECT 1 FROM project_identity_review q WHERE q.project_id=p.project_id AND q.status='pending')"];
  const params = [window.dateFrom, window.dateTo, min, max];
  const type = filters.propertyType || 'condo';
  if (type === 'condo') clauses.push("(t.property_type IN ('Condominium','Apartment') OR t.property_type IS NULL) AND p.is_landed_aggregate = 0");
  else if (type === 'landed') clauses.push("(p.is_landed_aggregate = 1 OR t.property_type IN ('Detached','Semi-detached','Terrace','Strata Detached','Strata Semi-detached','Strata Terrace','Detached House','Semi-Detached House','Terrace House'))");
  else if (type !== 'all') { clauses.push('t.property_type = ?'); params.push(type === 'ec' ? 'Executive Condominium' : type); }
  if (['freehold','leasehold'].includes(filters.tenure)) { clauses.push('t.tenure_class = ?'); params.push(filters.tenure); }
  if(filters.district) { clauses.push('COALESCE(t.source_district,p.postal_district) = ?'); params.push(String(filters.district).padStart(2,'0')); }
  const rows = await all(`WITH ranked AS (
    SELECT t.project_id, t.price_sgd, t.psft_sgd,
      ROW_NUMBER() OVER (PARTITION BY t.project_id ORDER BY t.psft_sgd) rn_psft,
      ROW_NUMBER() OVER (PARTITION BY t.project_id ORDER BY t.price_sgd) rn_price,
      COUNT(*) OVER (PARTITION BY t.project_id) cnt
    FROM property_transactions t JOIN projects p ON p.project_id=t.project_id
    WHERE ${clauses.join(' AND ')}
  ) SELECT project_id, cnt saleCount,
    AVG(CASE WHEN rn_psft IN ((cnt+1)/2,(cnt+2)/2) THEN psft_sgd END) medianPsft,
    AVG(CASE WHEN rn_price IN ((cnt+1)/2,(cnt+2)/2) THEN price_sgd END) medianPrice
    FROM ranked GROUP BY project_id`, params);
  return new Map(rows.map(r => [r.project_id, { ...window, saleCount: r.saleCount,
    medianPsft: r.saleCount >= MIN_YIELD_SAMPLE ? r.medianPsft : null,
    medianPrice: r.saleCount >= MIN_YIELD_SAMPLE ? r.medianPrice : null }]));
}

export function projectYield(rentPsft, rentalSample, sale) {
  return rentalSample >= MIN_YIELD_SAMPLE && rentPsft > 0 && sale?.saleCount >= MIN_YIELD_SAMPLE && sale.medianPsft > 0
    ? Number((rentPsft * 1200 / sale.medianPsft).toFixed(2)) : null;
}

export async function newsletterYieldRanking(conn, dateTo = getTodaySingaporeString()) {
  const all = conn ? conn.all.bind(conn) : dbAll;
  const window = saleWindow(dateTo);
  const valuations = await matchedSaleValuations({dateTo}, conn);
  const rows = await all(`SELECT r.*, p.project_name, p.postal_district, p.market_segment
    FROM rental_transactions r JOIN projects p ON p.project_id=r.project_id
    WHERE substr(r.lease_date,1,7) BETWEEN ? AND ? AND r.rent_psft > 0 AND p.is_landed_aggregate=0 AND NOT EXISTS (SELECT 1 FROM project_identity_review q WHERE q.project_id=p.project_id AND q.status='pending')
    AND (r.property_type IN ('Condominium','Apartment','Non-landed Properties') OR r.property_type IS NULL)`,
    [window.dateFrom.slice(0,7), dateTo.slice(0,7)]);
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.project_id)) groups.set(row.project_id, []); groups.get(row.project_id).push(row); }
  return [...groups.entries()].map(([id, rentals]) => {
    const sale = valuations.get(id);
    const rent = calculateMedian(rentals.map(r => r.rent_psft));
    return {...rentals[0], rental_count: rentals.length, avg_rent: calculateMedian(rentals.map(r=>r.rent_sgd)),
      avg_psft: rent, avg_sale_price: sale?.medianPrice, gross_yield: projectYield(rent, rentals.length, sale), saleBenchmark: sale};
  }).filter(r=>r.gross_yield !== null).sort((a,b)=>b.gross_yield-a.gross_yield || a.project_id-b.project_id).slice(0,5);
}
