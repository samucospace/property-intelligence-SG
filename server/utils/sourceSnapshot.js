import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createConnection,withTransaction} from '../db.js';
import {importRealUraData} from '../ingestion.js';

// Operational source replacement remains quarantined. This prepares a reviewable disposable candidate only.
export async function rehearseSourceSnapshot(target, folder, manifest) {
  if(process.env.NODE_ENV!=='test' || !path.basename(target).startsWith('phase2-source-candidate') || path.resolve(target)===path.resolve('server/property.db'))
    throw Error('Source snapshot replacement is restricted to explicit isolated candidates');
  if(!fs.existsSync(target))throw Error('An existing recoverable candidate is required');
  for(const kind of ['sales','rentals'])if(!manifest[kind]?.dateFrom || !manifest[kind]?.dateTo)throw Error('Explicit covered periods are required');
  const batches=manifest.scopes.filter(s=>s.service==='PMI_Resi_Transaction'&&s.status==='captured');
  if(new Set(batches.map(s=>s.scope)).size!==4 || ![1,2,3,4].every(b=>batches.some(s=>s.scope==='batch='+b)))throw Error('All four validated sales batches are required');
  const firstYear=Number(manifest.rentals.dateFrom.slice(0,4)),lastYear=Number(manifest.rentals.dateTo.slice(0,4));
  const required=[];
  for(let year=firstYear;year<=lastYear;year++)for(let quarter=1;quarter<=4;quarter++){
    const start=`${year}-${String(quarter*3-2).padStart(2,'0')}`,end=`${year}-${String(quarter*3).padStart(2,'0')}`;
    if(start<=manifest.rentals.dateTo && end>=manifest.rentals.dateFrom)required.push(`refPeriod=${String(year%100).padStart(2,'0')}q${quarter}`);
  }
  if(!required.every(scope=>manifest.scopes.some(s=>s.service==='PMI_Resi_Rental'&&s.scope===scope&&s.status==='captured')))throw Error('Incomplete rental quarter coverage');
  const payload=[];
  for(const scope of manifest.scopes.filter(s=>s.status==='captured')){
    if(!scope.filename || path.basename(scope.filename)!==scope.filename || !scope.sha256)throw Error('Invalid captured source path/hash');
    const bytes=fs.readFileSync(path.join(folder,scope.filename));
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==scope.sha256)throw Error('Captured source hash mismatch');
    const data=JSON.parse(bytes);if(data.Status!=='Success'||!Array.isArray(data.Result)||!data.Result.length)throw Error('Invalid captured source envelope');
    const recordField=scope.service==='PMI_Resi_Transaction'?'transaction':scope.service==='PMI_Resi_Rental'?'rental':null;
    if(!recordField || data.Result.some(project=>!Array.isArray(project[recordField]) || project[recordField].length===0))throw Error('Captured source service does not match its records');
    payload.push(...data.Result);
  }
  const conn=createConnection(target);
  try {
    return await withTransaction(conn,async()=>{
      await conn.run(`CREATE TABLE IF NOT EXISTS source_snapshot_archive(snapshot_id TEXT,kind TEXT,original_row TEXT)`);
      const snapshot=manifest.ledgerSha256;
      for(const [kind,table,date] of [['sales','property_transactions','contract_date'],['rentals','rental_transactions','lease_date']]){
        const fields=(await conn.all(`PRAGMA table_info(${table})`)).map(c=>c.name);
        const jsonFields=fields.flatMap(f=>["'"+f+"'",f]).join(',');
        await conn.run(`INSERT INTO source_snapshot_archive SELECT ?,?,json_object(${jsonFields}) FROM ${table} WHERE ${kind==='rentals'?'substr(lease_date,1,7)':date} BETWEEN ? AND ?`,[snapshot,kind,manifest[kind].dateFrom,manifest[kind].dateTo]);
        await conn.run(`DELETE FROM ${table} WHERE ${kind==='rentals'?'substr(lease_date,1,7)':date} BETWEEN ? AND ?`,[manifest[kind].dateFrom,manifest[kind].dateTo]);
      }
      const result=await importRealUraData(payload,conn);
      if((await conn.all('PRAGMA foreign_key_check')).length)throw Error('Snapshot candidate foreign-key violations');
      return {...result,sourceSnapshot: snapshot,operationallyEnabled:false};
    });
  } finally {await conn.close();}
}
