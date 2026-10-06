import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [source,expectedFile,output]=process.argv.slice(2);
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'phase2-api-'));
const database=path.join(folder,'candidate.db');fs.copyFileSync(source,database);
const expected=JSON.parse(fs.readFileSync(expectedFile));
Object.assign(process.env,{NODE_ENV:'test',DB_PATH:database,PORT:'3001',RELEASE_SCOPE:'analytics-readonly',ENABLE_DATA_SYNC:'false',ENABLE_LEAD_CLEANUP:'false',ENABLE_STARTUP_LEAD_CLEANUP:'false',ENABLE_OUTBOUND_EMAIL:'false',ENABLE_SCHEDULED_NEWSLETTER:'false'});
const serverRoot=process.env.QUALIFICATION_SERVER_ROOT||'/app/server';
const {startServer}=await import(pathToFileURL(path.join(serverRoot,'index.js')));
const db=await import(pathToFileURL(path.join(serverRoot,'db.js')));
const server=await startServer();
if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
try{
 const health=await fetch('http://127.0.0.1:3001/api/health');assert.equal(health.status,200);
 const response=await fetch('http://127.0.0.1:3001/api/analytics/rental-yields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:expected.filters})});
 assert.equal(response.status,200);const actual=await response.json();
 const project=actual.mapProjects.find(p=>p.id===expected.projectId);assert.ok(project,'Approved historical identity must be visible');
 assert.equal(actual.summary.totalLeases,expected.totalLeases);
 assert.equal(project.saleBenchmark.saleCount,expected.saleCount);assert.equal(project.usableRentalCount,expected.rentalCount);
 assert.ok(Math.abs(project.medianSalePsft-expected.medianSalePsft)<0.000001);
 assert.equal(project.medianRentPsft,expected.medianRentPsft);assert.equal(project.grossYield,expected.grossYield);assert.equal(actual.summary.avgGrossYield,expected.grossYield);
 assert.equal((await db.dbGet("SELECT COUNT(*) n FROM project_identity_review WHERE status='approved'")).n,35);
 const result={passed:true,runtime:process.version,platform:process.platform,healthStatus:200,analyticsStatus:200,approvedIdentityCount:35,independentMedianArithmeticMatch:true,projectId:expected.projectId,grossYield:expected.grossYield,realDatabaseTouched:false};
 if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result));
}finally{
 await new Promise(resolve=>server.close(resolve));await db.closeDb();
 assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));fs.rmSync(folder,{recursive:true,force:true});
}
