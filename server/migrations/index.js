import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs pending schema migrations in sorted order.
 * Tracks applied migrations in the schema_migrations table.
 * @param {object} conn Database connection object with run and all methods
 */
export async function runMigrations(conn) {
  const run = conn?.run ? conn.run.bind(conn) : null;
  const all = conn?.all ? conn.all.bind(conn) : null;

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

  // 2. Query already applied migrations
  const appliedRows = await all(`SELECT name FROM schema_migrations`);
  const appliedSet = new Set(appliedRows.map(r => r.name));

  // 3. Find and sort all migration files
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
}
