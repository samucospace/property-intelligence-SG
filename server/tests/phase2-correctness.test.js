import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getPrimaryConnection,closeDb,createConnection} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {getRentalYieldAnalytics,getPriceAnalytics,refreshProjectBenchmarks,getAllProjects,getProjectSaleValuation} from '../queryEngine.js';
import {getProjectLivability} from '../livabilityEngine.js';
import {newsletterYieldRanking} from '../utils/yieldMetrics.js';
import {up as reconcile} from '../migrations/010_reconcile_duplicate_projects.js';
import {seedSoraRates,parseAreaRange} from '../ingestion.js';
import {buildNewsletterHtml} from '../scripts/send-weekly-newsletter.js';
import {compareLedgers} from '../scripts/reconcile-dataset.js';
import {rehearseSourceSnapshot} from '../utils/sourceSnapshot.js';
import crypto from 'node:crypto';
import {applyLegacyIdentityApprovals,reviewSchema} from '../utils/projectAdjudication.js';

describe('Phase 2 independent correctness regressions',()=>{
 let conn,folder,previous;
 beforeEach(async()=>{
  await closeDb(); previous=process.env.DB_PATH;
  folder=fs.mkdtempSync(path.join(os.tmpdir(),'property-phase2-'));
  process.env.DB_PATH=path.join(folder,'fixture.sqlite'); conn=getPrimaryConnection(); await runMigrations(conn);
 });
 afterEach(async()=>{await closeDb();process.env.DB_PATH=previous;fs.rmSync(folder,{recursive:true,force:true});});
 async function project(id=1){await conn.run("INSERT INTO projects(project_id,project_name,street_name,postal_district,market_segment,latitude,longitude,geo_source,is_landed_aggregate) VALUES(?,?,'TEST ROAD','10','CCR',1.3,103.8,'svy21',0)",[id,'FIXTURE '+id]);}
 async function sales(id,prices=[2000,2000,2000],date='2022-06-01',area=1000){
  for(const psf of prices)await conn.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,area_sqft,area_sqm,psft_sgd,psqm_sgd,no_of_units,property_type) VALUES(?,?,?,?,?,?,?,1,'Apartment')",[id,date,psf*area,area,area/10.7639,psf,psf*10.7639]);
 }
 async function rents(id,values=[5,5,5],date='2022-06',area=1000){
  for(const psf of values)await conn.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,area_sqft,rent_psft,property_type,bedroom_count) VALUES(?,?,?,?,?,'Apartment',2)",[id,date,psf==null?5000:psf*area,area,psf]);
 }
 const filter={dateFrom:'2022-01-01',dateTo:'2022-12-31',propertyType:'condo'};
 it('matches historical benchmark and drawer/caveat/newsletter estimates with hand arithmetic',async()=>{
  await project();await sales(1,[1000,2000,9000]);await sales(1,[8000,8000,8000],'2026-01-01');await rents(1,[4,5,12]);
  const a=await getRentalYieldAnalytics(filter);
  expect(a.summary.avgGrossYield).toBe(3);expect(a.mapProjects[0].grossYield).toBe(3);
  expect(a.mapProjects[0].medianSalePsft).toBe(2000);expect(a.mapProjects[0].saleBenchmark.saleCount).toBe(3);
  expect(a.rentalCaveats.map(r=>r.grossYield).sort((a,b)=>a-b)).toEqual([2.4,3,7.2]);
  const email=await newsletterYieldRanking(conn,'2022-12-31');expect(email[0].gross_yield).toBe(3);
  expect(a.metricContract.saleWindow).toEqual({dateFrom:'2021-01-01',dateTo:'2022-12-31'});
 });
 it('withholds one-sale/three-rental yields independently of rental sparsity',async()=>{
  await project();await sales(1,[2000]);await rents(1);
  const a=await getRentalYieldAnalytics(filter);expect(a.summary.avgGrossYield).toBeNull();expect(a.mapProjects[0].grossYield).toBeNull();
  expect(a.rentalCaveats.every(r=>r.grossYield===null)).toBe(true);expect(await newsletterYieldRanking(conn,'2022-12-31')).toEqual([]);
 });
 it('requires three usable rental psf values, not merely three leases',async()=>{
  await project();await sales(1);await rents(1,[null,null,5]);
  const a=await getRentalYieldAnalytics(filter);expect(a.summary.totalLeases).toBe(3);expect(a.mapProjects[0].usableRentalCount).toBe(1);expect(a.summary.avgGrossYield).toBeNull();
 });
 it('matches unit-size sales instead of all-unit project benchmarks',async()=>{
  await project();await sales(1,[1000,1000,1000],'2022-06-01',500);await sales(1,[9000,9000,9000],'2022-06-01',1500);await rents(1,[5,5,5],'2022-06',500);
  const a=await getRentalYieldAnalytics({...filter,unitSizeMin:450,unitSizeMax:600});expect(a.summary.avgGrossYield).toBe(6);
 });
 it('uses selected windows for counts, summary, map and disjoint same-month pages',async()=>{
  await project();await sales(1);await rents(1,[3,3,3],'2019-02');await rents(1,[5,5,5],'2022-06');
  const ids=[];
  for(let page=1;page<=6;page++){
   const a=await getRentalYieldAnalytics({...filter,dateFrom:'2019-01-01',limit:1,page});
   expect(a.totalCount).toBe(6);expect(a.totalPages).toBe(6);expect(a.summary.totalLeases).toBe(6);expect(a.mapProjects[0].txCount).toBe(6);ids.push(a.rentalCaveats[0].rentalId);
  }
  expect(new Set(ids).size).toBe(6);
  const narrow=await getRentalYieldAnalytics({...filter,dateFrom:'2022-06-01',dateTo:'2022-06-30'});expect(narrow.totalCount).toBe(3);expect(narrow.summary.medianRentPsft).toBe(5);
 });
 it('same-connection and external commits invalidate cached analytics and valuations',async()=>{
  await project();await sales(1,[2000,2000,2000],new Date().toISOString().slice(0,10));await refreshProjectBenchmarks(conn);
  expect((await getProjectSaleValuation(1)).medianPsft).toBe(2000);
  const first=await getPriceAnalytics({projects:[1]});await conn.run('UPDATE property_transactions SET price_sgd=4000000,psft_sgd=4000');
  expect((await getPriceAnalytics({projects:[1]})).summary.medianPrice).toBe(4000000);
  const other=createConnection(process.env.DB_PATH);
  try{await other.run('UPDATE project_benchmarks SET rolling_24m_median_psft=4000');}finally{await other.close();}
  expect((await getProjectSaleValuation(1)).medianPsft).toBe(4000);expect(first.summary.medianPrice).toBe(2000000);
 });
 it('current benchmarks exclude sparse, invalid and future sales',async()=>{
  await project();await sales(1,[2000],new Date().toISOString().slice(0,10));await sales(1,[4000,4000,4000],'2099-01-01');await refreshProjectBenchmarks(conn);
  expect((await conn.get('SELECT rolling_24m_median_psft n FROM project_benchmarks WHERE project_id=1')).n).toBeNull();
  expect((await getAllProjects())[0].avgPsft).toBeNull();
 });
 it('detail API withholds approximate locations even if stale scores and supplied coordinates exist',async()=>{
  await project();await conn.run("UPDATE projects SET geo_source='district_centre',livability_score=99,livability_data=?",[JSON.stringify({nearest:{mrt:[{name:'STALE'}]}})]);
  expect((await getProjectLivability(1,1.3,103.8,{mrt:1})).score).toBeNull();
  const {app}=await import('../index.js');
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/1/livability`);const body=await res.json();
    expect(res.status).toBe(200);expect(body.livability.score).toBeNull();expect(body.livability.nearest).toEqual({});
  } finally {await new Promise(resolve=>server.close(resolve));}
  expect((await getAllProjects())[0].livability.subScores.mrt).toBeNull();
  await conn.run("UPDATE projects SET geo_source='provider',latitude=NULL,livability_data=?",[JSON.stringify({subScores:{mrt:99},nearest:{mrt:[{name:'STALE'}]}})]);
  const missingCoordinates=(await getAllProjects())[0];
  expect(missingCoordinates.livability.score).toBeNull();
  expect(missingCoordinates.livability.subScores.mrt).toBeNull();
  await rents(1);
  const rentalMap=(await getRentalYieldAnalytics(filter)).mapProjects[0];
  expect(rentalMap.livability.score).toBeNull();
  expect(rentalMap.livability.nearest).toEqual({});
 });
 it('detail reflects changed amenity catalog without serving cached prior distances',async()=>{
  await project();await conn.run("INSERT INTO amenities(category,name,latitude,longitude,source) VALUES('mrt','FIRST',1.301,103.801,'seed')");
  expect((await getProjectLivability(1)).nearest.mrt[0].name).toBe('FIRST');
  const other=createConnection(process.env.DB_PATH);try{await other.run("UPDATE amenities SET name='SECOND'");}finally{await other.close();}
  expect((await getProjectLivability(1)).nearest.mrt[0].name).toBe('SECOND');
 });
 it('unapproved normalization collisions preserve owners and are excluded from public analytics',async()=>{
  await project();await project(2);await conn.run("UPDATE projects SET project_name='AMBIGUOUS',street_name=CASE project_id WHEN 1 THEN 'ST. TEST ROAD' ELSE 'SAINT TEST ROAD' END");await sales(1);await rents(2);
  await reconcile(conn,{adjudications:[]});expect((await conn.get('SELECT COUNT(*) c FROM projects')).c).toBe(2);
  expect((await getPriceAnalytics(filter)).totalCount).toBe(0);expect((await getRentalYieldAnalytics(filter)).totalCount).toBe(0);
  expect((await conn.get('SELECT project_id FROM rental_transactions')).project_id).toBe(2);
 });
 it('rejects mapping approval without evidence or mismatched source identity atomically',async()=>{
  await project();await project(2);
  await expect(reconcile(conn,{adjudications:[{sourceId:2,targetId:1,status:'approved'}]})).rejects.toThrow('approval');
  expect((await conn.get('SELECT COUNT(*) c FROM projects')).c).toBe(2);
 });
 it('historical identity acceptance does not replay a merge when its removed source is absent',async()=>{
  await project();await sales(1);await rents(1);
  await reconcile(conn,{adjudications:[{sourceId:999,targetId:1,status:'approved',reviewType:'legacy-merge-acceptance',approvedBy:'Fixture reviewer',approvedAt:'2026-10-05',sourceEvidence:'Previously merged identity acceptance'}]});
  expect((await conn.get('SELECT COUNT(*) c FROM projects')).c).toBe(1);
  expect((await conn.get('SELECT COUNT(*) c FROM property_transactions WHERE project_id=1')).c).toBe(3);
  expect((await conn.get('SELECT COUNT(*) c FROM rental_transactions WHERE project_id=1')).c).toBe(3);
 });
 it('open-ended rental bands have no inferred precise midpoint',()=>{
  expect(parseAreaRange('>3000')).toBeNull();expect(parseAreaRange('<=400')).toBeNull();expect(parseAreaRange('1100-1200')).toBe(1150);expect(parseAreaRange('98.1')).toBe(98.1);
 });
 it('applies historical acceptance without moving transactions and rolls back conflicting reviews',async()=>{
  await project();await sales(1);await rents(1);
  const entry={sourceId:999,targetId:1,projectName:'FIXTURE 1',status:'approved',reviewType:'legacy-merge-acceptance',approvedBy:'Fixture reviewer',approvedAt:'2026-10-05',sourceEvidence:'Retained source evidence',expectedSource:{project_name:'FIXTURE 1',street_name:'TEST ROAD'},expectedTarget:{project_name:'FIXTURE 1',street_name:'TEST ROAD',postal_district:'10'}};
  expect((await applyLegacyIdentityApprovals(conn,[entry])).applied).toBe(1);
  expect((await conn.get('SELECT COUNT(*) c FROM property_transactions WHERE project_id=1')).c).toBe(3);
  expect((await conn.get('SELECT COUNT(*) c FROM rental_transactions WHERE project_id=1')).c).toBe(3);
  await conn.run("UPDATE project_identity_review SET status='pending', reason='Separate unresolved source conflict'");
  await expect(applyLegacyIdentityApprovals(conn,[entry])).rejects.toThrow('Separate identity conflict');
  expect((await conn.get('SELECT status FROM project_identity_review WHERE project_id=1')).status).toBe('pending');
  await expect(applyLegacyIdentityApprovals(conn,[{...entry,expectedTarget:{...entry.expectedTarget,project_name:'DIFFERENT'}}])).rejects.toThrow('precondition');
 });
 it('legacy SORA fixture cannot overwrite existing rates or advertise a verified MAS benchmark',async()=>{
  await conn.run("INSERT INTO sora_rates(reference_month,sora_1m,sora_3m) VALUES('2026-09',99,98)");await seedSoraRates(conn);
  expect((await conn.get("SELECT sora_3m FROM sora_rates WHERE reference_month='2026-09'")).sora_3m).toBe(98);
  const html=buildNewsletterHtml({topYields:[],sora:{sora_3m:2.4},recentCaveats:[],recipientEmail:'fixture@example.com',baseUrl:'https://example.com'});
  expect(html).not.toContain('MAS Benchmark');expect(html).toContain('unverified');
 });
 it('reconciliation checks full identity multiplicity, not count and value totals alone',()=>{
  const row={project_name:'A',street_name:'ST. TEST ROAD',postal_district:'10',lease_date:'2022-01',rent_sgd:4000,floor_area_range:'500-600 sqft',bedroom_count:'1-Bedder'};
  const other={...row,street_name:'OTHER ROAD'};
  const result=compareLedgers('rentals',[row,row],[row,other]);expect(result.sourceCount).toBe(result.databaseCount);expect(result.sourceValueTotal).toBe(result.databaseValueTotal);expect(result.missing).toBe(1);expect(result.extra).toBe(1);
 });
 it('partial or malformed source replacement candidates roll back deletions and preserve history',async()=>{
  await project();await sales(1);await closeDb();
  const candidate=path.join(folder,'phase2-source-candidate.sqlite');fs.copyFileSync(process.env.DB_PATH,candidate);
  const manifest={sales:{dateFrom:'2022-01-01',dateTo:'2022-12-31'},rentals:{dateFrom:'2022-01',dateTo:'2022-03'},scopes:[],ledgerSha256:'fixture'};
  await expect(rehearseSourceSnapshot(candidate,folder,manifest)).rejects.toThrow('four');
  for(let batch=1;batch<=4;batch++){
   const filename='batch'+batch+'.json';const bytes=JSON.stringify({Status:'Success',Result:[{project:'MALFORMED '+batch,street:'TEST ROAD',marketSegment:'CCR',transaction:[{contractDate:'0622',area:100,price:0,district:'10'}]}]});
   fs.writeFileSync(path.join(folder,filename),bytes);manifest.scopes.push({service:'PMI_Resi_Transaction',scope:'batch='+batch,status:'captured',filename,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  manifest.scopes.push({...manifest.scopes[0],service:'PMI_Resi_Rental',scope:'refPeriod=22q1'});
  await expect(rehearseSourceSnapshot(candidate,folder,manifest)).rejects.toThrow('service');
  const rentalBytes=JSON.stringify({Status:'Success',Result:[{project:'VALID RENTAL',street:'TEST ROAD',rental:[{leaseDate:'0322',rent:4000,areaSqft:'500-600',district:'10',propertyType:'Condominium',noOfBedrooms:'2'}]}]});
  fs.writeFileSync(path.join(folder,'rental.json'),rentalBytes);
  Object.assign(manifest.scopes[4],{filename:'rental.json',sha256:crypto.createHash('sha256').update(rentalBytes).digest('hex')});
  await expect(rehearseSourceSnapshot(candidate,folder,manifest)).rejects.toThrow('Malformed');
  const check=createConnection(candidate);try{expect((await check.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(3);expect(await check.get("SELECT name FROM sqlite_master WHERE name='source_snapshot_archive'")).toBeUndefined();}finally{await check.close();}
 });
 it('complete radius and combined filters aggregate every qualifying record without a 200-row cap',async()=>{
  for(let id=1;id<=251;id++){await project(id);await sales(id,[2000],'2022-06-01',500);}
  await conn.run("UPDATE projects SET latitude=1.6 WHERE project_id=250");await conn.run("UPDATE projects SET geo_source='district_centre' WHERE project_id=251");
  await sales(1,[9000],'2022-06-01',1500);
  const a=await getPriceAnalytics({...filter,district:'10',unitSizeMin:450,unitSizeMax:600,centerCoords:{lat:1.3,lng:103.8},radiusKm:1,limit:500});
  expect(a.totalCount).toBe(249);expect(a.scatter).toHaveLength(249);expect(a.mapProjects).toHaveLength(249);expect(a.summary.totalVolume).toBe(249);
 });
 it('keeps source transaction districts independent of legacy project district labels',async()=>{
  await project();await sales(1);await rents(1);await conn.run("UPDATE rental_transactions SET source_district='09'");await conn.run("UPDATE property_transactions SET source_district='09'");
  const a=await getRentalYieldAnalytics({...filter,district:'09'});expect(a.totalCount).toBe(3);expect(a.summary.avgGrossYield).toBe(3);
  expect((await getRentalYieldAnalytics({...filter,district:'10'})).totalCount).toBe(0);
 });
});
