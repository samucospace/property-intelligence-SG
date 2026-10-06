export function decodeMapProjects(payload) {
  if(payload?.responseVersion!=='phase4-map-v1' || !Array.isArray(payload.columns) || !Array.isArray(payload.rows) || payload.totalProjects!==payload.rows.length) throw new Error('Invalid map response');
  return payload.rows.map(row=>{
    if(!Array.isArray(row) || row.length!==payload.columns.length) throw new Error('Invalid map row');
    return Object.fromEntries(payload.columns.map((key,index)=>{
      let value=row[index];
      const fields=payload.structures?.[key];
      if(fields && value) value=Object.fromEntries(fields.map((field,offset)=>[field,field==='subScores' ? Object.fromEntries(payload.subScoreFields.map((score,n)=>[score,value[offset][n]])) : value[offset]]));
      return [key,value];
    }));
  });
}
