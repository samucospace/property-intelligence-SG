import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import axios from 'axios';
import {generateRentalQuarters, getTodaySingaporeString} from '../utils/dateUtils.js';

// Source capture only: no database, ingestion, key/header logging or outbound email.
dotenv.config({path:new URL('../.env',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),quiet:true});
const key=process.env.URA_ACCESS_KEY;
if(!key || /mock|your_|example|changeme/i.test(key))throw Error('A configured URA key is required');
const output=path.resolve(process.argv[2] || '../audit/2026-10-05/provider-source');
if(fs.existsSync(output))throw Error('Refusing to overwrite an existing source capture');
fs.mkdirSync(output,{recursive:true});
const summary={capturedAt:new Date().toISOString(),scopes:[],status:'capturing'};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const save=()=>fs.writeFileSync(path.join(output,'capture-manifest.json'),JSON.stringify(summary,null,2)+'\n');
const client=axios.create({timeout:30000,maxRedirects:0,headers:{'User-Agent':'SingaporeHomeIntel/Phase2SourceAudit'}});
let token,base;
for(const candidate of [
 {token:'https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1',base:'https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1'},
 {token:'https://eservice.ura.gov.sg/uraDataService/insertNewToken.action',base:'https://eservice.ura.gov.sg/uraDataService/invokeUraDS'}]){
 try{
  const response=(await client.get(candidate.token,{headers:{AccessKey:key}})).data;
  if(response?.Status==='Success' && typeof response.Result==='string'){token=response.Result;base=candidate.base;break;}
 }catch(error){summary.tokenFailure={code:error.code||null,httpStatus:error.response?.status||null};}
}
if(!token){summary.status='token failed';save();console.log('URA source capture failed to obtain a token; sanitized details saved.');process.exitCode=1;}
else{
 const today=getTodaySingaporeString();
 const currentQuarter=today.slice(2,4)+'q'+Math.ceil(Number(today.slice(5,7))/3);
 const startQuarter=String(Number(today.slice(0,4))-5).slice(-2)+'q'+Math.ceil(Number(today.slice(5,7))/3);
 summary.requestPolicy='Rolling five-year quarters through the last completed quarter; actual coverage is established from returned record dates.';
 const scopes=[...[1,2,3,4].map(batch=>({service:'PMI_Resi_Transaction',scope:'batch='+batch})),
  ...generateRentalQuarters(startQuarter).filter(q=>q!==currentQuarter).map(q=>({service:'PMI_Resi_Rental',scope:'refPeriod='+q}))];
 for(const item of scopes){
  try{
   const data=(await client.get(base+'?service='+item.service+'&'+item.scope,{headers:{AccessKey:key,Token:token}})).data;
   if(data?.Status!=='Success' || !Array.isArray(data.Result))throw Error('Invalid provider envelope');
   const bytes=JSON.stringify(data);const filename=item.service+'-'+item.scope.replace('=','-')+'.json';
   fs.writeFileSync(path.join(output,filename),bytes);
   const transactions=data.Result.reduce((n,p)=>n+(p.transaction||p.rental||[]).length,0);
   summary.scopes.push({...item,filename,sha256:digest(bytes),projectCount:data.Result.length,transactionCount:transactions,status:data.Result.length&&transactions?'captured':'empty'});
   console.log(item.service+' '+item.scope+': '+transactions+' records');
  }catch(error){summary.scopes.push({...item,status:'failed',code:error.code||null,httpStatus:error.response?.status||null});console.log(item.service+' '+item.scope+': unavailable (details sanitized)');}
  save();
 }
 summary.status=summary.scopes.every(s=>s.status==='captured')?'captured all requested scopes':'incomplete';save();
 console.log('Capture '+summary.status+'; market database unchanged.');
}
