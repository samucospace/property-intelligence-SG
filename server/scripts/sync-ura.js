import '../config.js';
import { initDb } from '../db.js';
import { fetchUraData } from '../ingestion.js';
import { requireDataSyncEnabled } from '../utils/releasePolicy.js';
import { runJobWithLock } from '../utils/jobRunner.js';

async function main() {
  requireDataSyncEnabled();
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    console.error('Error: URA_ACCESS_KEY is not defined in environment variables.');
    console.error('Please configure URA_ACCESS_KEY in server/.env');
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Starting scheduled URA Data Service synchronization...`);
  await initDb();
  const result = await runJobWithLock({jobName:'cron-ura-sync', fn:({conn})=>fetchUraData(accessKey,conn)});
  console.log(`[${new Date().toISOString()}] Ingestion completed:`, result);

  if (result.status !== 'success' || (result.salesBatchErrors && result.salesBatchErrors.length > 0) || (result.rentalQuarterErrors && result.rentalQuarterErrors.length > 0)) {
    console.error(`[${new Date().toISOString()}] Ingestion finished with errors. Exiting non-zero.`);
    if (result.salesBatchErrors?.length > 0) console.error('Sales batch errors:', result.salesBatchErrors);
    if (result.rentalQuarterErrors?.length > 0) console.error('Rental quarter errors:', result.rentalQuarterErrors);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] URA Sync failed:`, err);
  process.exit(1);
});
