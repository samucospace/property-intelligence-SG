/**
 * Migration 007: Leads enhancements for double opt-in, PDPA consent tracking, and duplicate prevention.
 */
export async function up(conn) {
  const run = conn.run ? conn.run.bind(conn) : conn;
  const all = conn.all ? conn.all.bind(conn) : conn;

  const cols = await all(`PRAGMA table_info(leads)`);
  const colNames = new Set(cols.map(c => c.name));

  if (!colNames.has('confirmed_at')) {
    await run(`ALTER TABLE leads ADD COLUMN confirmed_at DATETIME`);
  }
  if (!colNames.has('confirmation_token')) {
    await run(`ALTER TABLE leads ADD COLUMN confirmation_token TEXT`);
  }
  if (!colNames.has('consent_version')) {
    await run(`ALTER TABLE leads ADD COLUMN consent_version TEXT DEFAULT 'v1.0'`);
  }
  if (!colNames.has('consent_at')) {
    // SQLite cannot add column with non-constant default (CURRENT_TIMESTAMP) to tables with existing rows
    await run(`ALTER TABLE leads ADD COLUMN consent_at DATETIME`);
    await run(`UPDATE leads SET consent_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE consent_at IS NULL`);
  }

  // Pre-confirm existing newsletter leads prior to this migration
  await run(`UPDATE leads SET confirmed_at = created_at WHERE confirmed_at IS NULL AND lead_type = 'newsletter'`);

  // Deduplicate existing newsletter leads before creating unique index (keep the latest row by lead_id)
  await run(`
    DELETE FROM leads
    WHERE lead_type = 'newsletter'
      AND lead_id NOT IN (
        SELECT MAX(lead_id)
        FROM leads
        WHERE lead_type = 'newsletter'
        GROUP BY LOWER(email)
      )
  `);

  // Ensure unique index on newsletter email to prevent duplicate subscribers
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_newsletter_email ON leads(email) WHERE lead_type = 'newsletter'`);
}
