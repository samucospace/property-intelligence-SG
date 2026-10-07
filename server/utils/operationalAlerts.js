import crypto from 'node:crypto';
import {createConnection,withTransaction} from '../db.js';
import {operationalStatus} from './operationalStatus.js';
let emergencyUntil=0;

export async function sendOperationalAlert(payload,{idempotencyKey}={}) {
  if(['test','staging'].includes(process.env.NODE_ENV) || process.env.MOCK_OPERATIONS_ALERTS==='true') return {mocked:true,accepted:false};
  if(process.env.ENABLE_OPERATIONS_MONITORING!=='true') throw new Error('Operational monitoring is disabled');
  const transport=process.env.OPERATIONS_ALERT_TRANSPORT || 'webhook';
  let target,body,headers={'Content-Type':'application/json'};
  if(idempotencyKey) headers['Idempotency-Key']=idempotencyKey;
  if(transport==='email') {
    const key=process.env.OPERATIONS_RESEND_API_KEY;
    const from=process.env.OPERATIONS_ALERT_EMAIL_FROM,to=process.env.OPERATIONS_ALERT_EMAIL_TO;
    const mailbox=/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
    if(process.env.NODE_ENV!=='production' || !key?.startsWith('re_') || key.startsWith('re_mock') || !mailbox.test(from || '') || !mailbox.test(to || '')) throw new Error('Operational email transport is not configured');
    // A fixed operator recipient and separate key; this never enables lead/newsletter email.
    target='https://api.resend.com/emails';headers.Authorization=`Bearer ${key}`;
    body={from,to:[to],subject:`HomeIntel operations: ${payload.event} (${payload.severity || 'warning'})`,
      text:`${payload.summary}\n\nIssue: ${payload.key}\nState: ${payload.event}\n\nInspect the server operational logs and job history.`};
  } else if(transport==='webhook') {
    target=process.env.OPERATIONS_ALERT_WEBHOOK_URL;
    if(!target?.startsWith('https://')) throw new Error('Operational webhook transport is not configured');
    body={text:`${payload.event}: ${payload.summary}`,issue:payload};
  } else throw new Error('Unknown operational alert transport');
  const response=await fetch(target,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  if(!response.ok) throw new Error(`Operational alert rejected: HTTP ${response.status}`);
  if(transport==='email') {
    const receipt=await response.json();
    if(typeof receipt.id!=='string' || !receipt.id) throw new Error('Operational email did not receive a provider message ID');
    return {accepted:true,providerMessageId:receipt.id};
  }
  return {accepted:true};
}

export async function runOperationsMonitor({conn=null,sendAlertFn=sendOperationalAlert,statusOptions={}}={}) {
  const db=conn || createConnection();
  try {
    const state=await operationalStatus(db,statusOptions);
    await withTransaction(db,async()=>{
      const existing=await db.all('SELECT * FROM operational_issues');
      const current=new Map(state.issues.map(issue=>[issue.key,issue]));
      for(const key of new Set([...existing.map(issue=>issue.issue_key),...current.keys()])) {
        const prior=existing.find(issue=>issue.issue_key===key),issue=current.get(key),isOpen=!!issue;
        if(prior && !!prior.is_open===isOpen) continue;
        const summary=issue?.summary || prior.summary,severity=issue?.severity || prior.severity;
        await db.run(`INSERT INTO operational_issues(issue_key,is_open,summary,severity) VALUES(?,?,?,?)
          ON CONFLICT(issue_key) DO UPDATE SET is_open=excluded.is_open,summary=excluded.summary,severity=excluded.severity,updated_at=CURRENT_TIMESTAMP`,[key,Number(isOpen),summary,severity]);
        const id=crypto.randomUUID(),event=isOpen?'raised':'resolved';
        await db.run('INSERT INTO operational_alerts(alert_id,issue_key,event_type,payload_json) VALUES(?,?,?,?)',[id,key,event,JSON.stringify({key,event,summary,severity})]);
      }
    });
    const alerts=await withTransaction(db,async()=>{
      await db.run("UPDATE operational_alerts SET status='failed',lease_token=NULL WHERE status='claimed' AND lease_expires_at<=datetime('now')");
      const rows=await db.all("SELECT * FROM operational_alerts WHERE status IN ('pending','failed') AND attempts<5 AND (next_retry_at IS NULL OR next_retry_at<=datetime('now')) ORDER BY created_at LIMIT 10");
      for(const row of rows) {row.lease_token=crypto.randomUUID();await db.run("UPDATE operational_alerts SET status='claimed',lease_token=?,lease_expires_at=datetime('now','+2 minutes') WHERE alert_id=?",[row.lease_token,row.alert_id]);}
      return rows;
    });
    let accepted=0,failed=0,mocked=0;
    for(const alert of alerts) {
      try {
        const result=await sendAlertFn(JSON.parse(alert.payload_json),{idempotencyKey:alert.alert_id});
        if(result.mocked) {mocked++;await db.run("UPDATE operational_alerts SET status='pending',lease_token=NULL,next_retry_at=datetime('now','+5 minutes') WHERE alert_id=? AND lease_token=?",[alert.alert_id,alert.lease_token]);continue;}
        if(!result.accepted) throw new Error('Alert did not receive transport acceptance');
        await db.run("UPDATE operational_alerts SET status='accepted',accepted_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_expires_at=NULL WHERE alert_id=? AND lease_token=?",[alert.alert_id,alert.lease_token]);accepted++;
      } catch {
        await db.run("UPDATE operational_alerts SET status='failed',attempts=attempts+1,last_error='Alert delivery failed; inspect transport configuration',next_retry_at=datetime('now','+' || ? || ' minutes') WHERE alert_id=? AND lease_token=?",[Math.min(60,2**(alert.attempts+1)),alert.alert_id,alert.lease_token]);failed++;
      }
    }
    const exhausted=(await db.get("SELECT count(*) AS n FROM operational_alerts WHERE status='failed' AND attempts>=5")).n;
    return {issues:state.issues.length,accepted,failed,mocked,exhausted,status:failed || exhausted?'partial_success':mocked?'skipped':'success'};
  } catch {
    // Disk/database failure must not depend on writing another SQLite row.
    const payload={key:'monitor-unavailable',event:'raised',severity:'critical',summary:'Operational monitoring cannot access or persist its state; inspect database and disk'};
    if(Date.now()<emergencyUntil) return {status:'partial_success',emergency:true,throttled:true};
    emergencyUntil=Date.now()+900000;
    try {
      const result=await sendAlertFn(payload,{idempotencyKey:'monitor-unavailable-'+Math.floor(Date.now()/900000)});
      return {status:result.mocked?'skipped':'partial_success',emergency:true,accepted:result.accepted?1:0,mocked:result.mocked?1:0};
    } catch {return {status:'partial_success',emergency:true,accepted:0,failed:1};}
  } finally {if(!conn) await db.close();}
}
