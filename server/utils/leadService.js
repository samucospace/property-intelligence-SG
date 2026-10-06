import crypto from 'node:crypto';
import { createConnection, withTransaction } from '../db.js';
import { enqueueEmail, generateIdempotencyKey } from './emailQueue.js';
import { isEmailSuppressed, hashEmail } from './suppression.js';
import { escapeHtml } from './security.js';

export async function submitLead(body) {
  const db = createConnection();
  try {
    return await withTransaction(db, async () => {
      const email = body.email.trim().toLowerCase();
      if (await isEmailSuppressed(email, db)) return { status:409, error:'This address is suppressed. Please contact support.' };
      const from = process.env.SENDER_EMAIL || 'Singapore Home Intel <digest@homeintel.sg>';
      const baseUrl = process.env.BASE_URL || 'https://homeintel.sg';
      if (body.leadType === 'newsletter') {
        const existing = await db.get(`SELECT *, (strftime('%s','now')-strftime('%s',last_confirmation_requested_at)) AS elapsed FROM leads WHERE email=? AND lead_type='newsletter'`,[email]);
        if (existing?.elapsed < 300 && existing?.confirmation_token) {
          const queued = await db.get(`SELECT status FROM email_outbox WHERE lead_id=? AND email_type='newsletter_confirmation' ORDER BY created_at DESC,rowid DESC LIMIT 1`,[existing.lead_id]);
          if (queued && ['pending','claimed','failed'].includes(queued.status)) return { status:202, message:'Your confirmation email is queued. Delivery may take a few minutes.' };
          if (queued?.status==='accepted') return { status:200, message:'The provider accepted your confirmation email recently. Please check your inbox.' };
        }
        const token = crypto.randomBytes(24).toString('hex');
        await db.run(`INSERT INTO leads(name,email,lead_type,pdpa_consent,consent_version,consent_at,confirmation_token,confirmation_token_expires_at,last_confirmation_requested_at)
          VALUES(?,?,'newsletter',1,'2026-10-06-v2',CURRENT_TIMESTAMP,?,datetime('now','+24 hours'),CURRENT_TIMESTAMP)
          ON CONFLICT(email) WHERE lead_type='newsletter' DO UPDATE SET confirmation_token=excluded.confirmation_token,
          confirmation_token_expires_at=excluded.confirmation_token_expires_at,last_confirmation_requested_at=CURRENT_TIMESTAMP,
          pdpa_consent=1,consent_version=excluded.consent_version,consent_at=CURRENT_TIMESTAMP`,[body.name?.trim() || null,email,token]);
        const lead = await db.get("SELECT lead_id FROM leads WHERE email=? AND lead_type='newsletter'",[email]);
        const url = `${baseUrl}/api/newsletter/confirm?email=${encodeURIComponent(email)}&token=${token}`;
        await enqueueEmail({ recipient:email,subject:'Confirm your subscription - Singapore Home Intel',emailType:'newsletter_confirmation',leadId:lead.lead_id,
          idempotencyKey:generateIdempotencyKey(email,'newsletter_confirmation',token),
          payload:{from,confirmationToken:token,html:`<h2>Confirm your subscription</h2><p>Click below, then confirm on the page. This link expires in 24 hours.</p><a href="${escapeHtml(url)}">Review and confirm subscription</a>`} },db);
        await db.run('INSERT INTO consent_events(event_id,email_hash,action,consent_version) VALUES(?,?,?,?)',[crypto.randomUUID(),hashEmail(email),'requested','2026-10-06-v2']);
        return {status:202,message:'Your confirmation email is queued. Please confirm when it arrives.'};
      }
      const recipient = process.env.AGENT_NOTIFICATION_EMAIL || process.env.AGENT_EMAIL;
      if (!recipient) return {status:503,error:'Advisory enquiries are temporarily unavailable.'};
      if (await isEmailSuppressed(recipient,db)) return {status:503,error:'Advisory enquiries are temporarily unavailable.'};
      const context = body.requestId || crypto.createHash('sha256').update(JSON.stringify([email,body.phone,body.enquiryType,body.projectInterest,body.details,new Date().toISOString().slice(0,10)])).digest('hex');
      const key = generateIdempotencyKey(email,'agent_lead_notification',context);
      const duplicate = await db.get('SELECT id FROM email_outbox WHERE idempotency_key=?',[key]);
      if (duplicate) return {status:202,message:'Your enquiry is already recorded for advisory review.'};
      const inserted = await db.run(`INSERT INTO leads(name,email,phone,lead_type,enquiry_type,project_interest,pdpa_consent,consent_version,consent_at,details,is_converted,retention_reviewed_at)
        VALUES(?,?,?,'agent_advisory',?,?,1,'2026-10-06-v2',CURRENT_TIMESTAMP,?,0,CURRENT_TIMESTAMP)`,
        [body.name?.trim() || null,email,body.phone.trim(),body.enquiryType || 'General Enquiry',body.projectInterest || null,body.details || null]);
      await enqueueEmail({recipient,subject:'New advisory enquiry',emailType:'agent_lead_notification',leadId:inserted.lastID,idempotencyKey:key,
        payload:{from,html:`<h2>New advisory enquiry</h2>${['name','email','phone','enquiryType','projectInterest','details'].map(field=>`<p>${field}: ${escapeHtml(body[field] || '')}</p>`).join('')}`}},db);
      await db.run('INSERT INTO consent_events(event_id,email_hash,action,consent_version) VALUES(?,?,?,?)',[crypto.randomUUID(),hashEmail(email),'advisory_requested','2026-10-06-v2']);
      return {status:202,message:'Your enquiry is recorded and queued for advisory review.'};
    });
  } finally { await db.close(); }
}

export async function confirmLead(email,token) {
  const db=createConnection();
  try {
    return await withTransaction(db,async () => {
      if (await isEmailSuppressed(email,db)) return {status:409};
      const result=await db.run(`UPDATE leads SET confirmed_at=CURRENT_TIMESTAMP,unsubscribed_at=NULL,
        confirmation_token=NULL,confirmation_token_expires_at=NULL,consent_version='2026-10-06-v2',is_quarantined=0,quarantined_reason=NULL
        WHERE email=? AND lead_type='newsletter' AND confirmation_token=? AND confirmation_token_expires_at IS NOT NULL
        AND datetime('now')<datetime(confirmation_token_expires_at)`,[email,token]);
      if (!result.changes) return {status:403};
      await db.run('INSERT INTO consent_events(event_id,email_hash,action,consent_version) VALUES(?,?,?,?)',[crypto.randomUUID(),hashEmail(email),'confirmed','2026-10-06-v2']);
      return {status:200};
    });
  } finally { await db.close(); }
}
