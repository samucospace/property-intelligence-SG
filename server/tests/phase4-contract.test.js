import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {app} from '../index.js';
import {getPrimaryConnection,closeDb} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {getPriceAnalytics,getRentalYieldAnalytics,clearAnalyticsCache,analyticsCacheStats} from '../queryEngine.js';
import {BoundedJsonCache} from '../utils/boundedJsonCache.js';
import {decodeMapProjects} from '../../client/src/utils/mapContract.js';

describe('Phase 4 complete compact contracts and bounded work',()=>{
  let folder,db,previous,server,base;
  beforeEach(async()=>{
    await closeDb();previous=process.env.DB_PATH;folder=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-contract-'));
    process.env.DB_PATH=path.join(folder,'fixture.db');db=getPrimaryConnection();await runMigrations(db);
    await db.run("INSERT INTO projects(project_id,project_name,street_name,postal_district,market_segment,latitude,longitude,geo_source,is_landed_aggregate,livability_data) VALUES(1,'PUBLIC FIXTURE','FIXTURE ROAD','10','CCR',1.3,103.8,'svy21',0,?)",[JSON.stringify({subScores:{mrt:80},nearest:{mrt:[{name:'Detail only',description:'x'.repeat(10000)}]}})]);
    for(let n=0;n<3;n++) {
      await db.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,psft_sgd,psqm_sgd,area_sqft,area_sqm,property_type,no_of_units) VALUES(1,'2026-01-01',2000000,2000,21527.8,1000,92.903,'Apartment',1)");
      await db.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,rent_psft,rent_psqm,area_sqft,area_sqm,property_type,bedroom_count) VALUES(1,'2026-01',5000,5,53.82,1000,92.903,'Apartment',2)");
    }
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async()=>{if(server?.listening) await new Promise(resolve=>server.close(resolve));await closeDb();process.env.DB_PATH=previous;vi.restoreAllMocks();fs.rmSync(folder,{recursive:true,force:true});});
  const filters={dateFrom:'2026-01-01',dateTo:'2026-10-06',propertyType:'condo'};
  const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
  it('separates complete map data from summaries without changing yield arithmetic or hiding projects',async()=>{
    const summary=await post('/api/analytics/rental-yields',{filters});
    const packed=await post('/api/analytics/map',{mode:'rental',filters});const map=decodeMapProjects(packed);
    expect(summary.mapProjects).toBeUndefined();expect(summary.mapProjectCount).toBe(map.length);
    expect(map).toHaveLength(1);expect(map[0].grossYield).toBe(3);expect(summary.summary.grossYieldPct).toBe(3);
    expect(summary.totalCount).toBe(3);expect(summary.rentalCaveats).toHaveLength(3);
    expect(JSON.stringify(packed)).not.toContain('Detail only');expect(summary.responseVersion).toBe('phase4-v1');
  });
  it('keeps nearest-amenity detail available through its dedicated endpoint',async()=>{
    const response=await fetch(base+'/api/projects/1/livability');expect(response.status).toBe(200);
    expect((await response.json()).livability).toHaveProperty('nearest');
  });
  it('returns complete projects in the compact map contract',async()=>{
    const response=await fetch(base+'/api/projects');const projects=decodeMapProjects(await response.json());
    expect(projects.map(project=>project.id)).toEqual([1]);expect(projects[0].avgPsft).toBe(2000);
  });
  it('coalesces identical cold queries across ten callers',async()=>{
    await getRentalYieldAnalytics(filters);clearAnalyticsCache();
    const sql=vi.spyOn(db,'all');const results=await Promise.all(Array.from({length:10},()=>getRentalYieldAnalytics(filters)));
    expect(results.every(result=>result.summary.grossYieldPct===3)).toBe(true);
    expect(sql.mock.calls.filter(([query])=>query.includes('WITH aggregates AS') && query.includes('FROM rental_transactions')).length).toBe(1);
    expect(analyticsCacheStats().inFlight).toBe(0);
  });
  it('cached data cannot be corrupted by a previous caller',async()=>{
    const original=await getPriceAnalytics(filters);original.summary.totalVolume=999;
    expect((await getPriceAnalytics(filters)).summary.totalVolume).toBe(3);
  });
  it('bounds actual retained bytes under many distinct payload sizes and rejects oversized entries',()=>{
    const cache=new BoundedJsonCache({maxBytes:2048});
    for(let n=0;n<30;n++) {cache.set(String(n),{result:'x'.repeat(n*20)});expect(cache.stats().bytes).toBeLessThanOrEqual(2048);}
    expect(cache.set('oversized',{result:'x'.repeat(3000)})).toBe(false);expect(cache.get('0')).toBeNull();
    const latest=cache.get('29');latest.result='changed';expect(cache.get('29').result).not.toBe('changed');
  });
  it('rejects a truncated map response rather than presenting an incomplete market',()=>{
    expect(()=>decodeMapProjects({responseVersion:'phase4-map-v1',columns:['id'],rows:[[1]],totalProjects:2})).toThrow(/Invalid map/);
  });
});
