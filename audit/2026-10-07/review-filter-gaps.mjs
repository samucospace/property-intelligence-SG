import {openReadonly} from './server/utils/databaseArtifacts.js';
const db=openReadonly(process.env.DB_PATH);
try {
 const counts=await db.get("SELECT count(*) AS rentals,sum(CASE WHEN area_sqft IS NULL THEN 1 ELSE 0 END) AS unknownArea,sum(CASE WHEN area_sqft>10000 THEN 1 ELSE 0 END) AS overDefaultMax FROM rental_transactions");
 const types=await db.all('SELECT property_type,count(*) AS count FROM rental_transactions GROUP BY property_type');
 console.log(JSON.stringify({counts,types}));
 for(const [name,route,extra] of [
  ['baseline rentals','rental-yields',{}],
  ['sale minimum retained in rental mode','rental-yields',{priceMin:1000000}],
  ['new street retained with old project','price-trends',{street:'KEPPEL BAY VIEW'}],
  ['explicit non-landed rental type','rental-yields',{propertyType:'Non-landed Properties'}]
 ]) {
  const response=await fetch('http://127.0.0.1:3001/api/analytics/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{projects:['BINJAI CREST'],dateFrom:'2021-10-07',dateTo:'2026-10-07',propertyType:'all',unitSizeMax:10000,...extra}})});
  const data=await response.json();console.log(JSON.stringify({name,status:response.status,totalCount:data.totalCount}));
 }
 const sample=await db.get("SELECT p.project_name,count(*) AS rentals,sum(CASE WHEN r.area_sqft IS NULL THEN 1 ELSE 0 END) AS unknownArea FROM rental_transactions r JOIN projects p ON p.project_id=r.project_id WHERE p.is_landed_aggregate=0 AND NOT EXISTS(SELECT 1 FROM project_identity_review q WHERE q.project_id=p.project_id AND q.status='pending') GROUP BY p.project_id HAVING unknownArea>0 ORDER BY unknownArea DESC LIMIT 1");
 console.log(JSON.stringify({unknownAreaExample:sample}));
 for(const max of [null,10000]) {
  const response=await fetch('http://127.0.0.1:3001/api/analytics/rental-yields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{projects:[sample.project_name],dateFrom:'2021-10-07',dateTo:'2026-10-07',propertyType:'all',unitSizeMax:max}})});
  const data=await response.json();console.log(JSON.stringify({name:'unknown-area coverage',project:sample.project_name,unitSizeMax:max,status:response.status,totalCount:data.totalCount}));
 }
} finally {await db.close();}
