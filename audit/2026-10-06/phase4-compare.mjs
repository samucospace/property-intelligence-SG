import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openReadonly} from '../../server/utils/databaseArtifacts.js';
const supplied=process.argv.find(value=>value.startsWith('--db='))?.slice(5);
const database=supplied ? path.resolve(supplied) : fileURLToPath(new URL('./phase4-stage.db',import.meta.url));
const inspection=openReadonly(database);
try {
  if((await inspection.get("SELECT value FROM environment_metadata WHERE name='environment'"))?.value!=='staging') throw new Error('Comparison requires a sanitized staging database');
} finally {await inspection.close();}
Object.assign(process.env,{NODE_ENV:'test',DB_PATH:database,RELEASE_SCOPE:'analytics-readonly'});
const next=await import('../../server/queryEngine.js');
const reference=await import('./phase4-reference-engine.mjs');
const cases=[{}, {district:'09'}, {dateFrom:'2022-01-01',dateTo:'2022-12-31'}, {bedroomCount:"3-Bedder"}, {unitSizeMin:500,unitSizeMax:1000}, {lifestyleWeights:{mrt:1,school:0,hawker:0,supermarket:0,park:0}}, {centerCoords:{lat:1.3,lng:103.8},radiusKm:1.5}, {tenure:"freehold",propertyType:"all"}];
const evidence=[];
try {
  for(const mode of ['price','rental']) for(const filters of cases) {
    const name=mode==='price'?'getPriceAnalytics':'getRentalYieldAnalytics';
    const before=await reference[name](filters),after=await next[name](filters);
    assert.deepEqual(after,before,mode+' '+JSON.stringify(filters));
    evidence.push({mode,filters,totalCount:after.totalCount,projects:after.mapProjects.length,exactMatch:true});
  }
  fs.writeFileSync('audit/2026-10-06/phase4-arithmetic-parity.json',JSON.stringify({runtime:process.version,source:'Independent window-SQL implementation captured before median optimization',cases:evidence},null,2));
  console.log(JSON.stringify({passed:true,cases:evidence.length}));
} finally {await (await import('../../server/db.js')).closeDb();}
