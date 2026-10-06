export function analyticsSummary(result) {
  const {mapProjects,scatter,...summary}=result;
  return {...summary,scatterPoints:result.scatterPoints || scatter || [],mapProjectCount:mapProjects?.length || 0,
    mapDataEndpoint:'/api/analytics/map',responseVersion:'phase4-v1'};
}
export function encodeMapProjects(projects) {
  const columns=[...new Set(projects.flatMap(project=>Object.keys(project)))];
  const structures={};
  for(const key of ['livability','saleBenchmark']) {
    const fields=[...new Set(projects.flatMap(project=>Object.keys(project[key] || {})))];
    if(fields.length) structures[key]=fields;
  }
  const subScoreFields=['mrt','school','hawker','supermarket','park'];
  const pack=(key,value)=>structures[key] && value ? structures[key].map(field=>field==='subScores' ? subScoreFields.map(score=>value.subScores?.[score] ?? null) : value[field] ?? null) : value ?? null;
  return {responseVersion:'phase4-map-v1',columns,structures,subScoreFields,rows:projects.map(project=>columns.map(key=>pack(key,project[key]))),totalProjects:projects.length};
}
