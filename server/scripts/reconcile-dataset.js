import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import {pathToFileURL} from 'node:url';
import {normalizeStreetName} from '../utils/streetUtils.js';

export const ledgerFields = {
  sales:['project_name','street_name','postal_district','contract_date','price_sgd','area_sqm','floor_range','tenure','type_of_sale','property_type','no_of_units'],
  rentals:['project_name','street_name','postal_district','lease_date','rent_sgd','floor_area_range','bedroom_count','property_type']
};
function key(kind,row) {
  return JSON.stringify(ledgerFields[kind].map(field=>{
    const value=row[field] ?? null;
    if(field==='street_name')return normalizeStreetName(value);
    if(field==='project_name')return String(value).trim().toUpperCase();
    if(field==='lease_date')return String(value).slice(0,7);
    if(field==='postal_district')return value == null ? null : String(value).padStart(2,'0');
    return value;
  }));
}
export function compareLedgers(kind, source, actual) {
  const counts=rows=>{const map=new Map();for(const row of rows){const k=key(kind,row);map.set(k,(map.get(k)||0)+1);}return map;};
  const expected=counts(source), observed=counts(actual);let missing=0,extra=0;const examples=[];
  for(const identity of new Set([...expected.keys(),...observed.keys()])){
    const difference=(observed.get(identity)||0)-(expected.get(identity)||0);
    if(difference<0)missing-=difference;else extra+=difference;
    if(difference && examples.length<20)examples.push({identity:JSON.parse(identity),sourceMultiplicity:expected.get(identity)||0,databaseMultiplicity:observed.get(identity)||0});
  }
  const amount=kind==='sales'?'price_sgd':'rent_sgd';
  return {sourceCount:source.length,databaseCount:actual.length,missing,extra,
    sourceValueTotal:source.reduce((n,r)=>n+Number(r[amount]),0),databaseValueTotal:actual.reduce((n,r)=>n+Number(r[amount]),0),examples,match:missing===0&&extra===0};
}

// Source is a canonical, scoped ledger exported from independently retained provider batches.
// A matching comparison is evidence of parity, not independent proof of provider completeness.
export async function reconcileDataset(databasePath, sourcePath, manifestPath) {
  const bytes=fs.readFileSync(sourcePath);const source=JSON.parse(bytes);const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  if(manifest.ledgerSha256!==digest || !manifest.sourceEvidence || !manifest.capturedAt || !Array.isArray(manifest.scopes) || !manifest.scopes.length)
    throw Error('Source manifest must bind the ledger hash, scope, capture date and source evidence');
  for(const kind of ['sales','rentals']){
    if(!Array.isArray(source[kind]) || !manifest[kind]?.dateFrom || !manifest[kind]?.dateTo)throw Error('Both explicit source periods and ledgers are required');
    const date=kind==='sales'?'contract_date':'lease_date';const amount=kind==='sales'?'price_sgd':'rent_sgd';
    for(const row of source[kind]){
      if(!row.project_name || !row.street_name || !row.postal_district || !row[date] || !(row[amount]>0) || !Number.isFinite(Number(row[amount])))throw Error('Malformed source ledger');
      if(String(row[date]).slice(0,kind==='sales'?10:7)<manifest[kind].dateFrom || String(row[date]).slice(0,kind==='sales'?10:7)>manifest[kind].dateTo)throw Error('Source row outside explicit scope');
    }
  }
  const db=await new Promise((resolve,reject)=>{const opened=new sqlite3.Database(databasePath,sqlite3.OPEN_READONLY,error=>error?reject(error):resolve(opened));});
  const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(e,rows)=>e?reject(e):resolve(rows)));
  try {
    await all('BEGIN');
    const report={ledgerSha256:digest,sourceEvidence:manifest.sourceEvidence,sourceCompleteness:'unverified until independently reviewed',scopes:manifest.scopes};
    for(const [kind,table,date] of [['sales','property_transactions','contract_date'],['rentals','rental_transactions','lease_date']]){
      const hasDistrict=(await all(`PRAGMA table_info(${table})`)).some(c=>c.name==='source_district');
      const rows=await all(`SELECT t.*,p.project_name,p.street_name,${hasDistrict?'COALESCE(t.source_district,p.postal_district)':'p.postal_district'} AS postal_district FROM ${table} t JOIN projects p ON p.project_id=t.project_id WHERE ${kind==='rentals'?'substr(t.lease_date,1,7)':'t.contract_date'} BETWEEN ? AND ?`,[manifest[kind].dateFrom,manifest[kind].dateTo]);
      report[kind]=compareLedgers(kind,source[kind],rows);
    }
    report.integrity=await all('PRAGMA integrity_check');report.foreignKeys=await all('PRAGMA foreign_key_check');
    report.match=report.sales.match&&report.rentals.match&&report.foreignKeys.length===0&&report.integrity.every(r=>r.integrity_check==='ok');
    await all('COMMIT');
    return report;
  } finally {await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [db,source,manifest,output]=process.argv.slice(2);
  if(!db||!source||!manifest||!output)throw Error('Usage: reconcile-dataset.js DATABASE SOURCE_LEDGER SOURCE_MANIFEST REPORT_OUTPUT');
  if(fs.existsSync(output))throw Error('Refusing to overwrite an existing reconciliation report');
  const report=await reconcileDataset(db,source,manifest);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');if(!report.match)process.exitCode=1;
}
