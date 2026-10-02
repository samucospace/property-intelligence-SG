import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { up as reconcile } from '../migrations/010_reconcile_duplicate_projects.js';
import { importRealUraData, fetchUraData, uraClient } from '../ingestion.js';
import { SchedulerDaemon } from '../scheduler.js';
import { runJobWithLock, acquireJobLock } from '../utils/jobRunner.js';
import { rebuildCleanDb } from '../utils/rebuildEngine.js';
import { fileHash, databaseMetrics } from '../utils/databaseArtifacts.js';

const tx = { contractDate:'0126', price:'1000000', area:'100', propertyType:'Condominium' };
const rent = { leaseDate:'0126', rent:'4000', areaSqft:'1000-1100', noOfBedRoom:'2' };
const payload = (sales=[tx], rentals=[rent]) => [{project:'FIXTURE',street:'FIXTURE ROAD',transaction:sales,rental:rentals}];
async function memory(fn) { const conn = createConnection(':memory:'); try { await runMigrations(conn); await fn(conn); } finally { await conn.close(); } }
async function disk(fn) {
  const folder = fs.mkdtempSync(path.resolve('tests/temp-phase1-'));
  try { await fn(path.join(folder,'source.db')); }
  finally { if (!folder.startsWith(path.resolve('tests/temp-phase1-'))) throw Error('Invalid fixture path'); fs.rmSync(folder,{recursive:true,force:true}); }
}
async function seed(file) {
  const conn = createConnection(file);
  try {
    await runMigrations(conn);
    await importRealUraData(payload(),conn);
    await conn.run('CREATE TABLE suppression_state(email TEXT PRIMARY KEY, reason TEXT, project_id INTEGER REFERENCES projects(project_id))');
    await conn.run("INSERT INTO suppression_state VALUES('private@example.invalid','withdrawn',1)");
    await conn.run("INSERT INTO job_slots(job_name,slot_key,run_id) VALUES('previous','slot','run')");
    await conn.get('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { await conn.close(); }
}

describe('Phase 1 independent failure regressions', () => {
  it('same-period partial replay preserves sales/rentals and genuine multiplicity', async () => memory(async conn => {
    await importRealUraData(payload([tx,tx,{...tx,price:'1200000'}],[rent,rent]),conn);
    const repeat = await importRealUraData(payload(),conn);
    expect(repeat.totalIngested).toBe(0);
    expect((await conn.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(3);
    expect((await conn.get('SELECT COUNT(*) c FROM rental_transactions')).c).toBe(2);
    await importRealUraData(payload([tx,tx,tx],[rent,rent,rent]),conn);
    expect((await conn.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(4);
    expect((await conn.get('SELECT COUNT(*) c FROM rental_transactions')).c).toBe(3);
  }));
  it('rejects malformed date/amount/identity and empty payload before modifying records', async () => memory(async conn => {
    await importRealUraData(payload(),conn);
    for (const bad of [[],payload([{...tx,price:'0'}]),payload([{...tx,area:'100oops'}]),payload([{...tx,contractDate:'1326'}]),payload([{...tx,contractDate:'2026-02-30'}]),[{...payload()[0],street:''}]]) {
      await expect(importRealUraData(bad,conn)).rejects.toThrow();
      expect((await conn.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(1);
    }
  }));
  it('rolls back all committed-count candidates on an insertion failure', async () => memory(async conn => {
    const injected = {...conn,run: async (sql,params) => {
      if (sql.startsWith('INSERT INTO rental_transactions')) throw Error('fixture insert failure');
      return conn.run(sql,params);
    }};
    await expect(importRealUraData(payload(),injected)).rejects.toThrow('fixture insert failure');
    expect((await conn.get('SELECT COUNT(*) c FROM projects')).c).toBe(0);
    expect((await conn.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(0);
  }));
  it('provider empty or later failed batch never changes existing data', async () => memory(async conn => {
    await importRealUraData(payload(),conn);
    const mock = vi.spyOn(uraClient,'get');
    try {
      mock.mockResolvedValueOnce({data:{Status:'Success',Result:'fixture-token'}}).mockResolvedValueOnce({data:{Status:'Success',Result:[]}});
      await expect(fetchUraData('fixture',conn)).rejects.toThrow('Empty');
      mock.mockResolvedValueOnce({data:{Status:'Success',Result:'fixture-token'}}).mockResolvedValueOnce({data:{Status:'Success',Result:payload([{...tx,price:'2000000'}],[])}}).mockResolvedValueOnce({data:{Status:'Error',Message:'fixture error'}});
      await expect(fetchUraData('fixture',conn)).rejects.toThrow('unsuccessful');
      expect((await conn.get('SELECT SUM(price_sgd) amount FROM property_transactions')).amount).toBe(1000000);
    } finally { mock.mockRestore(); }
  }));
  it('validates all live scopes, preserves history and reports only new committed records', async () => memory(async conn => {
    await importRealUraData(payload(),conn);
    const previous=process.env.URA_RENTAL_START;
    process.env.URA_RENTAL_START='26q4';
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const mock=vi.spyOn(uraClient,'get').mockImplementation(async url=> {
      if(url.includes('insertNewToken')) return {data:{Status:'Success',Result:'fixture-token'}};
      const records=url.includes('PMI_Resi_Transaction') ? payload([{...tx,contractDate:'1026'}],[]) : payload([],[{...rent,leaseDate:'1026'}]);
      return {data:{Status:'Success',Result:records}};
    });
    try {
      const first=await fetchUraData('fixture',conn);
      expect(first.status).toBe('success');
      expect(first.totalIngested).toBe(5); // Four source batches retain multiplicity.
      const replay=await fetchUraData('fixture',conn);
      expect(replay.totalIngested).toBe(0);
      expect((await conn.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(5);
      expect((await conn.get('SELECT COUNT(*) c FROM rental_transactions')).c).toBe(2);
    } finally { mock.mockRestore(); vi.useRealTimers(); if(previous==null) delete process.env.URA_RENTAL_START; else process.env.URA_RENTAL_START=previous; }
  }));
  it('migration version-record failure rolls back schema and permits clean retry', async () => {
    const conn = createConnection(':memory:');
    try {
      const injected = {...conn,run: async (sql,params) => {
        if (sql.startsWith('INSERT INTO schema_migrations') && params[0].startsWith('010')) throw Error('fixture ledger failure');
        return conn.run(sql,params);
      }};
      await expect(runMigrations(injected)).rejects.toThrow('fixture ledger failure');
      expect(await conn.get("SELECT name FROM sqlite_master WHERE name='projects'")).toBeUndefined();
      await runMigrations(conn);
      expect((await conn.all('SELECT name FROM schema_migrations')).length).toBe(11);
      expect((await conn.get('PRAGMA foreign_keys')).foreign_keys).toBe(1);
    } finally { await conn.close(); }
  });
  it('interrupted ownership reassignment rolls back migration 010 completely', async () => memory(async conn => {
    await conn.run("INSERT INTO projects(project_id,project_name,street_name,market_segment,geo_source) VALUES(1,'DUPLICATE','ST. TEST ROAD','OCR','svy21'),(2,'DUPLICATE','SAINT TEST ROAD','OCR','district_centre')");
    await conn.run("INSERT INTO rental_transactions(project_id,rent_sgd,lease_date,raw_hash) VALUES(2,4000,'2026-01','original')");
    const injected = {...conn,run: async (sql,params) => {
      if (/DELETE FROM projects/i.test(sql)) throw Error('fixture interruption');
      return conn.run(sql,params);
    }};
    await expect(reconcile(injected)).rejects.toThrow('fixture interruption');
    expect((await conn.get('SELECT project_id FROM rental_transactions')).project_id).toBe(2);
    expect((await conn.get('SELECT COUNT(*) c FROM projects')).c).toBe(2);
    await reconcile(conn);
    expect((await conn.get('SELECT COUNT(*) c FROM projects')).c).toBe(1);
  }));
  it('terminated migration process releases SQLite ownership and rolls back schema', async () => disk(async file => {
    const child = fork(path.resolve('tests/fixtures/phase1-worker.mjs'),['migrate',file],{env:{...process.env,DB_PATH:file,NODE_ENV:'test'},stdio:['ignore','ignore','pipe','ipc']});
    await new Promise((resolve,reject) => { child.once('message',resolve); child.once('error',reject); child.once('exit',code => reject(Error('Premature child exit '+code))); });
    await new Promise(resolve => { child.once('exit',resolve); child.kill(); });
    const conn = createConnection(file);
    try {
      expect(await conn.get("SELECT name FROM sqlite_master WHERE name='projects'")).toBeUndefined();
      await runMigrations(conn);
      expect((await conn.all('SELECT name FROM schema_migrations')).length).toBe(11);
    } finally { await conn.close(); }
  }));
  it('fresh schedulers sharing a due slot execute it once and off-slot ticks do nothing', async () => disk(async file => {
    await seed(file);
    let count=0;
    const jobs=[{name:'fixture-due',isDue: sg => sg.hour===4,execute:async()=>{count++;return 1;}}];
    const now=()=>new Date('2026-10-02T20:00:00Z');
    const a=createConnection(file), b=createConnection(file);
    try {
      await Promise.all([new SchedulerDaemon({jobs,now,conn:a}).tick(),new SchedulerDaemon({jobs,now,conn:b}).tick()]);
      await new SchedulerDaemon({jobs,now,conn:a}).tick();
      await new SchedulerDaemon({jobs,now:()=>new Date('2026-10-02T19:00:00Z'),conn:a}).tick();
      expect(count).toBe(1);
      expect((await a.all("SELECT * FROM job_slots WHERE job_name='fixture-due'")).length).toBe(1);
    } finally { await a.close(); await b.close(); }
  }));
  it('starts an isolated staging daemon without boot dispatch and persists a due timer slot across restart', async()=>disk(async file=>{
    await seed(file);
    const conn=createConnection(file);
    await conn.run('CREATE TABLE environment_metadata(name TEXT PRIMARY KEY,value TEXT)');
    await conn.run("INSERT INTO environment_metadata VALUES('environment','staging')");
    const previousPath=process.env.DB_PATH, previousMode=process.env.NODE_ENV;
    process.env.DB_PATH=file; process.env.NODE_ENV='staging';
    let count=0;
    const options={jobs:[{name:'staging-timer',isDue:()=>true,execute:async()=>{count++;return 1;}}],now:()=>new Date('2026-10-03T20:00:00Z'),conn,intervalMs:50};
    const first=new SchedulerDaemon(options), second=new SchedulerDaemon(options);
    try {
      await first.start(); expect(count).toBe(0);
      const deadline=Date.now()+2000;
      while(!count || first.runningJobs.size) { if(Date.now()>deadline)throw Error('Staging timer did not finish'); await new Promise(resolve=>setTimeout(resolve,10)); }
      clearInterval(first.timer); first.stopping=true;
      await second.start(); await new Promise(resolve=>setTimeout(resolve,100));
      clearInterval(second.timer); second.stopping=true;
      while(second.runningJobs.size) await new Promise(resolve=>setTimeout(resolve,10));
      expect(count).toBe(1);
      expect((await conn.get("SELECT status FROM job_history WHERE job_name='staging-timer'")).status).toBe('success');
    } finally {
      clearInterval(first.timer);clearInterval(second.timer);first.stopping=true;second.stopping=true;
      process.env.DB_PATH=previousPath;process.env.NODE_ENV=previousMode;
      await conn.close();
    }
  }));
  it('expired leases do not allow overlap while the owner process is alive', async () => memory(async conn => {
    await acquireJobLock(conn,'long-job',`pid-${process.pid}`,0);
    const second=await acquireJobLock(conn,'long-job','other',15);
    expect(second.acquired).toBe(false);
  }));
  it('renews a running lease and records skipped/partial results honestly', async () => memory(async conn => {
    await runJobWithLock({jobName:'heartbeat',conn,heartbeatMs:10,fn:async()=>{
      await conn.run("UPDATE job_locks SET lease_expires_at='2000-01-01' WHERE job_name='heartbeat'");
      await new Promise(resolve=>setTimeout(resolve,45));
      expect((await conn.get("SELECT datetime(lease_expires_at)>datetime('now') active FROM job_locks WHERE job_name='heartbeat'")).active).toBe(1);
      return {skipped:true,reason:'fixture disabled'};
    }});
    expect((await conn.get("SELECT status FROM job_history WHERE job_name='heartbeat'")).status).toBe('skipped');
    await expect(runJobWithLock({jobName:'partial',conn,fn:async()=>({status:'partial_success',totalIngested:7})})).rejects.toThrow('partial_success');
    const history=await conn.get("SELECT * FROM job_history WHERE job_name='partial'");
    expect(history.status).toBe('failed'); expect(history.items_processed).toBe(7);
  }));
  for (const stage of ['prepared','source-moved','installed']) it('recovers an abruptly terminated rebuild at '+stage, async()=>disk(async file=>{
    await seed(file); const hash=fileHash(file);
    const child=spawnSync(process.execPath,[path.resolve('tests/fixtures/phase1-worker.mjs'),'rebuild',file,stage],{env:{...process.env,NODE_ENV:'test'},encoding:'utf8',timeout:20000});
    expect(child.status,child.stderr).toBe(73);
    expect(()=>createConnection(file)).toThrow(/maintenance|recovery/);
    const restore=spawnSync(process.execPath,[path.resolve('tests/fixtures/phase1-worker.mjs'),'recover',file],{env:{...process.env,NODE_ENV:'test'},encoding:'utf8',timeout:20000});
    expect(restore.status,restore.stderr).toBe(0);
    expect(fileHash(file)).toBe(hash);
    expect((await databaseMetrics(file)).counts.suppression_state).toBe(1);
  }));
  it('rejects empty candidate and active source handles without changing the source',async()=>disk(async file=>{
    await seed(file); const hash=fileHash(file);
    const open=createConnection(file);
    await expect(rebuildCleanDb({targetLivePath:file,dataProvider:async()=>({status:'success'})})).rejects.toThrow('Open source handles');
    await open.close();
    await expect(rebuildCleanDb({targetLivePath:file,minimumCounts:{projects:1,sales:1,rentals:1},dataProvider:async()=>({status:'success'})})).rejects.toThrow('Population');
    expect(fileHash(file)).toBe(hash);
  }));
  it('refuses a swap while another process holds the source open',async()=>disk(async file=>{
    await seed(file); const hash=fileHash(file);
    const child=fork(path.resolve('tests/fixtures/phase1-worker.mjs'),['hold',file],{env:{...process.env,NODE_ENV:'test'},stdio:['ignore','ignore','pipe','ipc']});
    await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});
    try {
      await expect(rebuildCleanDb({targetLivePath:file,minimumCounts:{projects:1,sales:1,rentals:1},dataProvider:async conn=>{
        await importRealUraData(payload(),conn); return {status:'success'};
      }})).rejects.toThrow('WAL/SHM');
      expect(fileHash(file)).toBe(hash);
    } finally { await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();}); }
  }), 30000);
  it('preserves suppression schemas, rows and durable job slots through a successful rebuild',async()=>disk(async file=>{
    await seed(file);
    await rebuildCleanDb({targetLivePath:file,minimumCounts:{projects:1,sales:1,rentals:1},dataProvider:async conn=>{
      await importRealUraData(payload(),conn); return {status:'success'};
    }});
    const conn=createConnection(file);
    try {
      expect((await conn.get('SELECT reason FROM suppression_state')).reason).toBe('withdrawn');
      expect((await conn.get("SELECT run_id FROM job_slots WHERE job_name='previous'")).run_id).toBe('run');
      expect((await conn.get('SELECT COUNT(*) c FROM property_transactions')).c).toBe(1);
    } finally { await conn.close(); }
  }));
  it('surfaces database-open errors through awaited operations',async()=>disk(async file=>{
    fs.mkdirSync(file);
    const conn=createConnection(file);
    await expect(conn.get('SELECT 1')).rejects.toThrow();
    await conn.close().catch(()=>{});
  }));
});
