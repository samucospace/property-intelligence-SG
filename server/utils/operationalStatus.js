import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultSnapshotKeys} from './analyticsSnapshots.js';
import {releaseFeatures} from './releasePolicy.js';

const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../migrations');
export async function readinessStatus(conn) {
  const applied=new Set((await conn.all('SELECT name FROM schema_migrations')).map(row=>row.name));
  const expected=fs.readdirSync(migrations).filter(name=>/^\d+.*\.js$/.test(name)).map(name=>name.slice(0,-3));
  const schema=expected.every(name=>applied.has(name));
  const projects=(await conn.get('SELECT count(*) AS n FROM projects')).n;
  const keys=defaultSnapshotKeys();
  const prepared=(await conn.get('SELECT count(*) AS n FROM analytics_snapshots WHERE cache_key IN (?,?,?) AND generation=(SELECT generation FROM market_versions WHERE id=1)',keys)).n===keys.length;
  const periods=await conn.get(`SELECT (SELECT max(contract_date) FROM property_transactions) AS sales,(SELECT max(lease_date) FROM rental_transactions) AS rentals`);
  return {ready:schema && projects>0 && prepared,checks:{database:true,schema,marketData:projects>0,preparedAnalytics:prepared},
    dataState:projects===0?'empty':!prepared?'updating':'available',periods};
}

export async function operationalStatus(conn,{now=Date.now(),minFreeBytes=512*1024*1024}={}) {
  const issues=[],add=(key,summary,severity='critical')=>issues.push({key,summary,severity});
  const readiness=await readinessStatus(conn);
  if(!readiness.checks.schema) add('schema','Required database migrations are missing');
  if(!readiness.checks.marketData) add('market-empty','Public market data is unavailable');
  else if(!readiness.checks.preparedAnalytics) add('analytics-preparation','Analytics materializations need refresh','warning');
  for(const [name,period] of Object.entries(readiness.periods)) {
    if(!period || now-Date.parse(period.length===7?period+'-01T00:00:00Z':period.slice(0,10)+'T00:00:00Z')>120*86400000) add('market-period:'+name,`${name} records are missing or more than 120 days old`,'warning');
  }
  const jobs=await conn.all(`SELECT h.job_name,h.status,h.started_at,h.finished_at FROM job_history h WHERE h.rowid=(SELECT rowid FROM job_history h2 WHERE h2.job_name=h.job_name ORDER BY started_at DESC,rowid DESC LIMIT 1)`);
  for(const job of jobs) if(['failed','partial_success','interrupted'].includes(job.status)) add('job:'+job.job_name,`${job.job_name} did not complete successfully`);
  const successful=await conn.all("SELECT job_name,max(finished_at) AS finished_at FROM job_history WHERE status='success' GROUP BY job_name");
  const age=name=>{const date=successful.find(job=>job.job_name===name)?.finished_at;return date ? now-Date.parse(date.replace(' ','T')+(date.includes('Z')?'':'Z')) : Infinity;};
  if(age('cron-db-backup')>26*3600000) add('backup-stale','No successful encrypted offsite backup within 26 hours');
  if(releaseFeatures().dataSync && age('cron-ura-sync')>8*86400000) add('source-stale','No successful source sync within eight days');
  if(releaseFeatures().outboundEmail) {
    const delayed=await conn.get("SELECT count(*) AS n FROM email_outbox WHERE status IN ('pending','failed','claimed') AND created_at<datetime('now','-15 minutes')");
    if(delayed.n) add('email-delayed','Email dispatch has work waiting more than 15 minutes');
    const failed=await conn.get("SELECT count(*) AS n FROM email_outbox WHERE status='permanent_failed' AND updated_at>datetime('now','-24 hours')");
    if(failed.n) add('email-failed','Email dispatch has permanent failures requiring review');
  }
  if(conn.path && conn.path!==':memory:') {
    try {
      const disk=fs.statfsSync(path.dirname(path.resolve(conn.path))),free=disk.bavail*disk.bsize;
      if(free<minFreeBytes) add('disk-low','Database volume has insufficient free disk space');
    } catch {add('disk-unverified','Database volume free space could not be checked','warning');}
  }
  if(process.env.PRIVACY_LEDGER_REPLICA_PATH && !fs.existsSync(process.env.PRIVACY_LEDGER_REPLICA_PATH)) add('privacy-replica','Independent privacy replica is unavailable');
  return {checkedAt:new Date(now).toISOString(),readiness,jobs,issues};
}
