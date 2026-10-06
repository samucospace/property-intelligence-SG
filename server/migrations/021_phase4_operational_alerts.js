export async function up(conn) {
  await conn.run(`CREATE TABLE operational_issues(issue_key TEXT PRIMARY KEY,is_open INTEGER NOT NULL,summary TEXT NOT NULL,severity TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await conn.run(`CREATE TABLE operational_alerts(alert_id TEXT PRIMARY KEY,issue_key TEXT NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT,lease_token TEXT,lease_expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,accepted_at TEXT,last_error TEXT)`);
  await conn.run(`CREATE INDEX idx_operational_alerts_due ON operational_alerts(status,next_retry_at)`);
}
