import {parentPort} from 'node:worker_threads';

function medianCsv(csv,totalCount) {
  if(!csv || !totalCount) return null;
  const values=Float64Array.from(csv.split(','),Number);values.sort();
  // SQLite sorts NULLs first; AVG of the two central ranks ignores NULLs.
  const nullCount=totalCount-values.length;
  const indices=[Math.floor((totalCount-1)/2)-nullCount,Math.floor(totalCount/2)-nullCount];
  const selected=indices.filter(index=>index>=0).map(index=>values[index]);
  return selected.length ? selected.reduce((sum,value)=>sum+value,0)/selected.length : null;
}
function pairedMedian(csv,totalCount) {
  if(!csv || !totalCount) return null;
  const pairs=csv.split(',').map(cell=>cell.split(':').map(value=>value==='n' ? null : Number(value)));
  pairs.sort((a,b)=>(a[0] ?? -Infinity)-(b[0] ?? -Infinity));
  const indices=[Math.floor((totalCount-1)/2),Math.floor(totalCount/2)];
  const values=indices.map(index=>pairs[index][1]).filter(value=>value!==null);
  return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
}
parentPort.on('message',({id,rows,specs})=>{
  try {
    const data=rows.map(row=>{
      const result={...row};
      for(const spec of specs) {result[spec.target]=(spec.paired ? pairedMedian : medianCsv)(row[spec.source],row[spec.count]);delete result[spec.source];}
      return result;
    });
    parentPort.postMessage({id,data});
  } catch(error) {parentPort.postMessage({id,error:error.message});}
});
