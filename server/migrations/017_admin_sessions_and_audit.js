/**
 * Migration 017: Admin session audit logging and token revocation ledger (GL-13).
 */
export async function up(conn) {
  const run = conn.run ? conn.run.bind(conn) : conn;

  await run(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      ip_address TEXT,
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS admin_revoked_tokens (
      token_hash TEXT PRIMARY KEY,
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT
    )
  `);
}
