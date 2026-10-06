import {Worker} from 'node:worker_threads';
import {dbAll,dbGet} from '../db.js';
let worker,sequence=0;
const pending=new Map();
function calculate(rows,specs) {
  if(!worker) {
    worker=new Worker(new URL('./medianWorker.js',import.meta.url));
    worker.on('message',message=>{
      const request=pending.get(message.id);if(!request) return;
      pending.delete(message.id);message.error ? request.reject(new Error(message.error)) : request.resolve(message.data);
      if(!pending.size) worker.unref();
    });
    const active=worker;
    const fail=error=>{if(worker!==active) return;for(const request of pending.values()) request.reject(error);pending.clear();worker=null;};
    worker.on('error',fail);
    worker.on('exit',code=>{if(pending.size) fail(new Error(`Median worker exited: ${code}`));else if(worker===active) worker=null;});
  }
  const id=++sequence;worker.ref();
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,rows,specs});});
}

// SQLite produces compact numeric streams per group; numeric sorting runs off the
// event loop. Native SQLite ROUND is retained for exact existing output semantics.
export async function medianRows(sql,params,specs,conn=null) {
  const rows=await (conn ? conn.all(sql,params) : dbAll(sql,params));
  const data=await calculate(rows,specs);
  const rounded=specs.filter(spec=>spec.digits!=null);
  if(!rounded.length || !data.length) return data;
  const assignments=rounded.map(spec=>`'$.${spec.target}',ROUND(json_extract(value,'$.${spec.target}'),${spec.digits})`).join(',');
  const query=`SELECT json_group_array(json(json_set(value,${assignments}))) AS payload FROM json_each(?)`;
  const result=await (conn ? conn.get(query,[JSON.stringify(data)]) : dbGet(query,[JSON.stringify(data)]));
  return JSON.parse(result.payload);
}
export async function medianOne(sql,params,specs,conn=null) {return (await medianRows(sql,params,specs,conn))[0];}
