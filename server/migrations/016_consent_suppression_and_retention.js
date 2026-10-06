/**
 * Migration 016: Consent suppression ledger, expiring confirmation tokens,
 * legacy subscriber quarantine, and converted lead retention (GL-10).
 */
export async function up(conn) {
  const run = conn.run ? conn.run.bind(conn) : conn;
  const all = conn.all ? conn.all.bind(conn) : conn;

  // 1. Create durable email suppression ledger
  await run(`
    CREATE TABLE IF NOT EXISTS email_suppression (
      email_hash TEXT PRIMARY KEY,
      masked_email TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('unsubscribed', 'bounced', 'complaint', 'erased', 'manual')),
      suppressed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source_version TEXT NOT NULL DEFAULT 'v1.0'
    )
  `);

  // 2. Add expiring confirmation tokens and quarantine flags to leads table
  const cols = await all(`PRAGMA table_info(leads)`);
  const colNames = new Set(cols.map(c => c.name));

  if (!colNames.has('confirmation_token_expires_at')) {
    await run(`ALTER TABLE leads ADD COLUMN confirmation_token_expires_at DATETIME`);
  }
  if (!colNames.has('is_quarantined')) {
    await run(`ALTER TABLE leads ADD COLUMN is_quarantined INTEGER DEFAULT 0`);
  }
  if (!colNames.has('quarantined_reason')) {
    await run(`ALTER TABLE leads ADD COLUMN quarantined_reason TEXT`);
  }
  if (!colNames.has('is_converted')) {
    await run(`ALTER TABLE leads ADD COLUMN is_converted INTEGER DEFAULT 0`);
  }
  if (!colNames.has('converted_at')) {
    await run(`ALTER TABLE leads ADD COLUMN converted_at DATETIME`);
  }

  // 3. Populate suppression ledger from any existing unsubscribed leads or anonymized hashes
  const unsubscribedLeads = await all(`
    SELECT email FROM leads WHERE unsubscribed_at IS NOT NULL
  `);
  for (const row of unsubscribedLeads) {
    if (row.email && !row.email.startsWith('HASH:')) {
      const clean = row.email.trim().toLowerCase();
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(clean).digest('hex');
      const parts = clean.split('@');
      const masked = parts[0].length > 2 
        ? `${parts[0].slice(0, 2)}***@${parts[1]}`
        : `*@${parts[1] || 'domain.com'}`;
      await run(`
        INSERT OR IGNORE INTO email_suppression (email_hash, masked_email, reason, source_version)
        VALUES (?, ?, 'unsubscribed', 'migration-016')
      `, [hash, masked]);
    } else if (row.email && row.email.startsWith('HASH:')) {
      const hash = row.email.slice(5);
      await run(`
        INSERT OR IGNORE INTO email_suppression (email_hash, masked_email, reason, source_version)
        VALUES (?, 'anonymized@erased.invalid', 'erased', 'migration-016')
      `, [hash]);
    }
  }

  // 4. Quarantine unverified legacy newsletter leads that were pre-confirmed without double opt-in
  await run(`
    UPDATE leads
    SET is_quarantined = 1,
        quarantined_reason = 'Legacy pre-confirmation lacking auditable double opt-in verification token'
    WHERE lead_type = 'newsletter'
      AND confirmed_at IS NOT NULL
      AND confirmed_at = created_at
      AND confirmation_token IS NULL
      AND is_quarantined = 0
  `);
}
