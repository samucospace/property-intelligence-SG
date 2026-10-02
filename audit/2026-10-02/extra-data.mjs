import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH=path.join(dir,'market-snapshot.db');
const db=await import('../../server/db.js');
const {normalizeStreetName}=await import('../../server/utils/streetUtils.js');
const {haversineDistance}=await import('../../server/utils/geo.js');
const projects=await db.dbAll('SELECT project_id,project_name,street_name,latitude,longitude,geo_source FROM projects');
const groups=new Map();
for(const p of projects){const k=p.project_name.toUpperCase()+'|'+normalizeStreetName(p.street_name);(groups.get(k)??(groups.set(k,[]),groups.get(k))).push(p);}
const duplicates=[...groups.values()].filter(g=>g.length>1);
const results={normalizedDuplicateGroups:duplicates.length,normalizedDuplicateProjects:duplicates.reduce((n,g)=>n+g.length,0),examples:duplicates.slice(0,5),planningAreas:await db.dbAll('SELECT planning_area,COUNT(*) count FROM projects GROUP BY planning_area ORDER BY count DESC LIMIT 8'),nonLandedWronglyFlagged:await db.dbGet("SELECT COUNT(*) count FROM projects WHERE is_landed_aggregate=1 AND project_name LIKE '%NON-LANDED%'"),radiusTenKmEligible:projects.filter(p=>p.geo_source!=='district_centre'&&p.latitude&&haversineDistance(1.30,103.83,p.latitude,p.longitude)<=10).length};
await db.closeDb();
fs.writeFileSync(path.join(dir,'extra-data-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
