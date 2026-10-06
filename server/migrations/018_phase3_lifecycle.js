export async function up(conn) {
  await conn.run(`ALTER TABLE leads ADD COLUMN retention_reviewed_at TEXT`);
  await conn.run(`ALTER TABLE leads ADD COLUMN last_confirmation_requested_at TEXT`);
  await conn.run(`ALTER TABLE email_outbox ADD COLUMN lead_id INTEGER`);
  await conn.run(`ALTER TABLE email_outbox ADD COLUMN lease_token TEXT`);
  await conn.run(`ALTER TABLE email_outbox ADD COLUMN lease_expires_at TEXT`);
  await conn.run(`ALTER TABLE email_outbox ADD COLUMN first_dispatch_at TEXT`);
  await conn.run(`CREATE TABLE consent_events (
    event_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, action TEXT NOT NULL,
    consent_version TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await conn.run(`CREATE TABLE email_provider_events(event_id TEXT PRIMARY KEY,provider_message_id TEXT,event_type TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  // Old tokens have no defensible expiry/provenance. Require a fresh opt-in.
  await conn.run(`UPDATE leads SET confirmation_token=NULL WHERE confirmation_token_expires_at IS NULL`);
  await conn.run(`UPDATE leads SET is_quarantined=1,
    quarantined_reason='Legacy consent requires fresh verified opt-in'
    WHERE lead_type='newsletter' AND confirmed_at IS NOT NULL`);
  await conn.run(`UPDATE email_outbox SET status='suppressed', payload_json='{}',
    last_error='Legacy outbox requires reviewed requeue' WHERE status IN ('pending','failed','claimed')`);
}
