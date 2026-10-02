export async function up(conn) {
  await conn.run(`CREATE TABLE IF NOT EXISTS job_slots (
    job_name TEXT NOT NULL, slot_key TEXT NOT NULL, run_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(job_name, slot_key))`);
}
