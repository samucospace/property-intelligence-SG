// Isolated regression probes: no real credentials, email, URA calls, or live DB writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(dir, `fixture-${Date.now()}.db`);
process.env.DB_PATH = fixturePath;
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'a'.repeat(48);
process.env.UNSUBSCRIBE_SECRET = 'b'.repeat(48);
process.env.BASE_URL = 'http://127.0.0.1';
process.env.RESEND_API_KEY = 're_audit_fake';
process.env.URA_ACCESS_KEY = '';
process.env.ALLOWED_ORIGIN = '';
const nativeFetch = globalThis.fetch;
let sendAttempts = 0;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.resend.com')) {
    sendAttempts++;
    return new Response(JSON.stringify({name:'validation_error',message:'Audit simulated rejection'}), {status:422,headers:{'Content-Type':'application/json'}});
  }
  if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('External network disabled in probes');
  return nativeFetch(url,opts);
};
const db = await import('../../server/db.js');
// Serialize initial WAL setup for these probes; normal startServer has no such barrier.
await db.dbGet('SELECT 1');
const {runMigrations} = await import('../../server/migrations/index.js');
const ingestion = await import('../../server/ingestion.js');
const query = await import('../../server/queryEngine.js');
const {app} = await import('../../server/index.js');
await db.initDb();
const results = {};
// Same project name / district, different streets: legitimate identical transactions.
const tx = {contractDate:'0926',area:'100',price:'1000000',floorRange:'01 to 05',noOfUnits:'1',propertyType:'Condominium',district:'09',tenure:'99 years'};
const payload = ['AUDIT ALPHA ROAD','AUDIT BETA ROAD'].map(street => ({project:'AUDIT SAME NAME',street,marketSegment:'CCR',transaction:[tx]}));
await ingestion.importRealUraData(payload);
results.identityCollision = await db.dbAll('SELECT p.street_name, COUNT(t.transaction_id) sales FROM projects p LEFT JOIN property_transactions t ON t.project_id=p.project_id GROUP BY p.project_id');
// Changing env after importing db.js cannot redirect createConnection's default path.
process.env.DB_PATH = path.join(dir,'intended-rebuild.db');
const redirected = db.createConnection();
results.lateDbPath = (await redirected.all('PRAGMA database_list')).map(r=>({name:r.name,file:path.basename(r.file)}));
await redirected.close();
// Actual price endpoint pagination behavior.
const p1 = await query.getPriceAnalytics({page:1,limit:1});
const p2 = await query.getPriceAnalytics({page:2,limit:1});
results.pricePagination = {first:p1.scatter.map(r=>r.id),second:p2.scatter.map(r=>r.id),reportedPage:p2.page,reportedLimit:p2.limit};
// Process-local valuation cache is not refreshed by another connection/process.
const id = (await db.dbGet('SELECT project_id FROM project_benchmarks LIMIT 1')).project_id;
const before = query.getProjectSaleValuation(id);
const independent = db.createConnection(fixturePath);
await independent.run('UPDATE project_benchmarks SET rolling_24m_median_price=7777777, rolling_24m_median_psft=7777 WHERE project_id=?',[id]);
results.staleValuation = {before,after:query.getProjectSaleValuation(id),database:await independent.get('SELECT rolling_24m_median_psft FROM project_benchmarks WHERE project_id=?',[id])};
await independent.close();
const server = app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base = `http://127.0.0.1:${server.address().port}`;
async function post(route, body, headers={}) {
 const response = await nativeFetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
results.adminGuard = await post('/api/ingest/ura',{});
results.missingConsent = await post('/api/leads/submit',{email:'audit@example.invalid',leadType:'newsletter'});
results.badName = await post('/api/leads/submit',{name:{x:1},email:'audit@example.invalid',leadType:'newsletter',pdpaConsent:true});
results.rejectedEmail = await post('/api/leads/submit',{email:'audit@example.invalid',leadType:'newsletter',pdpaConsent:true});
results.emailSendAttempts = sendAttempts;
results.cooldownDespiteFailure = await db.dbGet("SELECT last_confirmation_sent_at IS NOT NULL as cooldownSet, confirmed_at IS NOT NULL as confirmed FROM leads WHERE email='audit@example.invalid'");
results.fractionalLimit = await post('/api/analytics/rental-yields',{limit:1.5});
results.badDateType = await post('/api/analytics/price-trends',{dateFrom:['2026-01']});
results.staleToken = {};
await db.dbRun("INSERT INTO leads(email,lead_type,pdpa_consent,confirmation_token,created_at) VALUES('old@example.invalid','newsletter',1,'oldtoken',datetime('now','-365 days'))");
const confirm = await nativeFetch(base+'/api/newsletter/confirm?email=old@example.invalid&token=oldtoken');
results.staleToken.status = confirm.status;
results.staleToken.confirmed = await db.dbGet("SELECT confirmed_at IS NOT NULL as confirmed FROM leads WHERE email='old@example.invalid'");
await new Promise(r=>server.close(r));
await db.closeDb();
fs.writeFileSync(path.join(dir,'probe-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
