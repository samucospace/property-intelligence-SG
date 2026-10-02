import { createConnection } from '../../db.js';
import { runMigrations } from '../../migrations/index.js';
import { rebuildCleanDb, recoverInterruptedRebuild } from '../../utils/rebuildEngine.js';
const [action, file, stage] = process.argv.slice(2);
if (action === 'hold') {
  process.on('message', () => {});
  const conn = createConnection(file);
  await conn.get('SELECT COUNT(*) FROM projects');
  process.send('source-open');
  await new Promise(() => {});
} else if (action === 'migrate') {
  process.on('message', () => {});
  const conn = createConnection(file);
  const injected = { ...conn, run: async (sql, params) => {
    const result = await conn.run(sql, params);
    if (sql.startsWith('INSERT INTO schema_migrations') && params?.[0] === '010_reconcile_duplicate_projects') {
      process.send('inside-migration');
      await new Promise(() => {});
    }
    return result;
  }};
  await runMigrations(injected);
} else if (action === 'recover') {
  await recoverInterruptedRebuild(file);
} else if (action === 'rebuild') {
  await rebuildCleanDb({ targetLivePath: file, minimumCounts: {projects:1,sales:1,rentals:1},
    dataProvider: async conn => {
      const project=await conn.run("INSERT INTO projects(project_name,street_name,market_segment) VALUES('NEW','NEW ROAD','OCR')");
      await conn.run("INSERT INTO property_transactions(project_id,area_sqm,area_sqft,price_sgd,psqm_sgd,psft_sgd,contract_date,raw_hash) VALUES(?,100,1076,2000000,20000,1858,'2026-01-01','new-sale')",[project.lastID]);
      await conn.run("INSERT INTO rental_transactions(project_id,rent_sgd,lease_date,raw_hash) VALUES(?,5000,'2026-01','new-rent')",[project.lastID]);
      return {status:'success'};
    }, onSwapStage: async current => { if (current === stage) process.exit(73); }
  });
}
