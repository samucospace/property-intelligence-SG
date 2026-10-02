import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baselinePath = path.resolve(__dirname, '../backups/baseline-authoritative-20261002.db');
const stagingDbPath = path.resolve(__dirname, '../staging-property.db');

async function main() {
  console.log('===========================================================');
  console.log(' Preparing Sanitized Staging Database (staging-property.db)');
  console.log('===========================================================\n');

  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Baseline database not found at ${baselinePath}. Run baseline drill first.`);
  }

  // Copy baseline snapshot to staging
  console.log(`Copying verified baseline into staging target: ${stagingDbPath}...`);
  fs.copyFileSync(baselinePath, stagingDbPath);

  const db = new sqlite3.Database(stagingDbPath);
  try {
    console.log('Sanitizing customer PII in leads table...');
    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE leads SET
          name = 'Staging Test User ' || lead_id,
          email = 'test_user_' || lead_id || '@staging.homeintel.local',
          phone = '+6590000000',
          details = 'Sanitized test lead details'
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('Verifying staging database integrity...');
    const integrityRow = await new Promise((resolve, reject) => {
      db.get('PRAGMA integrity_check;', (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const leadCount = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM leads;', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });

    const projectCount = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM projects;', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });

    console.log(`✓ Staging Integrity Check: ${integrityRow.integrity_check}`);
    console.log(`✓ Total Projects: ${projectCount}`);
    console.log(`✓ Sanitized Leads: ${leadCount}`);
    console.log('\nStaging database is ready and sanitized for isolated testing.');
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('Error preparing staging database:', err);
  process.exit(1);
});
