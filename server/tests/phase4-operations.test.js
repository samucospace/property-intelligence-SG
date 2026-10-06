import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getPrimaryConnection,closeDb,createConnection} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {prepareDefaultAnalytics,getPriceAnalytics,clearAnalyticsCache} from '../queryEngine.js';
import {readinessStatus,operationalStatus} from '../utils/operationalStatus.js';
import {runOperationsMonitor,sendOperationalAlert} from '../utils/operationalAlerts.js';
import {getDefaultDateRange} from '../utils/dateUtils.js';
import {app} from '../index.js';

describe('Phase 4 readiness, freshness and independent alert failures',()=>{
  let folder,db,previous,server;
  beforeEach(async()=>{
    await closeDb();previous=process.env.DB_PATH;folder=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-operations-'));
    process.env.DB_PATH=path.join(folder,'fixture.db');db=getPrimaryConnection();await runMigrations(db);
    await db.run("INSERT INTO projects(project_id,project_name,street_name,market_segment,is_landed_aggregate) VALUES(1,'PUBLIC FIXTURE','FIXTURE ROAD','CCR',0)");
    await db.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,psft_sgd,psqm_sgd,area_sqft,area_sqm,property_type,no_of_units) VALUES(1,'2026-01-01',2000000,2000,21527.8,1000,92.903,'Apartment',1)");
    await db.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,rent_psft,rent_psqm,area_sqft,area_sqm,property_type,bedroom_count) VALUES(1,'2026-01',5000,5,53.82,1000,92.903,'Apartment',2)");
    await prepareDefaultAnalytics();
  });
  afterEach(async()=>{
    vi.restoreAllMocks();if(server?.listening) await new Promise(resolve=>server.close(resolve));
    await closeDb();process.env.DB_PATH=previous;fs.rmSync(folder,{recursive:true,force:true});
  });
  it('invalidates prepared analytics across connections after market writes, not operational writes',async()=>{
    expect((await readinessStatus(db)).ready).toBe(true);
    await db.run("INSERT INTO operational_issues(issue_key,is_open,summary,severity) VALUES('test',0,'test','warning')");
    expect((await readinessStatus(db)).ready).toBe(true);
    const other=createConnection();try {await other.run('UPDATE property_transactions SET price_sgd=2100000,psft_sgd=2100');} finally {await other.close();}
    expect((await readinessStatus(db)).ready).toBe(false);
    clearAnalyticsCache();expect((await getPriceAnalytics()).summary.medianPsft).toBe(2100);
    await prepareDefaultAnalytics();expect((await readinessStatus(db)).ready).toBe(true);
  });
  it('reports unavailable market periods, failed jobs, stale backups and low disk',async()=>{
    await db.run("INSERT INTO job_history(run_id,job_name,status,started_at,finished_at) VALUES('failed-backup','cron-db-backup','failed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
    const state=await operationalStatus(db,{now:Date.parse('2026-10-06T00:00:00Z'),minFreeBytes:Number.MAX_SAFE_INTEGER});
    expect(state.issues.map(issue=>issue.key)).toEqual(expect.arrayContaining(['backup-stale','job:cron-db-backup','disk-low','market-period:sales','market-period:rentals']));
    expect(JSON.stringify(state)).not.toContain('@');
  });
  it('persists each raised/resolved transition once and fences accepted alerts',async()=>{
    const send=vi.fn(async()=>({accepted:true}));
    const first=await runOperationsMonitor({conn:db,sendAlertFn:send});expect(first.accepted).toBeGreaterThan(0);
    expect((await runOperationsMonitor({conn:db,sendAlertFn:send})).accepted).toBe(0);
    await db.run("INSERT INTO job_history(run_id,job_name,status,started_at,finished_at) VALUES('good-backup','cron-db-backup','success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
    await runOperationsMonitor({conn:db,sendAlertFn:send});
    expect((await db.get("SELECT count(*) AS n FROM operational_alerts WHERE issue_key='backup-stale' AND event_type='resolved'")).n).toBe(1);
    expect((await db.get("SELECT count(*) AS n FROM operational_alerts WHERE status='accepted' AND lease_token IS NOT NULL")).n).toBe(0);
  });
  it('retries a provider outage with the same idempotency key and exhausts at five attempts',async()=>{
    const send=vi.fn(async()=>{throw new Error('fake provider outage');});
    for(let n=0;n<6;n++) {await db.run('UPDATE operational_alerts SET next_retry_at=NULL');await runOperationsMonitor({conn:db,sendAlertFn:send});}
    const rows=await db.all('SELECT * FROM operational_alerts');expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row=>row.attempts===5 && row.status==='failed')).toBe(true);
    const firstKey=send.mock.calls[0][1].idempotencyKey;expect(send.mock.calls.filter(([,options])=>options.idempotencyKey===firstKey)).toHaveLength(5);
  });
  it('never records a staged fake alert as received or transport accepted',async()=>{
    const network=vi.spyOn(globalThis,'fetch');
    const result=await runOperationsMonitor({conn:db,sendAlertFn:sendOperationalAlert});expect(result.status).toBe('skipped');expect(result.mocked).toBeGreaterThan(0);
    expect(network).not.toHaveBeenCalled();expect((await db.get("SELECT count(*) AS n FROM operational_alerts WHERE status='accepted'")).n).toBe(0);
  });
  it('uses an independent emergency path when the database fails and limits repeated notices',async()=>{
    const send=vi.fn(async()=>({accepted:true})),broken={all:async()=>{throw new Error('disk full');}};
    expect(await runOperationsMonitor({conn:broken,sendAlertFn:send})).toMatchObject({emergency:true,accepted:1});
    expect(await runOperationsMonitor({conn:broken,sendAlertFn:send})).toMatchObject({emergency:true,throttled:true});expect(send).toHaveBeenCalledTimes(1);
  });
  it('serves liveness and empty-dataset readiness independently of public API traffic',async()=>{
    await db.run('DELETE FROM projects');
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    expect((await fetch(base+'/api/health/live')).status).toBe(200);
    const response=await fetch(base+'/api/health/ready');expect(response.status).toBe(503);expect((await response.json()).dataState).toBe('empty');
  });
  it('readiness refuses a database in maintenance even if its public dataset is prepared',async()=>{
    fs.writeFileSync(process.env.DB_PATH+'.maintenance','isolated test');
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/health/ready`);
    expect(response.status).toBe(503);expect((await response.json()).dataState).toBe('unavailable');
  });
  it('clamps leap-day ranges to a valid calendar day in Singapore',()=>{
    expect(getDefaultDateRange(5,new Date('2024-02-28T16:00:00Z'))).toEqual({dateFrom:'2019-02-28',dateTo:'2024-02-29'});
  });
});
