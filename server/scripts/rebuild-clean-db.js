import '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { fetchUraData } from '../ingestion.js';
import { seedAmenities } from '../livabilityEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const liveDbPath = path.join(__dirname, '../property.db');
const rebuildDbPath = path.join(__dirname, '../property.db.rebuild');

async function rebuild() {
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    console.error('\n[Error] URA_ACCESS_KEY is not defined in server/.env');
    console.error('Please add your registered URA Data Service key to server/.env:');
    console.error('  URA_ACCESS_KEY=your_access_key_here\n');
    process.exit(1);
  }

  console.log('====================================================');
  console.log(' Singapore Home Intel - Clean Database Rebuild (Plan 2.7)');
  console.log('====================================================\n');

  // Step 1: Backup existing leads table from live database
  let savedLeads = [];
  if (fs.existsSync(liveDbPath)) {
    console.log('[Step 1/6] Preserving existing leads from current property.db...');
    const liveConn = createConnection(liveDbPath);
    try {
      const hasLeads = await liveConn.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='leads'`);
      if (hasLeads) {
        savedLeads = await liveConn.all(`SELECT * FROM leads`);
        console.log(`Saved ${savedLeads.length} lead records for restoration.`);
      }
    } catch (err) {
      console.warn('Could not read leads from existing DB:', err.message);
    } finally {
      await liveConn.close();
    }
  }

  // Step 2: Initialize fresh database file
  console.log('\n[Step 2/6] Initializing clean rebuild database...');
  if (fs.existsSync(rebuildDbPath)) {
    fs.unlinkSync(rebuildDbPath);
  }
  const rebuildConn = createConnection(rebuildDbPath);

  try {
    // Step 3: Run all versioned migrations (001 through 007)
    console.log('\n[Step 3/6] Applying all schema migrations (001 - 007)...');
    await runMigrations(rebuildConn);
    console.log('Schema migrations successfully applied to clean database.');

    // Step 4: Restore preserved leads
    if (savedLeads.length > 0) {
      console.log(`\n[Step 4/6] Restoring ${savedLeads.length} leads...`);
      for (const l of savedLeads) {
        await rebuildConn.run(
          `INSERT INTO leads (lead_id, name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, consent_version, consent_at, confirmed_at, confirmation_token, details, unsubscribed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [l.lead_id, l.name, l.email, l.phone, l.lead_type, l.enquiry_type, l.project_interest, l.pdpa_consent, l.consent_version, l.consent_at, l.confirmed_at, l.confirmation_token, l.details, l.unsubscribed_at, l.created_at]
        );
      }
      console.log('Leads restored cleanly.');
    } else {
      console.log('\n[Step 4/6] No existing leads to restore.');
    }

    // Step 5: Ingest fresh official URA Caveat and Rental data
    console.log('\n[Step 5/6] Executing full URA live ingestion into clean database...');
    // Point DB_PATH so internal helpers connect to rebuildDbPath
    process.env.DB_PATH = rebuildDbPath;
    const ingestResult = await fetchUraData(accessKey);
    console.log('URA Ingestion Result:', ingestResult);

    if (ingestResult.status === 'failed') {
      throw new Error('Full URA sync failed during clean rebuild.');
    }

    // Step 6: Post-rebuild validation queries (Plan 2.7)
    console.log('\n[Step 6/6] Executing Plan 2.7 Data Validation Checks...');

    // Validation 1: Postal districts
    const invalidDistricts = await rebuildConn.all(`
      SELECT postal_district, COUNT(*) as cnt
      FROM projects
      WHERE postal_district NOT IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28')
        AND postal_district IS NOT NULL
      GROUP BY postal_district
    `);
    if (invalidDistricts.length > 0) {
      console.warn('⚠️ Warning: Found invalid postal districts:', invalidDistricts);
    } else {
      console.log('✓ Validation 1 Passed: All postal districts are valid 01-28 or NULL.');
    }

    // Validation 2: Non-landed development aggregate check
    const badLanded = await rebuildConn.all(`
      SELECT project_id, project_name, is_landed_aggregate
      FROM projects
      WHERE is_landed_aggregate = 1 AND UPPER(project_name) LIKE '%NON-LANDED%'
    `);
    if (badLanded.length > 0) {
      console.warn('⚠️ Warning: Non-landed development mistakenly flagged as landed aggregate:', badLanded);
      await rebuildConn.run(`UPDATE projects SET is_landed_aggregate = 0 WHERE UPPER(project_name) LIKE '%NON-LANDED%'`);
      console.log('Corrected non-landed flag.');
    } else {
      console.log('✓ Validation 2 Passed: No non-landed developments marked as landed aggregates.');
    }

    // Validation 3: Total record counts
    const projCount = await rebuildConn.get('SELECT COUNT(*) as c FROM projects');
    const salesCount = await rebuildConn.get('SELECT COUNT(*) as c FROM property_transactions');
    const rentCount = await rebuildConn.get('SELECT COUNT(*) as c FROM rental_transactions');
    const benchCount = await rebuildConn.get('SELECT COUNT(*) as c FROM project_benchmarks');
    console.log(`\nRebuilt Database Summary:`);
    console.log(`  - Projects:     ${projCount?.c || 0}`);
    console.log(`  - Sales:        ${salesCount?.c || 0}`);
    console.log(`  - Rentals:      ${rentCount?.c || 0}`);
    console.log(`  - Benchmarks:   ${benchCount?.c || 0}`);

    await rebuildConn.close();

    // Step 7: Atomic swap of database file
    console.log('\nSwapping clean rebuild into production property.db...');
    if (fs.existsSync(liveDbPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(__dirname, `../property.db.archive.${timestamp}`);
      fs.renameSync(liveDbPath, archivePath);
      console.log(`Existing database archived to: ${archivePath}`);
      // Remove any leftover wal/shm files
      if (fs.existsSync(`${liveDbPath}-wal`)) fs.unlinkSync(`${liveDbPath}-wal`);
      if (fs.existsSync(`${liveDbPath}-shm`)) fs.unlinkSync(`${liveDbPath}-shm`);
    }

    fs.renameSync(rebuildDbPath, liveDbPath);
    console.log('✓ Clean database successfully deployed as property.db!\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Rebuild failed:', err);
    await rebuildConn.close();
    if (fs.existsSync(rebuildDbPath)) {
      fs.unlinkSync(rebuildDbPath);
    }
    process.exit(1);
  }
}

rebuild();
