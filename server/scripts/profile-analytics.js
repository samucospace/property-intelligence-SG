import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {openReadonly} from '../utils/databaseArtifacts.js';

const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const database=path.resolve(arg('db') || 'audit/2026-10-06/phase4-stage.db');
const inspection=openReadonly(database);
try {
  if((await inspection.get("SELECT value FROM environment_metadata WHERE name='environment'"))?.value!=='staging') throw new Error('Only an explicitly sanitized staging database may be profiled');
} finally {await inspection.close();}
Object.assign(process.env,{NODE_ENV:'test',DB_PATH:database,RELEASE_SCOPE:'analytics-readonly',MOCK_EMAIL:'true',ENABLE_OUTBOUND_EMAIL:'false',ENABLE_DATA_SYNC:'false',ENABLE_LEAD_CLEANUP:'false'});
const engine=await import('../queryEngine.js');
const {closeDb}=await import('../db.js');
const {runMigrations}=await import('../migrations/index.js');
const {getPrimaryConnection}=await import('../db.js');
await runMigrations(getPrimaryConnection());
const preparationStart=performance.now();
if(process.argv.includes('--prepared')) await engine.prepareDefaultAnalytics();
const report={preparationMs:performance.now()-preparationStart,runtime:process.version,platform:process.platform,sanitized:true,samples:[]};
try {
  for(const [name,fn] of [['sales',engine.getPriceAnalytics],['rentals',engine.getRentalYieldAnalytics],['projects',engine.getAllProjects]]) {
    engine.clearAnalyticsCache();
    const start=performance.now(),data=await fn();
    const coldMs=performance.now()-start;
    const fullBytes=Buffer.byteLength(JSON.stringify(data));
    const {mapProjects,...summary}=data;
    const {encodeMapProjects,analyticsSummary}=await import('../utils/analyticsContract.js');
    const transportBytes=Buffer.byteLength(JSON.stringify(Array.isArray(data)?encodeMapProjects(data):analyticsSummary(data)));
    const warm=performance.now();await fn();
    report.samples.push({name,coldMs,warmMs:performance.now()-warm,fullBytes,transportBytes,summaryBytes:Buffer.byteLength(JSON.stringify(summary)),
      mapBytes:Buffer.byteLength(JSON.stringify(mapProjects || [])),rows:data.totalCount || data.length,projects:mapProjects?.length || data.length,
      rss:process.memoryUsage().rss,cache:engine.analyticsCacheStats()});
  }
} finally {await closeDb();}
if(arg('output')) fs.writeFileSync(arg('output'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
