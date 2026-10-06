import fs from 'node:fs';
import { ledgerPath, readPrivacyLedger } from './privacyLedger.js';
import { releaseFeatures } from './releasePolicy.js';

export function assertProductionCollection() {
  try {
  if (process.env.NODE_ENV!=='production' || !releaseFeatures().leadCapture) return;
  for (const name of ['ADMIN_OPERATOR','ADMIN_GATEWAY_SECRET','PRIVACY_APPROVAL_REFERENCE','ADVISORY_PARTNER_NAME','ADVISORY_PARTNER_CEA_REGISTRATION','AGENT_NOTIFICATION_EMAIL',
    'RESEND_API_KEY','SENDER_EMAIL','NEWSLETTER_FROM_EMAIL','UNSUBSCRIBE_SECRET','BASE_URL','RESEND_WEBHOOK_SECRET','OFFSITE_BACKUP_BUCKET',
    'PRIVACY_LEDGER_REPLICA_PATH','HOSTING_PROCESSOR_NAME','BACKUP_PROCESSOR_NAME']) if (!process.env[name]) throw new Error(`Full production release requires ${name}`);
  if (!releaseFeatures().outboundEmail || process.env.MOCK_EMAIL==='true' || process.env.RESEND_API_KEY.startsWith('re_mock')) throw new Error('Full production release requires enabled live email');
  if (process.env.ADMIN_GATEWAY_SECRET.length<32 || process.env.UNSUBSCRIBE_SECRET.length<32) throw new Error('Production secrets must have at least 32 characters');
  if (!process.env.BACKUP_KEY_FILE && !process.env.BACKUP_ENCRYPTION_KEY) throw new Error('Encrypted backups required');
  if (!/^https:\/\//.test(process.env.BASE_URL)) throw new Error('Production BASE_URL must use HTTPS');
  if (!fs.existsSync(ledgerPath())) throw new Error('Provision and reconcile privacy ledger before enabling collection');
  if (releaseFeatures().leadCleanup && !process.env.RETENTION_REVIEW_REFERENCE) throw new Error('RETENTION_REVIEW_REFERENCE required before enabling cleanup');
  const entries=readPrivacyLedger(ledgerPath());
  const replicated=new Set(readPrivacyLedger(process.env.PRIVACY_LEDGER_REPLICA_PATH).map(entry=>entry.event_id));
  if (entries.some(entry=>!replicated.has(entry.event_id))) throw new Error('Privacy ledger replica is behind; reconcile before collecting personal data');
  } catch(error) {error.status=503;throw error;}
}
