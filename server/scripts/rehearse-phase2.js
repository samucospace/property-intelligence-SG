import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createConnection,closeDb} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {rehearseSourceSnapshot} from '../utils/sourceSnapshot.js';
import {reconcileDataset} from './reconcile-dataset.js';

process.env.NODE_ENV='test';
const folder=path.resolve('../audit/2026-10-05');
const original=path.resolve('property.db'),copy=path.join(folder,'phase2-rehearsal.sqlite');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=hash(original);
const conn=createConnection(copy);
console.log('Migrating isolated local copy...');
await runMigrations(conn);
const report={sourceBefore:before,counts:{},integrity:await conn.get('PRAGMA integrity_check'),foreignKeys:await conn.all('PRAGMA foreign_key_check'),
 quarantinedIdentities:(await conn.get("SELECT COUNT(*) c FROM project_identity_review WHERE status='pending'")).c,
 sparsePublishedBenchmarks:(await conn.get('SELECT COUNT(*) c FROM project_benchmarks WHERE sale_count<3 AND rolling_24m_median_psft IS NOT NULL')).c};
for(const table of ['projects','property_transactions','rental_transactions','leads'])report.counts[table]=(await conn.get('SELECT COUNT(*) c FROM '+table)).c;
const candidate=path.join(folder,'phase2-source-candidate-v3.sqlite');
if(fs.existsSync(candidate))throw Error('Refusing to overwrite prior source candidate');
await conn.run('VACUUM INTO ?',[candidate]);await conn.close();
const provider=path.join(folder,'provider-source-network');
const manifest=JSON.parse(fs.readFileSync(path.join(provider,'source-manifest.json')));
console.log('Preparing source-matched disposable candidate; original records archived within candidate...');
report.snapshot=await rehearseSourceSnapshot(candidate,provider,manifest);
console.log('Comparing candidate against independently normalized provider ledger...');
report.reconciliation=await reconcileDataset(candidate,path.join(provider,'source-ledger.json'),path.join(provider,'source-manifest.json'));
report.sourceAfter=hash(original);report.sourceUnchanged=report.sourceAfter===before;
fs.writeFileSync(path.join(folder,'phase2-rehearsal-report.json'),JSON.stringify(report,null,2)+'\n');
await closeDb();
console.log(JSON.stringify({originalUnchanged:report.sourceUnchanged,candidateMatch:report.reconciliation.match,sales:report.reconciliation.sales.missing,rentals:report.reconciliation.rentals.missing}));
