import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const fixtures=path.join(dir,'phase-validation-fixtures');
fs.mkdirSync(fixtures,{recursive:true});
const stamp=Date.now();
const envFor=db=>({...process.env,DB_PATH:db,NODE_ENV:'test',MOCK_EMAIL:'true',RESEND_API_KEY:'',URA_ACCESS_KEY:'',ADMIN_API_KEY:'a'.repeat(48),UNSUBSCRIBE_SECRET:'b'.repeat(48),BASE_URL:'http://127.0.0.1'});
const trials=[];
for(let i=0;i<20;i++){
 const db=path.join(fixtures,`startup-${stamp}-${i}.sqlite`);
 const code="const {startServer}=await import('./server/index.js');const s=await startServer();await new Promise(r=>s.close(r));const {closeDb}=await import('./server/db.js');await closeDb();";
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{...envFor(db),PORT:String(39000+i)},encoding:'utf8',timeout:20000});
 trials.push({trial:i+1,exit:r.status,passed:r.status===0,sqliteBusy:r.stderr.includes('SQLITE_BUSY'),error:r.error?.message||null});
}
const shared=path.join(fixtures,`concurrent-${stamp}.sqlite`);
const concurrent=await Promise.all(Array.from({length:5},()=>new Promise(resolve=>{
 const c=spawn(process.execPath,['--input-type=module','-e',"const {initDb}=await import('./server/db.js');await initDb();"],{cwd:root,env:envFor(shared)});
 let stderr='';c.stderr.on('data',d=>stderr+=d);c.on('close',exit=>resolve({exit,stderr}));
})));
const existing=spawnSync(process.execPath,['--input-type=module','-e',"const {initDb}=await import('./server/db.js');await initDb();"],{cwd:root,env:envFor(shared),encoding:'utf8',timeout:20000});
const results={runtime:process.version,freshStarts:trials,concurrentProcesses:concurrent,existingDatabaseMigration:{exit:existing.status,stderr:existing.stderr}};
fs.writeFileSync(path.join(dir,'phase-validation-startup.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({runtime:process.version,freshPassed:trials.filter(t=>t.passed).length,freshTotal:20,concurrentProcesses:concurrent,existingExit:existing.status},null,2));
