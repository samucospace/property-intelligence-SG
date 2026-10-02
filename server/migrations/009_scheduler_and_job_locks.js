/**
 * Migration 009: Scheduler & Distributed Job Locks
 * Adds job_locks table for lease-based concurrency control
 * and job_history table for auditing execution and last-success tracking.
 */

export const name = '009_scheduler_and_job_locks';

export async function up(conn) {
  const run = conn.run.bind(conn);

  await run(`
    CREATE TABLE IF NOT EXISTS job_locks (
      job_name TEXT PRIMARY KEY,
      locked_at DATETIME NOT NULL,
      locked_by TEXT NOT NULL,
      run_id TEXT NOT NULL,
      lease_expires_at DATETIME NOT NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS job_history (
      run_id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      status TEXT NOT NULL,
      items_processed INTEGER DEFAULT 0,
      error_message TEXT
    );
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_job_history_name_started 
    ON job_history(job_name, started_at DESC);
  `);
}
