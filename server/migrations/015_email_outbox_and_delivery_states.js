/**
 * Migration 015: Email outbox and durable delivery states (GL-09).
 * Provides transactional outbox queue, atomic worker lease claims,
 * and delivery state tracking.
 */
export async function up(conn) {
  const run = conn.run ? conn.run.bind(conn) : conn;

  await run(`
    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      email_type TEXT NOT NULL CHECK(email_type IN ('newsletter_confirmation', 'newsletter_digest', 'agent_lead_notification')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'accepted', 'failed', 'suppressed', 'permanent_failed')),
      idempotency_key TEXT UNIQUE NOT NULL,
      provider_message_id TEXT,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      next_retry_at DATETIME,
      claimed_by TEXT,
      claimed_at DATETIME,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_email_outbox_dispatch 
      ON email_outbox(status, next_retry_at) 
      WHERE status IN ('pending', 'failed')
  `);
}
