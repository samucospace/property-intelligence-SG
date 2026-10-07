// Contact-free temporary fixture for exercising the real map and analytics UI.
import crypto from 'node:crypto';
Object.assign(process.env,{NODE_ENV:'production',DB_PATH:'/tmp/map-qa.db',PORT:'3001',BASE_URL:'http://127.0.0.1:3417',ALLOWED_ORIGIN:'http://127.0.0.1:3417',
  ADMIN_API_KEY:crypto.randomBytes(32).toString('hex'),UNSUBSCRIBE_SECRET:crypto.randomBytes(32).toString('hex'),RELEASE_SCOPE:'analytics-readonly',
  ENABLE_DATA_SYNC:'false',ENABLE_LEAD_CLEANUP:'false',ENABLE_STARTUP_LEAD_CLEANUP:'false',ENABLE_OUTBOUND_EMAIL:'false',ENABLE_SCHEDULED_NEWSLETTER:'false'});
import {initDb,getPrimaryConnection} from './server/db.js';
await initDb();const db=getPrimaryConnection();
for(let id=1;id<=15;id++) {
 const approximate=id===15;
 await db.run('INSERT INTO projects(project_id,project_name,street_name,postal_district,market_segment,latitude,longitude,geo_source,is_landed_aggregate) VALUES(?,?,?,?,?,?,?,?,0)',
  [id,'MAP QA '+id,'PUBLIC FIXTURE ROAD','10',id%3===0?'OCR':id%3===1?'CCR':'RCR',1.285+id*.0008,103.82+id*.0008,approximate?'district_centre':'svy21']);
 for(let n=0;n<3;n++) {
  await db.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,area_sqm,area_sqft,psft_sgd,psqm_sgd,no_of_units,property_type) VALUES(?,'2026-09-01',2000000,100,1076.39,1858,20000,1,'Apartment')",[id]);
  await db.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,area_sqft,area_sqm,rent_psft,rent_psqm,property_type) VALUES(?,'2026-09',5000,1076.39,100,4.65,50,'Non-landed Properties')",[id]);
 }
}
const {startServer}=await import('./server/index.js');await startServer();
