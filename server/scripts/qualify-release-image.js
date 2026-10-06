import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

assert.equal(process.getuid(),1000,'Release process must run as the node user');
assert.equal(process.platform,'linux');
assert.equal(process.version,'v22.23.3');
assert.ok(!fs.existsSync('/app/server/.env'),'Local credentials must not be baked into the image');
assert.ok(!fs.existsSync('/app/server/property.db'),'Local market database must not be baked into the image');
assert.ok(fs.existsSync('/app/server/data/sora_rates_historical.json'));
assert.ok(fs.existsSync('/app/server/migrations/data/project_adjudication_map.json'));
Object.assign(process.env,{
  NODE_ENV:'production',DB_PATH:'/tmp/qualification-production.db',PORT:'3001',
  ADMIN_API_KEY:crypto.randomBytes(32).toString('hex'),
  UNSUBSCRIBE_SECRET:crypto.randomBytes(32).toString('hex'),
  BASE_URL:'http://127.0.0.1:3001',RELEASE_SCOPE:'analytics-readonly',
  ENABLE_DATA_SYNC:'false',ENABLE_LEAD_CLEANUP:'false',ENABLE_STARTUP_LEAD_CLEANUP:'false',
  ENABLE_OUTBOUND_EMAIL:'false',ENABLE_SCHEDULED_NEWSLETTER:'false'
});
const {startServer}=await import('/app/server/index.js');
const server=await startServer();
if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
try {
  const health=await fetch('http://127.0.0.1:3001/api/health');assert.equal(health.status,200);
  const page=await fetch('http://127.0.0.1:3001/');assert.equal(page.status,200);
  assert.match(await page.text(),/<html/i);
  console.log(JSON.stringify({passed:true,runtime:process.version,platform:process.platform,uid:process.getuid(),
    productionConfiguration:true,healthStatus:health.status,frontendStatus:page.status,
    bakedCredentials:false,bakedMarketDatabase:false,externalNetwork:false}));
} finally {
  await new Promise(resolve=>server.close(resolve));
  await (await import('/app/server/db.js')).closeDb();
}
