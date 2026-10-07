export const regionLegend = [
  {color:'#4F7942',label:'Core Central Region (CCR)'},
  {color:'#CB6D51',label:'Rest of Central Region (RCR)'},
  {color:'#00B080',label:'Outside Central Region (OCR)'}
];
export const yieldLegend = [
  {color:'#10B981',label:'Yield 4.25% or more'},
  {color:'#D97706',label:'Yield 3.25% to below 4.25%'},
  {color:'#CB6D51',label:'Yield below 3.25%'},
  {color:'#94A3B8',label:'Yield unavailable'}
];
export function propertyPresentation(project,mode) {
  const approximate=project.locationQuality==='district_centre'||project.isApproximate===true;
  let band;
  if(mode==='rental') {
    const yieldValue=project.grossYield;
    band=yieldValue==null?yieldLegend[3]:yieldValue>=4.25?yieldLegend[0]:yieldValue>=3.25?yieldLegend[1]:yieldLegend[2];
  } else band=regionLegend.find(item=>item.label.endsWith('('+project.segment+')')) || {color:'#94A3B8',label:'Region unavailable'};
  return {...band,approximate};
}
export function mapSearchKey(filters) {
  return JSON.stringify({projects:filters.projects || [],street:filters.street || null,district:filters.district || null,
    planningArea:filters.planningArea || null,centerCoords:filters.centerCoords || null,radiusKm:filters.radiusKm || null});
}
