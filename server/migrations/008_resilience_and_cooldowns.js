/**
 * Migration 008: Resilience & abuse prevention timestamps for leads.
 * Adds last_confirmation_sent_at for email bombing cooldown and
 * last_newsletter_sent_at for idempotency and send-state tracking.
 */
export async function up(conn) {
  const run = conn.run ? conn.run.bind(conn) : conn;
  const all = conn.all ? conn.all.bind(conn) : conn;

  const cols = await all(`PRAGMA table_info(leads)`);
  const colNames = new Set(cols.map(c => c.name));

  if (!colNames.has('last_confirmation_sent_at')) {
    await run(`ALTER TABLE leads ADD COLUMN last_confirmation_sent_at DATETIME`);
  }

  if (!colNames.has('last_newsletter_sent_at')) {
    await run(`ALTER TABLE leads ADD COLUMN last_newsletter_sent_at DATETIME`);
  }
}
