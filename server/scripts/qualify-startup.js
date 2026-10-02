import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'property-phase1-'));
const env = file => ({ ...process.env, NODE_ENV:'test', DB_PATH:file, PORT:'0',
  ADMIN_API_KEY:'a'.repeat(48), UNSUBSCRIBE_SECRET:'b'.repeat(48), BASE_URL:'http://127.0.0.1',
  RESEND_API_KEY:'re_mock_fixture', URA_ACCESS_KEY:'mock_fixture', RELEASE_SCOPE:'analytics-readonly',
  ENABLE_DATA_SYNC:'false', ENABLE_LEAD_CLEANUP:'false', ENABLE_STARTUP_LEAD_CLEANUP:'false',
  ENABLE_OUTBOUND_EMAIL:'false', ENABLE_SCHEDULED_NEWSLETTER:'false' });
const code = "const {startServer}=await import('./server/index.js');const server=await startServer();if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});const health=await fetch('http://127.0.0.1:'+server.address().port+'/api/health');if(!health.ok)throw Error('Health failed');await new Promise(resolve=>server.close(resolve));await (await import('./server/db.js')).closeDb();";
const report = { runtime:process.version, platform:process.platform, fresh:[], existing:[], concurrent:[] };
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
  const shared=path.join(folder,'concurrent.db');
  report.concurrent=await Promise.all(Array.from({length:5},()=>new Promise(resolve=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:root,env:env(shared)});
    let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
    const timeout=setTimeout(()=>child.kill(),20000);
    child.once('error',error=>resolve({passed:false,error:error.message}));
    child.once('exit',exit=>{clearTimeout(timeout);resolve({exit,passed:exit===0,...(exit===0?{}:{stderr})});});
  })));
  report.passed=[...report.fresh,...report.existing,...report.concurrent].every(result=>result.passed);
  const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
  if(output) fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!report.passed) process.exitCode=1;
} finally {
  if(path.dirname(folder)!==path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('property-phase1-')) throw Error('Invalid qualification cleanup path');
  fs.rmSync(folder,{recursive:true,force:true});
}
