import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs pending schema migrations in sorted order.
 * Tracks applied migrations in the schema_migrations table.
 * Uses an advisory schema_lock table to serialize concurrent worker processes.
 * @param {object} conn Database connection object with run, all, and get methods
 */
export async function runMigrations(conn) {
  const run = conn?.run ? conn.run.bind(conn) : null;
  const all = conn?.all ? conn.all.bind(conn) : null;
  const get = conn?.get ? conn.get.bind(conn) : null;

  if (!run || !all) {
    throw new Error('Valid database connection with run and all methods required for migrations');
  }

  // 1. Ensure migrations tracking table exists
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Ensure migration lock table exists for multi-process mutual exclusion
  await run(`
    CREATE TABLE IF NOT EXISTS schema_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      locked_by TEXT NOT NULL,
      locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Acquire exclusive migration lock with polling and stale lock recovery
  const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  let hasLock = false;
  const timeoutMs = 25000;
  const startTime = Date.now();

  while (!hasLock && (Date.now() - startTime < timeoutMs)) {
    try {
      await run(`INSERT INTO schema_lock (id, locked_by, locked_at) VALUES (1, ?, CURRENT_TIMESTAMP)`, [lockId]);
      hasLock = true;
    } catch {
      if (get) {
        const lockRow = await get(`SELECT locked_by, (strftime('%s', 'now') - strftime('%s', locked_at)) as age_sec FROM schema_lock WHERE id = 1`).catch(() => null);
        if (lockRow && lockRow.age_sec > 45) {
          console.warn(`[Migrations] Breaking stale lock held by ${lockRow.locked_by} (${lockRow.age_sec}s old)`);
          await run(`DELETE FROM schema_lock WHERE id = 1`).catch(() => {});
          continue;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  if (!hasLock) {
    throw new Error(`[Migrations] Timed out waiting for schema_lock after ${timeoutMs}ms`);
  }

  try {
    // 4. Query already applied migrations under lock
    const appliedRows = await all(`SELECT name FROM schema_migrations`);
    const appliedSet = new Set(appliedRows.map(r => r.name));

    // 5. Find and sort all migration files
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.js') && f !== 'index.js')
      .sort();

    for (const file of files) {
      const migrationName = path.basename(file, '.js');
      if (!appliedSet.has(migrationName)) {
        console.log(`[Migrations] Applying ${migrationName}...`);
        const migrationPath = path.join(__dirname, file);
        // Windows ESM file URL requires forward slashes
        const fileUrl = `file://${migrationPath.replace(/\\/g, '/')}`;
        const migration = await import(fileUrl);

        if (typeof migration.up !== 'function') {
          throw new Error(`Migration ${file} does not export an up() function`);
        }

        await migration.up(conn);
        await run(`INSERT INTO schema_migrations (name) VALUES (?)`, [migrationName]);
        console.log(`[Migrations] Successfully applied ${migrationName}`);
      }
    }
  } finally {
    // 6. Release exclusive migration lock
    if (hasLock) {
      await run(`DELETE FROM schema_lock WHERE id = 1 AND locked_by = ?`, [lockId]).catch(() => {});
    }
  }
}
