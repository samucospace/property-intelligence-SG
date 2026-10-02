import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createConnection, withTransaction } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { openReadonly, databaseMetrics } from '../utils/databaseArtifacts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const marketTables = ['projects', 'property_transactions', 'rental_transactions', 'project_benchmarks', 'amenities', 'sora_rates', 'seed_versions'];

// Build a fresh file from allowlisted public-market tables. No production lead,
// consent, suppression, token or job-log bytes are copied into the staging file.
export async function prepareStaging({ sourcePath, targetPath }) {
  sourcePath = path.resolve(sourcePath);
  targetPath = path.resolve(targetPath);
  if (sourcePath === targetPath || fs.existsSync(targetPath) || fs.existsSync(`${targetPath}-wal`) || fs.existsSync(`${targetPath}-shm`)) {
    throw new Error('Staging target must be a new file distinct from its source');
  }
  const source = openReadonly(sourcePath);
  const target = createConnection(targetPath, { uri: true });
  try {
    await runMigrations(target);
    await target.run('ATTACH DATABASE ? AS source', [`${pathToFileURL(sourcePath).href}?mode=ro`]);
    await withTransaction(target, async () => {
      for (const table of marketTables) {
        if (!await source.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])) continue;
        const sourceColumns = new Set((await source.all(`PRAGMA table_info(${table})`)).map(c => c.name));
        const columns = (await target.all(`PRAGMA table_info(${table})`)).map(c => c.name).filter(c => sourceColumns.has(c));
        const columnSql = columns.map(c => `"${c}"`).join(',');
        await target.run(`INSERT INTO main.${table} (${columnSql}) SELECT ${columnSql} FROM source.${table}`);
      }
      await target.run("INSERT INTO leads (name,email,phone,lead_type,pdpa_consent,details,confirmation_token) VALUES ('Synthetic Newsletter','newsletter@example.invalid',NULL,'newsletter',1,'Synthetic staging fixture',NULL),('Synthetic Advisory','advisory@example.invalid','00000000','agent_advisory',1,'Synthetic staging fixture',NULL)");
      await target.run('CREATE TABLE environment_metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await target.run("INSERT INTO environment_metadata VALUES ('environment','staging')");
    });
    await target.run('DETACH DATABASE source');
    // Reconcile legacy source identities on the disposable target, not its source.
    await target.run("DELETE FROM schema_migrations WHERE name='010_reconcile_duplicate_projects'");
    await runMigrations(target);
    await target.run('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { await target.close(); await source.close(); }
  const metrics = await databaseMetrics(targetPath);
  return { targetPath, sourcePersonalDataCopied: false, syntheticLeads: 2, ...metrics };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  prepareStaging({ sourcePath: arg('source') || path.join(root, 'server/property.db'), targetPath: arg('target') || path.join(root, `server/staging-${Date.now()}.db`) })
    .then(result => console.log(JSON.stringify(result, null, 2))).catch(err => { console.error(err.message); process.exitCode = 1; });
}
