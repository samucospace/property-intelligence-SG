/**
 * Migration 007: Leads enhancements for double opt-in, PDPA consent tracking, and duplicate prevention.
 */
export async function up({ run, all }) {
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
    await run(`ALTER TABLE leads ADD COLUMN consent_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
  }

  // Pre-confirm existing newsletter leads prior to this migration
  await run(`UPDATE leads SET confirmed_at = created_at WHERE confirmed_at IS NULL AND lead_type = 'newsletter'`);

  // Ensure unique index on newsletter email to prevent duplicate subscribers
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_newsletter_email ON leads(email) WHERE lead_type = 'newsletter'`);
}
