import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const results=[];
for(let i=0;i<5;i++) {
 const env={...process.env,DB_PATH:path.join(dir,`startup-${Date.now()}-${i}.db`),PORT:'0',NODE_ENV:'test',ADMIN_API_KEY:'a'.repeat(48),UNSUBSCRIBE_SECRET:'b'.repeat(48),RESEND_API_KEY:'',URA_ACCESS_KEY:'',BASE_URL:'http://127.0.0.1'};
 const code="const {startServer}=await import('./server/index.js'); const s=await startServer(); await new Promise(r=>s.close(r)); const {closeDb}=await import('./server/db.js'); await closeDb();";
 const run=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(dir,'../..'),env,encoding:'utf8',timeout:15000});
 results.push({attempt:i+1,exit:run.status,error:run.error?.message??null,sqliteBusy:run.stderr.includes('SQLITE_BUSY'),stderr:run.stderr.slice(-2000),stdoutTail:run.stdout.slice(-400)});
}
fs.writeFileSync(path.join(dir,'startup-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
