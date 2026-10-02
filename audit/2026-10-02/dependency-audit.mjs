// npm bulk advisory lookup against locked package versions (including dev dependencies).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const result={checkedAt:new Date().toISOString(),scope:'All locked versions, includes dev; raw bulk advisories, not npm audit dependency-path analysis',projects:{}};
for (const folder of ['server','client']) {
 const lock=JSON.parse(fs.readFileSync(path.join(root,folder,'package-lock.json'),'utf8'));
 const payload={};
 for(const [key,pkg] of Object.entries(lock.packages)) {
  if(!key||!pkg.version)continue;
  const name=pkg.name||key.split('node_modules/').pop();
  (payload[name]??=[]).push(pkg.version);
 }
 for(const name of Object.keys(payload))payload[name]=[...new Set(payload[name])];
 const response=await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Registry advisory API HTTP ${response.status}`);
 result.projects[folder]={packageNames:Object.keys(payload).length,advisories:await response.json()};
}
fs.writeFileSync(path.join(dir,'dependency-results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
