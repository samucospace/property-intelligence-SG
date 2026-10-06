import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createConnection,closeDb} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {app} from '../index.js';
import {enqueueEmail,processOutboxBatch,claimPendingEmails,markEmailAccepted} from '../utils/emailQueue.js';
import {suppressEmail,hashEmail} from '../utils/suppression.js';
import {encryptFile,decryptFile,runBackup} from '../scripts/backup-db.js';
import {fileHash} from '../utils/databaseArtifacts.js';
import {readPrivacyLedger} from '../utils/privacyLedger.js';
import {sendWeeklyNewsletter} from '../scripts/send-weekly-newsletter.js';
import {replicateBackupOffsite} from '../scripts/replicate-backup-offsite.js';
import {generateAdminSession} from '../utils/security.js';
import {validateFilters} from '../utils/validation.js';
import {cleanupLeads} from '../scripts/cleanup-leads.js';
import {sendEmail} from '../utils/emailAdapter.js';
import {restoreBaseline} from '../scripts/restore-baseline.js';

describe('Phase 3 real boundaries and crash recovery',()=>{
  let env,dir,db,server,base,client=1;
  beforeEach(async()=>{
    env={...process.env}; dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase3-integration-'));
    Object.assign(process.env,{DB_PATH:path.join(dir,'live.db'),PRIVACY_LEDGER_PATH:path.join(dir,'privacy.jsonl'),
      RELEASE_SCOPE:'full',NODE_ENV:'test',MOCK_EMAIL:'true',ENABLE_OUTBOUND_EMAIL:'false',
      AGENT_NOTIFICATION_EMAIL:'agent@example.invalid',NEWSLETTER_PREVIEW_PATH:path.join(dir,'preview.html')});
    delete process.env.PRIVACY_LEDGER_REPLICA_PATH;
    delete process.env.OFFSITE_BACKUP_BUCKET;
    fs.writeFileSync(process.env.PRIVACY_LEDGER_PATH,'');
    db=createConnection(); await runMigrations(db);
    server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    base=`http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async()=>{
    await new Promise(resolve=>server.close(resolve)); await db.close(); await closeDb();
    process.env=env; vi.restoreAllMocks(); fs.rmSync(dir,{recursive:true,force:true});
  });
  const accepted=async()=>({data:{id:'provider-accepted'},error:null});
  const request=(method,route,body,headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json','Accept':'application/json',
    'X-Forwarded-For':`192.0.2.${client++%240+1}`,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function signup(email='reader@example.invalid') {
    expect((await request('POST','/api/leads/submit',{email,leadType:'newsletter',pdpaConsent:true})).status).toBe(202);
    return db.get('SELECT * FROM leads WHERE email=?',[email]);
  }
  it('completes signup, failed-send recovery, scanner-safe confirmation, newsletter and unsubscribe through real routes',async()=>{
    const lead=await signup();
    const result=await processOutboxBatch({conn:db,sendEmailFn:async()=>({error:{statusCode:500,message:'outage'}})});
    expect(result.failed).toBe(1);
    expect((await db.get('SELECT last_confirmation_sent_at FROM leads WHERE lead_id=?',[lead.lead_id])).last_confirmation_sent_at).toBeNull();
    const retry=await request('POST','/api/leads/submit',{email:lead.email,leadType:'newsletter',pdpaConsent:true});
    expect(retry.status).toBe(202); expect((await retry.json()).message).toContain('queued');
    await db.run("UPDATE email_outbox SET next_retry_at=datetime('now','-1 minute')");
    expect((await processOutboxBatch({conn:db,sendEmailFn:accepted})).accepted).toBe(1);
    const url=`/api/newsletter/confirm?email=${lead.email}&token=${lead.confirmation_token}`;
    expect((await request('GET',url)).status).toBe(200);
    expect((await db.get('SELECT confirmed_at FROM leads WHERE lead_id=?',[lead.lead_id])).confirmed_at).toBeNull();
    expect((await request('POST','/api/newsletter/confirm',{email:lead.email,token:lead.confirmation_token})).status).toBe(200);
    expect((await request('POST','/api/newsletter/confirm',{email:lead.email,token:lead.confirmation_token})).status).toBe(403);
    expect((await sendWeeklyNewsletter(db)).queuedCount).toBe(1);
    expect((await sendWeeklyNewsletter(db)).queuedCount).toBe(0);
    expect((await processOutboxBatch({conn:db,sendEmailFn:accepted})).accepted).toBe(1);
    expect((await db.get('SELECT last_newsletter_sent_at FROM leads WHERE lead_id=?',[lead.lead_id])).last_newsletter_sent_at).not.toBeNull();
    const token=crypto.createHmac('sha256',process.env.UNSUBSCRIBE_SECRET).update(lead.email).digest('hex');
    expect((await request('POST',`/api/leads/unsubscribe?email=${lead.email}&token=${token}`,{})).status).toBe(200);
    expect((await request('POST','/api/leads/submit',{email:lead.email,leadType:'newsletter',pdpaConsent:true})).status).toBe(409);
    expect(readPrivacyLedger(process.env.PRIVACY_LEDGER_PATH)).toHaveLength(1);
  });
  it('rejects missing/expired expiry and releases quarantine only after a fresh explicit confirmation',async()=>{
    const lead=await signup();
    await db.run('UPDATE leads SET is_quarantined=1,confirmation_token_expires_at=NULL WHERE lead_id=?',[lead.lead_id]);
    const body={email:lead.email,token:lead.confirmation_token};
    expect((await request('POST','/api/newsletter/confirm',body)).status).toBe(403);
    await db.run("UPDATE leads SET confirmation_token_expires_at=datetime('now','-1 minute') WHERE lead_id=?",[lead.lead_id]);
    expect((await request('POST','/api/newsletter/confirm',body)).status).toBe(403);
    await db.run("UPDATE leads SET confirmation_token_expires_at=datetime('now','+24 hours') WHERE lead_id=?",[lead.lead_id]);
    expect((await request('POST','/api/newsletter/confirm',body)).status).toBe(200);
    expect((await db.get('SELECT is_quarantined FROM leads WHERE lead_id=?',[lead.lead_id])).is_quarantined).toBe(0);
    expect((await db.get("SELECT count(*) n FROM consent_events WHERE action='confirmed'")).n).toBe(1);
  });
  it('fails closed without an advisory recipient and deduplicates retried advisory requests',async()=>{
    const body={email:'advisory@example.invalid',phone:'81234567',leadType:'agent_advisory',pdpaConsent:true,requestId:'same-request-123456'};
    delete process.env.AGENT_NOTIFICATION_EMAIL; delete process.env.AGENT_EMAIL;
    expect((await request('POST','/api/leads/submit',body)).status).toBe(503);
    expect((await db.get('SELECT count(*) n FROM leads')).n).toBe(0);
    process.env.AGENT_NOTIFICATION_EMAIL='agent@example.invalid';
    expect((await request('POST','/api/leads/submit',body)).status).toBe(202);
    expect((await request('POST','/api/leads/submit',body)).status).toBe(202);
    expect((await db.get('SELECT count(*) n FROM leads')).n).toBe(1);
    expect((await db.get('SELECT count(*) n FROM email_outbox')).n).toBe(1);
  });
  it('rolls back lead creation if durable email intent cannot be committed',async()=>{
    await db.run("CREATE TRIGGER reject_outbox BEFORE INSERT ON email_outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    expect((await request('POST','/api/leads/submit',{email:'rollback@example.invalid',leadType:'newsletter',pdpaConsent:true})).status).toBe(500);
    expect((await db.get('SELECT count(*) n FROM leads')).n).toBe(0);
  });
  it('five competing native processes claim a disk-backed item once',async()=>{
    await enqueueEmail({recipient:'one@example.invalid',subject:'one',emailType:'newsletter_digest'},db);
    const run=()=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['tests/fixtures/outbox-worker.js',process.env.DB_PATH],{env:process.env});
      let out=''; child.stdout.on('data',chunk=>out+=chunk);child.on('error',reject);
      child.on('exit',code=>code===0?resolve(JSON.parse(out.trim())):reject(new Error('worker failed')));
    });
    const results=await Promise.all(Array.from({length:5},run));
    expect(results.flat()).toHaveLength(1);
  });
  it('recovers a crashed worker and fences its old acceptance update',async()=>{
    const item=await enqueueEmail({recipient:'crash@example.invalid',subject:'crash',emailType:'newsletter_digest'},db);
    const crashed=spawnSync(process.execPath,['tests/fixtures/outbox-worker.js',process.env.DB_PATH,'crash'],{env:process.env});
    expect(crashed.status).toBe(23);
    const stale=await db.get('SELECT lease_token FROM email_outbox WHERE id=?',[item.id]);
    await db.run("UPDATE email_outbox SET lease_expires_at=datetime('now','-1 minute') WHERE id=?",[item.id]);
    const fresh=await claimPendingEmails({workerId:'replacement'},db);
    expect(fresh).toHaveLength(1);
    expect((await markEmailAccepted(db,item.id,'wrong',stale.lease_token)).changes).toBe(0);
    expect((await markEmailAccepted(db,item.id,'correct',fresh[0].lease_token)).changes).toBe(1);
  });
  it('quarantines ambiguous work beyond the provider idempotency window',async()=>{
    await enqueueEmail({recipient:'old@example.invalid',subject:'old',emailType:'newsletter_digest'},db);
    await claimPendingEmails({},db);
    await db.run("UPDATE email_outbox SET first_dispatch_at=datetime('now','-25 hours'),lease_expires_at=datetime('now','-1 hour')");
    const send=vi.fn(accepted);await processOutboxBatch({conn:db,sendEmailFn:send});
    expect(send).not.toHaveBeenCalled();expect((await db.get('SELECT status FROM email_outbox')).status).toBe('permanent_failed');
  });
  it('reuses provider idempotency after a native crash following acceptance',async()=>{
    await enqueueEmail({recipient:'receipt@example.invalid',subject:'receipt',emailType:'newsletter_digest',payload:{html:'same body'}},db);
    const receipt=path.join(dir,'provider-receipt.json');
    expect(spawnSync(process.execPath,['tests/fixtures/outbox-worker.js',process.env.DB_PATH,'accepted-crash',receipt],{env:process.env}).status).toBe(23);
    await db.run("UPDATE email_outbox SET lease_expires_at=datetime('now','-1 minute')");
    const provider=JSON.parse(fs.readFileSync(receipt));
    const send=async request=>{expect(request.idempotencyKey).toBe(provider.key);return {data:{id:provider.id}};};
    expect((await processOutboxBatch({conn:db,sendEmailFn:send})).accepted).toBe(1);
    expect((await db.get('SELECT provider_message_id FROM email_outbox')).provider_message_id).toBe(provider.id);
  });
  it.each([422,429,500,504])('handles provider %i and caps attempts without recording acceptance',async(statusCode)=>{
    await enqueueEmail({recipient:'failure@example.invalid',subject:'test',emailType:'newsletter_digest',maxAttempts:2},db);
    await processOutboxBatch({conn:db,sendEmailFn:async()=>({error:{statusCode,message:'failure'}})});
    const row=await db.get('SELECT * FROM email_outbox');
    expect(row.status).toBe(statusCode===422?'permanent_failed':'failed');expect(row.provider_message_id).toBeNull();
    await db.run("UPDATE email_outbox SET next_retry_at=datetime('now','-1 minute')");
    await processOutboxBatch({conn:db,sendEmailFn:async()=>{throw new Error('timeout');}});
    expect((await db.get('SELECT status FROM email_outbox')).status).toBe('permanent_failed');
  });
  it('never records mock dispatch as live acceptance',async()=>{
    await enqueueEmail({recipient:'mock@example.invalid',subject:'mock',emailType:'newsletter_digest'},db);
    expect((await processOutboxBatch({conn:db})).accepted).toBe(0);
    expect((await db.get('SELECT provider_message_id FROM email_outbox')).provider_message_id).toBeNull();
  });
  it('restores in a native process using independently recovered deletion events and removes queued personal details',async()=>{
    const lead=await signup('erase@example.invalid');
    await db.run("UPDATE leads SET name='Private name',phone='81234567' WHERE lead_id=?",[lead.lead_id]);
    const plain=path.join(dir,'snapshot.db'); await db.run('VACUUM INTO ?',[plain]);
    const encrypted=plain+'.enc',key=path.join(dir,'key');fs.writeFileSync(key,'k'.repeat(64));await encryptFile(plain,encrypted,'k'.repeat(64));
    await suppressEmail({email:lead.email,reason:'erased'},db);
    const restored=path.join(dir,'restored.db');
    const child=spawnSync(process.execPath,['scripts/restore-baseline.js',`--backup=${encrypted}`,`--key-file=${key}`,`--output=${restored}`,`--sha256=${fileHash(plain)}`,`--privacy-ledger=${process.env.PRIVACY_LEDGER_PATH}`],{encoding:'utf8',env:{...process.env,NODE_ENV:'production'},timeout:20000});
    expect(child.status,child.stderr).toBe(0);
    const check=createConnection(restored);
    try { expect((await check.get('SELECT count(*) n FROM leads')).n).toBe(0);expect((await check.get('SELECT payload_json FROM email_outbox')).payload_json).toBe('{}'); }
    finally {await check.close();}
  });
  it('fails production restoration without a ledger and rejects ciphertext corruption',async()=>{
    const plain=path.join(dir,'plain');fs.writeFileSync(plain,'fixture');const enc=plain+'.enc';await encryptFile(plain,enc,'secret');
    const bytes=fs.readFileSync(enc);bytes[30]^=1;fs.writeFileSync(enc,bytes);
    await expect(decryptFile(enc,plain+'.restored','secret')).rejects.toThrow();
    process.env.NODE_ENV='production';process.env.KEEP_UNENCRYPTED_BACKUPS='true';await expect(runBackup()).rejects.toThrow(/plaintext/);
    await expect(restoreBaseline({backupPath:enc,keyFile:plain,outputPath:plain+'.out',expectedHash:'unused'})).rejects.toThrow(/privacy ledger/);
  });
  it('verifies signed bounce/complaint webhooks, rejects forgery and deduplicates replay',async()=>{
    const lead=await signup('bounce@example.invalid');
    const secret=crypto.randomBytes(32);process.env.RESEND_WEBHOOK_SECRET='whsec_'+secret.toString('base64');
    const event={type:'email.bounced',data:{email_id:'accepted-id',to:[lead.email]}};
    const payload=JSON.stringify(event),id='event-bounce-1',timestamp=String(Math.floor(Date.now()/1000));
    const signature='v1,'+crypto.createHmac('sha256',secret).update(`${id}.${timestamp}.${payload}`).digest('base64');
    const headers={'svix-id':id,'svix-timestamp':timestamp,'svix-signature':signature};
    expect((await request('POST','/api/email/webhook',event,{...headers,'svix-signature':'v1,invalid'})).status).toBe(401);
    expect((await request('POST','/api/email/webhook',event,headers)).status).toBe(200);
    expect((await request('POST','/api/email/webhook',event,headers)).status).toBe(200);
    expect((await db.get('SELECT reason FROM email_suppression')).reason).toBe('bounced');
    expect((await db.get('SELECT count(*) n FROM email_provider_events')).n).toBe(1);
    expect((await db.get('SELECT status FROM email_outbox')).status).toBe('suppressed');
    const complaint={type:'email.complained',data:{email_id:'complaint-id',to:['complaint@example.invalid']}};
    const cid='event-complaint-1',csig='v1,'+crypto.createHmac('sha256',secret).update(`${cid}.${timestamp}.${JSON.stringify(complaint)}`).digest('base64');
    expect((await request('POST','/api/email/webhook',complaint,{'svix-id':cid,'svix-timestamp':timestamp,'svix-signature':csig})).status).toBe(200);
    expect((await db.get('SELECT reason FROM email_suppression WHERE email_hash=?',[hashEmail('complaint@example.invalid')])).reason).toBe('complaint');
  });
  it('passes stable idempotency and an abort signal to the real provider adapter',async()=>{
    Object.assign(process.env,{NODE_ENV:'production',MOCK_EMAIL:'false',RESEND_API_KEY:'re_fixture',ENABLE_OUTBOUND_EMAIL:'true'});
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'accepted'}),{status:200,headers:{'content-type':'application/json'}}));
    expect((await sendEmail({from:'sender@example.invalid',to:'reader@example.invalid',subject:'fixture',html:'fixture',idempotencyKey:'stable-key'})).data.id).toBe('accepted');
    expect(fetch.mock.calls[0][1].headers.get('Idempotency-Key')).toBe('stable-key');
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('revokes a unique operator session and denies unauthenticated/private-gateway access',async()=>{
    const login=await request('POST','/api/admin/login',{adminKey:process.env.ADMIN_API_KEY});expect(login.status).toBe(200);
    const session=await login.json();const headers={Authorization:`Bearer ${session.token}`};
    expect((await request('GET','/api/admin/leads')).status).toBe(401);
    expect((await request('GET','/api/admin/leads',undefined,headers)).status).toBe(200);
    expect((await request('POST','/api/admin/logout',{},headers)).status).toBe(200);
    expect((await request('GET','/api/admin/leads',undefined,headers)).status).toBe(401);
    expect(generateAdminSession(process.env.ADMIN_API_KEY).token).not.toBe(session.token);
    process.env.NODE_ENV='production';
    expect((await request('GET','/api/admin/leads',undefined,headers)).status).toBe(403);
  });
  it('allows the actual DELETE preflight for the configured admin origin',async()=>{
    const response=await request('OPTIONS','/api/admin/leads/1',undefined,{'Origin':'https://admin.example.invalid',
      'Access-Control-Request-Method':'DELETE','Access-Control-Request-Headers':'x-admin-session'});
    expect(response.status).toBe(204);expect(response.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(response.headers.get('access-control-allow-headers').toLowerCase()).toContain('x-admin-session');
  });
  it('returns bounded HTTP errors for malformed bodies and optional field types',async()=>{
    expect((await request('POST','/api/leads/submit',{email:'invalid@example.invalid',leadType:'newsletter',pdpaConsent:true,details:{nested:true}})).status).toBe(400);
    expect((await request('POST','/api/analytics/price-trends',{filters:{page:true}})).status).toBe(400);
    expect((await fetch(base+'/api/leads/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{malformed'})).status).toBe(400);
  });
  it('requires a remote production backup and verifies transport downloads before retention deletion',async()=>{
    const file=path.join(dir,'property-backup-fixture.db.enc');fs.writeFileSync(file,crypto.randomBytes(100));
    process.env.NODE_ENV='production';await expect(replicateBackupOffsite({backupFile:file})).rejects.toThrow(/OFFSITE_BACKUP_BUCKET/);
    process.env.OFFSITE_BACKUP_BUCKET='independent-test-bucket';const objects=new Map(),deleted=[];
    const fake=async args=>{
      const get=flag=>args[args.indexOf(flag)+1];
      if(args[1]==='put-object') objects.set(get('--key'),fs.readFileSync(get('--body')));
      if(args[1]==='get-object') fs.writeFileSync(args.at(-1),objects.get(get('--key')));
      if(args[1]==='list-objects-v2') return {Contents:[{Key:'homeintel/property-backup-old.db.enc',LastModified:'2020-01-01'}]};
      if(args[1]==='delete-object') deleted.push(get('--key'));
      return {};
    };
    expect((await replicateBackupOffsite({backupFile:file,runAws:fake})).success).toBe(true);
    expect(deleted).toEqual(['homeintel/property-backup-old.db.enc']);
  });
  it('runs the backup entry point and restores using its recorded plaintext checksum',async()=>{
    await signup('backup@example.invalid');
    process.env.BACKUP_DIR=path.join(dir,'backups');process.env.BACKUP_ENCRYPTION_KEY='k'.repeat(64);
    const result=await runBackup(db);expect(result.backupFilename.endsWith('.enc')).toBe(true);
    expect(fs.existsSync(result.backupPath.slice(0,-4))).toBe(false);
    const metadata=JSON.parse(fs.readFileSync(result.manifestPath));expect(metadata.snapshotSha256).toBe(result.snapshotSha256);
    const key=path.join(dir,'key');fs.writeFileSync(key,process.env.BACKUP_ENCRYPTION_KEY);
    const restored=await restoreBaseline({backupPath:result.backupPath,keyFile:key,outputPath:path.join(dir,'verified.db'),expectedHash:metadata.snapshotSha256,privacyLedgerFile:process.env.PRIVACY_LEDGER_PATH});
    expect(restored.integrity).toBe('ok');expect(restored.foreignKeyViolations).toBe(0);
  });
  it('denies shared-key access, tracks conversion, and fails closed when revocation storage fails',async()=>{
    expect((await request('GET','/api/admin/leads',undefined,{'X-Admin-Key':process.env.ADMIN_API_KEY})).status).toBe(401);
    const session=generateAdminSession(process.env.ADMIN_API_KEY);const headers={'Authorization':`Bearer ${session.token}`};
    await db.run("INSERT INTO leads(email,lead_type) VALUES('converted@example.invalid','agent_advisory')");
    const lead=await db.get('SELECT lead_id FROM leads');
    expect((await request('POST',`/api/admin/leads/${lead.lead_id}/conversion`,{converted:true},headers)).status).toBe(200);
    expect((await db.get('SELECT converted_at FROM leads')).converted_at).not.toBeNull();
    await db.run('DROP TABLE admin_revoked_tokens');
    expect((await request('GET','/api/admin/leads',undefined,headers)).status).toBe(503);
  });
  it('rejects coercive inputs and impossible dates',()=>{
    for(const filters of [{page:true},{limit:[1]},{radiusKm:[2]},{priceMax:'Infinity'},{dateFrom:'2026-02-99'},{priceMin:5,priceMax:1}]) expect(validateFilters(filters).valid).toBe(false);
  });
  it('retains recently converted enquiries and records erasure tombstones for expired unconverted enquiries',async()=>{
    await db.run("INSERT INTO leads(email,lead_type,is_converted,created_at,converted_at) VALUES('recent@example.invalid','agent_advisory',1,date('now','-6 years'),date('now','-1 year'))");
    await db.run("INSERT INTO leads(email,lead_type,created_at,retention_reviewed_at) VALUES('old@example.invalid','agent_advisory',date('now','-2 years'),CURRENT_TIMESTAMP)");
    expect((await cleanupLeads(db)).purgedAdvisory).toBe(1);
    expect((await db.get('SELECT email FROM leads')).email).toBe('recent@example.invalid');
    expect(readPrivacyLedger(process.env.PRIVACY_LEDGER_PATH)[0].scope).toBe('lead');
  });
  it('holds legacy enquiries until classification review and refuses dispatch when the ledger is corrupt',async()=>{
    await db.run("INSERT INTO leads(email,lead_type,created_at) VALUES('unreviewed@example.invalid','agent_advisory',date('now','-6 years'))");
    expect((await cleanupLeads(db)).purgedAdvisory).toBe(0);
    await enqueueEmail({recipient:'blocked@example.invalid',subject:'blocked',emailType:'newsletter_digest'},db);
    fs.writeFileSync(process.env.PRIVACY_LEDGER_PATH,'corrupt');
    const send=vi.fn(accepted);await expect(processOutboxBatch({conn:db,sendEmailFn:send})).rejects.toThrow();expect(send).not.toHaveBeenCalled();
  });
});
