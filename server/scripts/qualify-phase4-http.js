import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const base=arg('url') || 'http://127.0.0.1:3414';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Only isolated localhost qualification is allowed');
const samples=[];
async function request(name,route,body) {
  const start=performance.now(),response=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const text=await response.text(),data=JSON.parse(text),sample={name,status:response.status,ms:performance.now()-start,bytes:Buffer.byteLength(text)};
  samples.push(sample);if(response.status!==200) throw new Error(`${name}: HTTP ${response.status}`);return {sample,data};
}
const recordAtStart=new Date().toISOString();
const defaults={propertyType:'condo',unitType:'sqft',unitSizeMin:0,unitSizeMax:10000,tenure:'all',bedroomCount:'all'};
await request('ready','/api/health/ready');
await request('sale-first-http','/api/analytics/price-trends',{filters:defaults});
await request('rental-first-http','/api/analytics/rental-yields',{filters:defaults});
await request('projects','/api/projects');
const baseline=await request('sale-alone','/api/analytics/price-trends',{filters:defaults});
const expensive=request('cold-broad-rental','/api/analytics/rental-yields',{filters:{...defaults,unitSizeMax:9999}});
await new Promise(resolve=>setTimeout(resolve,50));
const concurrent=await request('sale-during-cold-rental','/api/analytics/price-trends',{filters:defaults});await expensive;
const project=(await request('search','/api/search/suggestions?q=reflections')).data.projects[0];
const workload=[
  ['sale','/api/analytics/price-trends',{filters:defaults}],['rental','/api/analytics/rental-yields',{filters:defaults}],
  ['sale-district','/api/analytics/price-trends',{filters:{...defaults,district:'09'}}],
  ['rental-district','/api/analytics/rental-yields',{filters:{...defaults,district:'09'}}],
  ['map','/api/analytics/map',{mode:'rental',filters:defaults}],
  ['search','/api/search/suggestions?q=bedok'],['detail',`/api/projects/${project.id}/livability`]
];
const mixedStart=performance.now();
await Promise.all(Array.from({length:10},async(_,user)=>{
  for(let n=0;n<14;n++) {const [name,route,body]=workload[(user+n)%workload.length];await request('mixed-'+name,route,body);}
}));
const mixed=samples.filter(sample=>sample.name.startsWith('mixed-')),times=mixed.map(sample=>sample.ms).sort((a,b)=>a-b);
const report={recordedAt:new Date().toISOString(),runtime:process.version,base,hardware:'Docker 1 CPU / 1 GiB limit, local machine; actual Droplet not available',concurrency:10,durationMs:performance.now()-mixedStart,
  startedAt:recordAtStart,
  originalTargets:{salesDefault:samples.find(s=>s.name==='sale-first-http').ms<300 && samples.find(s=>s.name==='sale-first-http').bytes<500000,rentalDefault:samples.find(s=>s.name==='rental-first-http').ms<300 && samples.find(s=>s.name==='rental-first-http').bytes<500000,projectsPayload:samples.find(s=>s.name==='projects').bytes<1500000,concurrentAdditional:concurrent.sample.ms-baseline.sample.ms<100},
  coldDefinition:'First HTTP calls after startup-prepared materializations. Separately measured uncached custom filter. Warm mixed workload includes initial district misses.',
  concurrentAdditionalMs:concurrent.sample.ms-baseline.sample.ms,mixed:{requests:mixed.length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],p99:times[Math.floor(times.length*.99)],max:times.at(-1)},samples};
if(arg('output')) fs.writeFileSync(arg('output'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,samples:undefined},null,2));
