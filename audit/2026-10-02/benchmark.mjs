import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
const dir=path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH=path.join(dir,'market-snapshot.db');
const db=await import('../../server/db.js');
await db.dbGet('SELECT 1');
const q=await import('../../server/queryEngine.js');
await q.initSaleValuationsCache();
const results={node:process.version,samples:[]};
for(const [name, fn] of [['rental',q.getRentalYieldAnalytics],['price',q.getPriceAnalytics],['projects',q.getAllProjects]]) {
 for(const cache of ['cold','warm']) {
  const t=performance.now(); const value=await fn(); const end=performance.now();
  results.samples.push({name,cache,ms:Math.round(end-t),jsonBytes:Buffer.byteLength(JSON.stringify(value)),rows:value.mapProjects?.length??value.length});
 }
}
q.invalidateAnalyticsCache();
const t=performance.now();
const concurrent=await Promise.all([q.getRentalYieldAnalytics({district:'09'}),q.getRentalYieldAnalytics({district:'10'})]);
results.twoDistrictConcurrentMs=Math.round(performance.now()-t);
results.radius={tenKmReturned:(await q.getMatchingProjectIdsByRadius({lat:1.30,lng:103.83},10)).length};
await db.closeDb();
fs.writeFileSync(path.join(dir,'benchmark-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
