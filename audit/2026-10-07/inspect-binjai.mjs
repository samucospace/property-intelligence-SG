import {openReadonly} from './server/utils/databaseArtifacts.js';
const db=openReadonly(process.env.DB_PATH);
try {
 const projects=await db.all("SELECT project_id,project_name,street_name,is_landed_aggregate,tenure_class FROM projects WHERE UPPER(project_name) LIKE '%BINJAI CREST%'");
 const output=[];
 for(const p of projects) {
  const sales=await db.all('SELECT property_type, count(*) AS count,min(contract_date) AS earliest,max(contract_date) AS latest,min(area_sqm) AS minArea,max(area_sqm) AS maxArea FROM property_transactions WHERE project_id=? GROUP BY property_type',[p.project_id]);
  const rentals=await db.all('SELECT property_type,count(*) AS count,min(lease_date) AS earliest,max(lease_date) AS latest FROM rental_transactions WHERE project_id=? GROUP BY property_type',[p.project_id]);
  const review=await db.all('SELECT * FROM project_identity_review WHERE project_id=?',[p.project_id]);
  output.push({project:p,sales,rentals,review});
 }
 console.log(JSON.stringify(output,null,2));
 for(const mode of ['price-trends','rental-yields']) for(const propertyType of ['condo','landed','all']) {
  const response=await fetch('http://127.0.0.1:3001/api/analytics/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{projects:['BINJAI CREST'],dateFrom:'2021-10-07',dateTo:'2026-10-07',propertyType}})});
  const data=await response.json();
  console.log(JSON.stringify({mode,propertyType,status:response.status,totalCount:data.totalCount,summary:data.summary}));
 }
} finally {await db.close();}
