import {getDefaultDateRange} from './dateUtils.js';

export function defaultFilters() {
  return {projects:[],propertyType:'condo',street:null,district:null,planningArea:null,
    bedroomCount:'all',radiusKm:null,centerCoords:null,...getDefaultDateRange(5),
    unitSizeMin:0,unitSizeMax:null,priceMin:null,priceMax:null,tenure:'all',page:1,limit:100};
}
const calendar=value=>/^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function readSearchFilters(search) {
  const p=new URLSearchParams(search), f=defaultFilters();
  const project=p.get('project');
  if(project && project.length<=150) f.projects=[project];
  try {const list=JSON.parse(p.get('projects'));if(Array.isArray(list)&&list.length<=50&&list.every(v=>typeof v==='string'&&v.length<=150)) f.projects=list;} catch {}
  f.propertyType=f.projects.length?'all':'condo';
  for(const [key,values] of [['propertyType',['all','condo','landed','ec']],['tenure',['all','freehold','leasehold']],['bedroomCount',['all','Unspecified','1-Bedder','2-Bedder','3-Bedder','4-Bedder','5-Bedder']]])
    if(values.includes(p.get(key))) f[key]=p.get(key);
  for(const key of ['street','planningArea']) {const value=p.get(key) || (key==='planningArea'?p.get('area'):null);if(value&&value.length<=150)f[key]=value;}
  const numeric=(key,min,max,integer=false)=>{const raw=p.get(key),value=Number(raw);if(raw!=null&&raw!==''&&Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isSafeInteger(value))) f[key]=value;};
  numeric('district',1,28,true);numeric('radiusKm',0.1,10);numeric('unitSizeMin',0,100000);numeric('unitSizeMax',0,100000);
  numeric('priceMin',0,1000000000);numeric('priceMax',0,1000000000);numeric('page',1,1000000,true);numeric('limit',1,100,true);
  for(const key of ['dateFrom','dateTo']) if(calendar(p.get(key)) && Number(p.get(key).slice(0,4))>=2000&&Number(p.get(key).slice(0,4))<=2100) f[key]=p.get(key);
  if(f.dateFrom>f.dateTo || (Date.parse(f.dateTo)-Date.parse(f.dateFrom))/31557600000>10) Object.assign(f,getDefaultDateRange(5));
  if(f.unitSizeMax!=null&&f.unitSizeMin>f.unitSizeMax) {f.unitSizeMin=0;f.unitSizeMax=null;}
  if(f.priceMin!=null&&f.priceMax!=null&&f.priceMin>f.priceMax) {f.priceMin=null;f.priceMax=null;}
  try {const c=JSON.parse(p.get('centerCoords'));if(c&&Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&Math.abs(c.lat)<=90&&Math.abs(c.lng)<=180) f.centerCoords={lat:c.lat,lng:c.lng};} catch {}
  if(f.radiusKm&&!f.centerCoords) f.radiusKm=null;
  return f;
}
export function writeSearchFilters(filters,mode,search='') {
  const p=new URLSearchParams(search);
  for(const key of [...Object.keys(defaultFilters()),'project','area','q','enquire','mode']) p.delete(key);
  for(const [key,value] of Object.entries(filters)) {
    if(value==null || value==='') continue;
    if(key==='projects') {if(value.length===1)p.set('project',value[0]);else if(value.length)p.set('projects',JSON.stringify(value));}
    else if(key==='centerCoords') p.set(key,JSON.stringify(value));
    else p.set(key,String(value));
  }
  if(mode==='rental')p.set('mode','rental');
  return p.toString();
}
export function selectLocation(prev,location) {
  return {...prev,projects:[],street:null,district:null,planningArea:null,radiusKm:null,centerCoords:null,page:1,
    ...location,...(location.projects?{propertyType:'all'}:{})};
}
export function updateSearchFilters(prev,update) {
  const next=typeof update==='function'?update(prev):update;
  const withoutPage=value=>JSON.stringify({...value,page:undefined});
  return withoutPage(prev)===withoutPage(next)?next:{...next,page:1};
}
