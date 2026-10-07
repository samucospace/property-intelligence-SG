import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createConnection,closeDb,getPrimaryConnection} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {seedAmenities,initLivabilityCache} from '../livabilityEngine.js';
import {seedAmenitiesData} from '../amenitiesData.js';
import {initSaleValuationsCache} from '../queryEngine.js';
import {marketVersion} from '../utils/analyticsSnapshots.js';

describe('Atomic concurrent startup preparation',()=>{
 let folder,previous,db,other;
 beforeEach(async()=>{
  await closeDb();previous=process.env.DB_PATH;folder=fs.mkdtempSync(path.join(os.tmpdir(),'startup-preparation-'));
  process.env.DB_PATH=path.join(folder,'fixture.db');db=getPrimaryConnection();await runMigrations(db);other=createConnection();
  await db.run("INSERT INTO projects(project_id,project_name,street_name,market_segment,latitude,longitude,geo_source) VALUES(1,'PUBLIC FIXTURE','FIXTURE ROAD','CCR',1.3,103.8,'svy21')");
 });
 afterEach(async()=>{vi.restoreAllMocks();await other.close();await closeDb();process.env.DB_PATH=previous;fs.rmSync(folder,{recursive:true,force:true});});
 it('seeds once when both processes initially observe an absent seed version',async()=>{
  let reads=0,release;const bothRead=new Promise(resolve=>release=resolve);
  for(const conn of [db,other]) {
   const get=conn.get.bind(conn);let first=true;
   vi.spyOn(conn,'get').mockImplementation(async(sql,...args)=>{
    const result=await get(sql,...args);
    if(first&&sql.includes("seed_versions WHERE name = 'amenities'")) {first=false;if(++reads===2)release();await bothRead;}
    return result;
   });
  }
  const firstWrites=vi.spyOn(db,'run'),secondWrites=vi.spyOn(other,'run');
  await Promise.all([seedAmenities(false,db),seedAmenities(false,other)]);
  const seedInserts=[...firstWrites.mock.calls,...secondWrites.mock.calls].filter(([sql])=>sql.includes('INSERT INTO amenities'));
  expect(seedInserts).toHaveLength(seedAmenitiesData.length);
  expect((await db.get("SELECT COUNT(*) AS count FROM amenities WHERE source='seed'")).count).toBe(seedAmenitiesData.length);
  expect((await db.get('SELECT livability_score FROM projects WHERE project_id=1')).livability_score).not.toBeNull();
 });
 it('rolls back the seed marker and amenities if score preparation fails',async()=>{
  await db.run("CREATE TRIGGER reject_scores BEFORE UPDATE OF livability_score ON projects BEGIN SELECT RAISE(ABORT,'fixture scoring failure'); END");
  await expect(seedAmenities(false,db)).rejects.toThrow('fixture scoring failure');
  expect(await db.get("SELECT version FROM seed_versions WHERE name='amenities'")).toBeUndefined();
  expect((await db.get('SELECT COUNT(*) AS count FROM amenities')).count).toBe(0);
  await db.run('DROP TRIGGER reject_scores');await seedAmenities(false,db);
  expect((await db.get("SELECT version FROM seed_versions WHERE name='amenities'")).version).toBe(1);
 });
 it('does not rewrite approximate locations on repeated startup preparation',async()=>{
  await seedAmenities(false,db);
  await db.run("UPDATE projects SET geo_source='district_centre',livability_score=NULL,livability_data=NULL WHERE project_id=1");
  const before=await marketVersion(db);await initLivabilityCache();await initLivabilityCache();
  expect(await marketVersion(db)).toBe(before);
 });
 it('still refuses valuations if a real market write commits during calculation',async()=>{
  await seedAmenities(false,db);
  await db.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,area_sqm,area_sqft,psft_sgd,psqm_sgd,no_of_units,property_type) VALUES(1,'2026-06-01',2000000,100,1076.39,1858,20000,1,'Apartment')");
  const all=db.all.bind(db);let changed=false;
  vi.spyOn(db,'all').mockImplementation(async(sql,...args)=>{
   const rows=await all(sql,...args);
   if(!changed&&sql.includes('saleCount')&&sql.includes('FROM property_transactions')) {
    changed=true;await other.run('UPDATE property_transactions SET price_sgd=3000000 WHERE project_id=1');
   }
   return rows;
  });
  await expect(initSaleValuationsCache(db)).rejects.toThrow('Market changed during valuation preparation');
  expect(changed).toBe(true);
 });
});
