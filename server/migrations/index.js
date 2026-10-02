import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const directory = path.dirname(fileURLToPath(import.meta.url));
// SQLite owns serialization and rolls back changes/version records on process loss.
export async function runMigrations(conn) {
  if (!conn?.run || !conn?.all) throw new Error('Valid migration connection required');
  await conn.run('PRAGMA foreign_keys = OFF');
  let begun = false;
  try {
    await conn.run('BEGIN IMMEDIATE');
    begun = true;
    await conn.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    const applied = new Set((await conn.all('SELECT name FROM schema_migrations')).map(r => r.name));
    for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.js') && f !== 'index.js').sort()) {
      const name = path.basename(file, '.js');
      if (applied.has(name)) continue;
      const migration = await import(pathToFileURL(path.join(directory, file)).href);
      if (typeof migration.up !== 'function') throw new Error('Migration has no up(): ' + name);
      await migration.up(conn);
      await conn.run('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
    }
    if ((await conn.all('PRAGMA foreign_key_check')).length) throw new Error('Migration foreign-key check failed');
    await conn.run('COMMIT');
    begun = false;
  } catch (error) {
    if (begun) await conn.run('ROLLBACK').catch(() => {});
    throw error;
  } finally { await conn.run('PRAGMA foreign_keys = ON'); }
}
