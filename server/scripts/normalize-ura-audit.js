import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizeBedroom} from '../utils/bedroomUtils.js';
import {normalizeStreetName} from '../utils/streetUtils.js';
import {svy21ToWgs84,haversineDistance} from '../utils/geo.js';

const folder=path.resolve(process.argv[2]);
const capture=JSON.parse(fs.readFileSync(path.join(folder,'capture-manifest.json'),'utf8'));
const ledger={sales:[],rentals:[]};const identities=new Map();
const date=raw=>`${2000+Number(raw.slice(2))}-${raw.slice(0,2)}`;
for(const scope of capture.scopes){
 if(scope.status!=='captured')continue;
 const bytes=fs.readFileSync(path.join(folder,scope.filename));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==scope.sha256)throw Error('Provider capture hash mismatch');
 const projects=JSON.parse(bytes).Result;
 for(const p of projects){
  for(const t of p.transaction||[]){
   ledger.sales.push({project_name:p.project,street_name:p.street,postal_district:t.district,
    contract_date:date(t.contractDate)+'-01',price_sgd:Number(t.price),area_sqm:Number(t.area),floor_range:t.floorRange||null,tenure:t.tenure||null,
    type_of_sale:({'1':'New Sale','2':'Sub Sale','3':'Resale'})[t.typeOfSale]||t.typeOfSale||null,property_type:t.propertyType||null,no_of_units:Number(t.noOfUnits||1)});
  }
  for(const r of p.rental||[]){
   ledger.rentals.push({project_name:p.project,street_name:p.street,postal_district:r.district,lease_date:date(r.leaseDate),rent_sgd:Number(r.rent),
    floor_area_range:r.areaSqft?`${r.areaSqft} sqft`:(r.areaSqm?`${r.areaSqm} sqm`:null),bedroom_count:normalizeBedroom(r.noOfBedRoom),property_type:r.propertyType||null});
  }
  const key=p.project.trim().toUpperCase()+'|'+normalizeStreetName(p.street);
  if(!identities.has(key))identities.set(key,[]);
  identities.get(key).push({street:p.street,x:p.x,y:p.y,districts:[...new Set([...(p.transaction||[]),...(p.rental||[])].map(r=>r.district))],sourceFile:scope.filename});
 }
}
const bytes=JSON.stringify(ledger);fs.writeFileSync(path.join(folder,'source-ledger.json'),bytes);
const manifest={capturedAt:capture.capturedAt,sourceEvidence:'Retained URA API responses and their hashes in capture-manifest.json',scopes:capture.scopes,
 ledgerSha256:crypto.createHash('sha256').update(bytes).digest('hex'),coverageWarning:'Source API has a moving historical window. Empty quarters and partial edge months do not prove full archived coverage.'};
for(const [kind,field] of [['sales','contract_date'],['rentals','lease_date']]){
 const dates=ledger[kind].map(r=>r[field]).sort();manifest[kind]={dateFrom:dates[0],dateTo:dates.at(-1),sourceCount:dates.length};
}
fs.writeFileSync(path.join(folder,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const mapPath=new URL('../migrations/data/project_adjudication_map.json',import.meta.url);
const mapping=JSON.parse(fs.readFileSync(mapPath,'utf8'));
const identityEvidence=[];
for(const entry of mapping.entries){
 const target=entry.baselineTarget,source=entry.baselineSource;
 const hits=identities.get(entry.projectName+'|'+normalizeStreetName(target?.street_name))||[];
 const districts=[...new Set(hits.flatMap(h=>h.districts))];
 const distance=point=>Math.min(...hits.filter(h=>Number(h.x)>0&&Number(h.y)>0).map(h=>{
  const geo=svy21ToWgs84(Number(h.y),Number(h.x));return haversineDistance(point.latitude,point.longitude,geo.latitude,geo.longitude)*1000;
 }));
 const sourceDistance=source?.latitude ? distance(source) : null;
 const targetDistance=target?.latitude ? distance(target) : null;
 const evidence={sourceId:entry.sourceId,targetId:entry.targetId,projectName:entry.projectName,responseGroups:hits.length,districts,
  sourceDistrict:source?.postal_district,targetDistrict:target?.postal_district,
  consistentNameStreetDistrict:hits.length>0 && districts.length===1 && (!source?.postal_district || districts[0]===source.postal_district) && (!target?.postal_district || districts[0]===target.postal_district),
  sourceNearestProviderCoordinateMetres:sourceDistance,targetNearestProviderCoordinateMetres:targetDistance,
  coordinateSupportWithin100m:sourceDistance!==null&&targetDistance!==null&&sourceDistance<=100&&targetDistance<=100,
  sources:[...new Set(hits.map(h=>h.sourceFile))],coordinatePairs:[...new Set(hits.map(h=>h.x+'|'+h.y))]};
 identityEvidence.push(evidence);
 entry.currentSourceEvidence=evidence;
 // Source support is review evidence, not an invented human approval.
}
fs.writeFileSync(mapPath,JSON.stringify(mapping,null,2)+'\n');
fs.writeFileSync(path.join(folder,'identity-evidence.json'),JSON.stringify(identityEvidence,null,2)+'\n');
console.log(JSON.stringify({sales:manifest.sales,rentals:manifest.rentals,supportedIdentityGroups:identityEvidence.filter(e=>e.consistentNameStreetDistrict).length,totalIdentityGroups:identityEvidence.length}));
