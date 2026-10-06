import {getDefaultDateRange,getTodaySingaporeString} from './dateUtils.js';
import {getGradeLabel,getGradeColor} from '../livabilityEngine.js';

export async function marketVersion(conn) {
  const clock=await conn.get("SELECT name FROM sqlite_master WHERE name='market_versions'");
  if(clock) return (await conn.get('SELECT generation FROM market_versions WHERE id=1')).generation+':'+getTodaySingaporeString();
  const row=await conn.get('PRAGMA data_version');return row.data_version+':'+conn.revision+':'+getTodaySingaporeString();
}
function keyFor(mode,filters) {
  if(!['price','rental'].includes(mode)) return null;
  const dates=getDefaultDateRange(5);
  if((filters.projects?.length || filters.street || filters.district || filters.planningArea || filters.radiusKm || filters.priceMin || filters.priceMax) ||
     (filters.dateFrom && filters.dateFrom!==dates.dateFrom) || (filters.dateTo && filters.dateTo!==dates.dateTo) ||
     (filters.propertyType && filters.propertyType!=='condo') || (filters.tenure && filters.tenure!=='all') ||
     (filters.unitType && filters.unitType!=='sqft') || Number(filters.unitSizeMin || 0)!==0 ||
     (filters.bedroomCount && filters.bedroomCount!=='all') || Number(filters.page || 1)!==1 || Number(filters.limit || 100)!==100) return null;
  const max=filters.unitSizeMax ?? (mode==='price'?10000:null);
  if(max!==null && Number(max)!==10000) return null;
  return JSON.stringify({mode,...dates,unitSizeMax:max===null?null:Number(max)});
}
export function defaultSnapshotKeys() {return [keyFor('price',{}),keyFor('rental',{}),keyFor('rental',{unitSizeMax:10000})];}
export async function loadAnalyticsSnapshot(conn,mode,filters) {
  const key=keyFor(mode,filters);if(!key) return null;
  const row=await conn.get('SELECT payload_json FROM analytics_snapshots WHERE cache_key=? AND generation=(SELECT generation FROM market_versions WHERE id=1)',[key]);
  if(!row) return null;
  const data=JSON.parse(row.payload_json);
  if(filters.lifestyleWeights) {
    const weights=filters.lifestyleWeights,sum=Object.values(weights).reduce((a,b)=>a+b,0);
    if(sum>0) data.mapProjects=data.mapProjects.map(project=>{
      if(project.livability.score==null) return project;
      const score=Math.round(['mrt','school','hawker','supermarket','park'].reduce((value,name)=>value+(project.livability.subScores[name] || 0)*(weights[name] || 0),0)/sum);
      return {...project,livability:{...project.livability,score,label:getGradeLabel(score,project.locationQuality),color:getGradeColor(score)}};
    });
  }
  return data;
}
export async function storeAnalyticsSnapshot(conn,mode,filters,data,version) {
  const key=keyFor(mode,filters);if(!key || filters.lifestyleWeights) return;
  if(await marketVersion(conn)!==version) return;
  await conn.run(`INSERT INTO analytics_snapshots(cache_key,generation,payload_json)
    SELECT ?,generation,? FROM market_versions WHERE id=1 AND generation=?
    ON CONFLICT(cache_key) DO UPDATE SET generation=excluded.generation,payload_json=excluded.payload_json,created_at=CURRENT_TIMESTAMP`,[key,JSON.stringify(data),Number(version.split(':')[0])]);
  // Keep only currently usable materializations; no historical personal data exists here.
  const retained=defaultSnapshotKeys();
  await conn.run('DELETE FROM analytics_snapshots WHERE generation<>(SELECT generation FROM market_versions WHERE id=1) OR cache_key NOT IN (?,?,?)',retained);
}
