import 'dotenv/config';
import { initDb } from '../db.js';
import { fetchUraData } from '../ingestion.js';

async function main() {
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    console.error('Error: URA_ACCESS_KEY is not defined in environment variables.');
    console.error('Please configure URA_ACCESS_KEY in server/.env');
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Starting scheduled URA Data Service synchronization...`);
  await initDb();
  const result = await fetchUraData(accessKey);
  console.log(`[${new Date().toISOString()}] Ingestion completed:`, result);
  process.exit(0);
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] URA Sync failed:`, err);
  process.exit(1);
});
