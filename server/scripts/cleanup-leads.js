import '../config.js';
import { createConnection } from '../db.js';

/**
 * Monthly Lead Retention Cleanup Script (Step 4.5.5 & 5.4).
 * Purges unconverted agent advisory leads older than 12 months under PDPA retention policies.
 */
async function cleanupLeads() {
  const conn = createConnection();
  try {
    console.log(`[${new Date().toISOString()}] Starting monthly PDPA lead retention purge...`);
    const result = await conn.run(`
      DELETE FROM leads
      WHERE lead_type = 'agent_advisory'
        AND created_at < date('now', '-12 months')
    `);
    const count = result?.changes || 0;
    console.log(`[${new Date().toISOString()}] Successfully purged ${count} expired agent advisory leads older than 12 months.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Lead retention cleanup failed:`, err);
    process.exit(1);
  } finally {
    await conn.close();
  }
}

cleanupLeads().then(() => process.exit(0));
