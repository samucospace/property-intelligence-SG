// One-time local sign-off. No source downloads, scheduled jobs or email are enabled.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createConnection} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {openReadonly,databaseMetrics,fileHash} from '../utils/databaseArtifacts.js';
import {operationalStatePreserved} from '../utils/rebuildEngine.js';
import {promoteReviewedCandidate,recoverReviewedPromotion} from '../utils/reviewedPromotion.js';
import {reconcileDataset} from './reconcile-dataset.js';
import {captureBaseline} from './baseline-drill.js';

process.env.NODE_ENV='test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const folder=path.join(root,'audit/2026-10-05');
const target=path.join(root,'server/property.db');
const candidate=path.join(folder,'phase2-source-candidate-final-approved.sqlite');
const reportFile=path.join(folder,'phase2-final-candidate.json');
const ledger=path.join(folder,'provider-source-network/source-ledger.json');
const manifestFile=path.join(folder,'provider-source-network/source-manifest.json');
const approvalFile=path.join(root,'server/migrations/data/project_adjudication_map.json');
const count={projects:5905,property_transactions:132305,rental_transactions:451165,leads:0};
const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
async function checkpoint(file){const c=createConnection(file);try{const r=await c.get('PRAGMA wal_checkpoint(TRUNCATE)');assert.equal(r.busy,0);}finally{await c.close();}}
async function validate(file){
 const metrics=await databaseMetrics(file);for(const [table,n] of Object.entries(count))assert.equal(metrics.counts[table],n);
 const c=openReadonly(file);
 try{
  assert.equal((await c.get("SELECT COUNT(*) n FROM project_identity_review WHERE status='pending'")).n,0);
  assert.equal((await c.get("SELECT COUNT(*) n FROM project_identity_review WHERE status='approved' AND reviewed_by='Sam Fraser'")).n,35);
  assert.ok(await c.get("SELECT name FROM schema_migrations WHERE name='014_apply_reviewed_legacy_identities'"));
  assert.equal((await c.get("SELECT COUNT(*) n FROM project_benchmarks WHERE sale_count<3 AND rolling_24m_median_psft IS NOT NULL")).n,0);
  assert.equal((await c.get("SELECT COUNT(*) n FROM source_snapshot_archive WHERE kind='sales'")).n,133359);
  assert.equal((await c.get("SELECT COUNT(*) n FROM source_snapshot_archive WHERE kind='rentals'")).n,450722);
 }finally{await c.close();}
 const reconciliation=await reconcileDataset(file,ledger,manifestFile);assert.equal(reconciliation.match,true);
 return {match:true,metrics,reconciliation};
}
async function preservation(original,replacement){
 const bounds=JSON.parse(fs.readFileSync(manifestFile));const a=openReadonly(original),b=openReadonly(replacement);const result={};
 try{
  for(const [kind,table,date,amount] of [['sales','property_transactions','contract_date','price_sgd'],['rentals','rental_transactions','lease_date','rent_sgd']]){
   const expression=kind==='rentals'?`substr(${date},1,7)`:date;
   const scope=[bounds[kind].dateFrom,bounds[kind].dateTo];
   const rows=await a.all(`SELECT project_id,${date},${amount} FROM ${table} WHERE ${expression} NOT BETWEEN ? AND ?`,scope);
   const other=await b.all(`SELECT project_id,${date},${amount} FROM ${table} WHERE ${expression} NOT BETWEEN ? AND ?`,scope);
   const canonical=rs=>rs.map(r=>JSON.stringify(r)).sort();assert.deepEqual(canonical(rows),canonical(other));
   // Every covered original identity/date/amount must be recoverable from the archive.
   const covered=await a.all(`SELECT project_id,${date},${amount} FROM ${table} WHERE ${expression} BETWEEN ? AND ?`,scope);
   const archived=(await b.all('SELECT original_row FROM source_snapshot_archive WHERE kind=?',[kind])).map(r=>JSON.parse(r.original_row)).map(r=>({project_id:r.project_id,[date]:r[date],[amount]:r[amount]}));
   assert.deepEqual(canonical(covered),canonical(archived));
   result[kind]={olderRecordsPreserved:rows.length,coveredOriginalRecordsArchived:covered.length,identityDatesAmountsMatch:true};
  }
 }finally{await a.close();await b.close();}
 assert.equal(await operationalStatePreserved(original,replacement,['job_slots']),true);
 return {passed:true,operationalStatePreserved:true,...result};
}
const mode=process.argv[2];
if(mode==='--recover')console.log(JSON.stringify(await recoverReviewedPromotion(target)));
else if(mode==='--prepare'){
 assert.ok(!fs.existsSync(candidate)&&!fs.existsSync(reportFile),'Refusing to overwrite prior sign-off artifacts');
 const originalHash=fileHash(target);assert.equal(originalHash,'e6067d6033aac82c3392db8108fd7221ecefa576e44c7efb247ead6b381fa252');
 const previous=path.join(folder,'phase2-source-candidate-v3.sqlite');await checkpoint(previous);
 assert.equal(fileHash(previous),'a0a3593c817dae2041155f54a0f5b462715f2c1912301fb51dc1e461474ca451');
 fs.copyFileSync(previous,candidate,fs.constants.COPYFILE_EXCL);
 const c=createConnection(candidate);try{await runMigrations(c);}finally{await c.close();}
 const validation=await validate(candidate),preserved=await preservation(target,candidate);
 await checkpoint(candidate);await checkpoint(target);
 assert.equal(fileHash(target),originalHash);
 const baseline=await captureBaseline({sourcePath:target,backupRoot:path.join(root,'server/backups'),keyFile:path.join(root,'.recovery-keys/phase0.key'),restoreRoot:path.join(folder,'phase2-final-restore')});
 assert.equal((await databaseMetrics(baseline.restoredPath)).integrity,'ok');
 await checkpoint(target);assert.equal(fileHash(target),originalHash);
 const report={preparedAt:new Date().toISOString(),releaseOwner:'Sam Fraser',target,candidate,originalSha256:originalHash,candidateSha256:fileHash(candidate),approvalSha256:fileHash(approvalFile),ledgerSha256:fileHash(ledger),manifestSha256:fileHash(manifestFile),validation,preservation:preserved,backup:{captureId:baseline.captureId,encryptedBackup:baseline.encryptedBackup,encryptedSha256:baseline.encryptedSha256,restoredPath:baseline.restoredPath,snapshotSha256:baseline.snapshotSha256,freshProcessRestore:true}};
 write(reportFile,report);console.log(JSON.stringify({prepared:true,counts:validation.metrics.counts,candidateSha256:report.candidateSha256,backupRestored:true}));
}else if(mode==='--promote'){
 const report=JSON.parse(fs.readFileSync(reportFile));
 assert.equal(report.target,target);assert.equal(report.candidate,candidate);
 assert.equal(report.approvalSha256,fileHash(approvalFile));assert.equal(report.ledgerSha256,fileHash(ledger));assert.equal(report.manifestSha256,fileHash(manifestFile));
 assert.equal(report.backup.freshProcessRestore,true);assert.equal(fileHash(report.backup.encryptedBackup),report.backup.encryptedSha256);
 assert.equal(fileHash(report.backup.restoredPath),report.backup.snapshotSha256);
 await preservation(target,candidate);await checkpoint(target);await checkpoint(candidate);
 const result=await promoteReviewedCandidate({targetPath:target,candidatePath:candidate,expectedTargetHash:report.originalSha256,expectedCandidateHash:report.candidateSha256,validateCandidate:validate,allowEmptyAddedTables:['job_slots']});
 write(path.join(folder,'phase2-final-promotion.json'),{completedAt:new Date().toISOString(),...result,rollbackBackupPath:result.backup,validation:await validate(target),backup:report.backup});
 await checkpoint(target);console.log(JSON.stringify(result));
}else throw Error('Usage: NODE_ENV=test node scripts/finish-phase2.js --prepare | --promote | --recover (one-time 5 October snapshot)');
