import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {getTodaySingaporeString} from '../utils/dateUtils.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'property-phase1-'));
const roundsArg=process.argv.find(arg=>arg.startsWith('--concurrent-rounds='))?.split('=')[1];
const concurrentRounds=roundsArg===undefined?3:Number(roundsArg);
if(!Number.isInteger(concurrentRounds)||concurrentRounds<1||concurrentRounds>10) throw new Error('Concurrent rounds must be between 1 and 10');
const env = file => ({ ...process.env, NODE_ENV:'test', DB_PATH:file, PORT:'0',
  ADMIN_API_KEY:'a'.repeat(48), UNSUBSCRIBE_SECRET:'b'.repeat(48), BASE_URL:'http://127.0.0.1',
  RESEND_API_KEY:'re_mock_fixture', URA_ACCESS_KEY:'mock_fixture', RELEASE_SCOPE:'analytics-readonly',
  ENABLE_DATA_SYNC:'false', ENABLE_LEAD_CLEANUP:'false', ENABLE_STARTUP_LEAD_CLEANUP:'false',
  ENABLE_OUTBOUND_EMAIL:'false', ENABLE_SCHEDULED_NEWSLETTER:'false' });
const code = "const {startServer}=await import('./server/index.js');const server=await startServer();if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});const base='http://127.0.0.1:'+server.address().port;const health=await fetch(base+'/api/health');if(!health.ok)throw Error('Health failed');if(process.env.EXPECT_MARKET_DATA==='true'){const ready=await fetch(base+'/api/health/ready');if(!ready.ok || !(await ready.json()).ready)throw Error('Prepared market readiness failed');}await new Promise(resolve=>server.close(resolve));await (await import('./server/db.js')).closeDb();";
const report = { runtime:process.version, platform:process.platform, concurrentRounds, fresh:[], existing:[], concurrent:[], concurrentPopulated:[] };
const check = file => {
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,env:env(file),encoding:'utf8',timeout:20000});
  const result={exit:child.status,passed:child.status===0,error:child.error?.message||null};
  if (!result.passed) result.stderr=child.stderr;
  return result;
};
try {
  for(let i=0;i<20;i++) report.fresh.push(check(path.join(folder,`fresh-${i}.db`)));
  const existing=path.join(folder,'fresh-0.db');
  for(let i=0;i<5;i++) report.existing.push(check(existing));
  const concurrent=async(shared,populated=false)=>Promise.all(Array.from({length:5},()=>new Promise(resolve=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{...env(shared),EXPECT_MARKET_DATA:String(populated)}});
    let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
    const timeout=setTimeout(()=>child.kill(),20000);
    child.once('error',error=>resolve({passed:false,error:error.message}));
    child.once('exit',exit=>{clearTimeout(timeout);resolve({exit,passed:exit===0,...(exit===0?{}:{stderr})});});
  })));
  for(let round=0;round<concurrentRounds;round++) {
    report.concurrent.push(...(await concurrent(path.join(folder,`concurrent-${round}.db`))).map(result=>({round,...result})));
    const populated=path.join(folder,`populated-${round}.db`),date=getTodaySingaporeString();
    const setupCode=`const {initDb,createConnection}=await import('./server/db.js');await initDb();const db=createConnection();await db.run("INSERT INTO projects(project_id,project_name,street_name,market_segment,latitude,longitude,geo_source) VALUES(1,'PUBLIC FIXTURE','FIXTURE ROAD','CCR',1.3,103.8,'svy21')");for(let n=0;n<3;n++){await db.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,area_sqm,area_sqft,psft_sgd,psqm_sgd,no_of_units,property_type) VALUES(1,?,2000000,100,1076.39,1858,20000,1,'Apartment')",[${JSON.stringify(date)}]);await db.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,area_sqft,rent_psft,property_type) VALUES(1,?,5000,1076.39,4.65,'Non-landed Properties')",[${JSON.stringify(date.slice(0,7))}]);}await db.close();`;
    const setup=spawnSync(process.execPath,['--input-type=module','-e',setupCode],{cwd:root,env:env(populated),encoding:'utf8',timeout:20000});
    if(setup.status!==0) throw new Error('Populated qualification fixture failed: '+setup.stderr);
    report.concurrentPopulated.push(...(await concurrent(populated,true)).map(result=>({round,...result})));
  }
  report.passed=[...report.fresh,...report.existing,...report.concurrent,...report.concurrentPopulated].every(result=>result.passed);
  const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
  if(output) fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!report.passed) process.exitCode=1;
} finally {
  if(path.dirname(folder)!==path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('property-phase1-')) throw Error('Invalid qualification cleanup path');
  fs.rmSync(folder,{recursive:true,force:true});
}
