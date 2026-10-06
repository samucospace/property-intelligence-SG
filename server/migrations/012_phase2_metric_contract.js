import { refreshProjectBenchmarks } from '../queryEngine.js';
import { reviewSchema, readAdjudications } from '../utils/projectAdjudication.js';

export async function up(conn) {
  await conn.run(reviewSchema);
  // Already merged legacy identities remain excluded until their source evidence is reviewed.
  for (const entry of readAdjudications()) {
    if (entry.status !== 'pending') continue;
    const project = await conn.get('SELECT project_name FROM projects WHERE project_id=?',[entry.targetId]);
    if (project?.project_name !== entry.projectName) continue;
    await conn.run('INSERT OR IGNORE INTO project_identity_review(project_id,status,reason,evidence) VALUES(?,?,?,?)',
      [entry.targetId,'pending','Legacy automatic merge awaiting source adjudication',entry.sourceEvidence]);
  }
  for (const column of ['source TEXT','source_url TEXT','observed_at TEXT','verified INTEGER NOT NULL DEFAULT 0']) {
    const name=column.split(' ')[0];
    if (!(await conn.all('PRAGMA table_info(sora_rates)')).some(c=>c.name===name)) await conn.run('ALTER TABLE sora_rates ADD COLUMN '+column);
  }
  await conn.run("UPDATE sora_rates SET source='legacy-seed-unverified' WHERE source IS NULL");
  await conn.run("UPDATE rental_transactions SET area_sqft=NULL,area_sqm=NULL,rent_psft=NULL,rent_psqm=NULL WHERE floor_area_range LIKE '%>%' OR floor_area_range LIKE '%<%' OR floor_area_range LIKE '%above%' OR floor_area_range LIKE '%below%'");
  await conn.run("UPDATE projects SET livability_score=NULL,livability_data=NULL WHERE geo_source='district_centre' OR latitude IS NULL OR longitude IS NULL");
  await refreshProjectBenchmarks(conn);
}
