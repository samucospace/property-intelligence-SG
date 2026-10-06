import fs from 'node:fs';
import { normalizeStreetName } from './streetUtils.js';
import { withTransaction } from '../db.js';

export const reviewSchema = `CREATE TABLE IF NOT EXISTS project_identity_review (
  project_id INTEGER PRIMARY KEY REFERENCES projects(project_id), status TEXT NOT NULL,
  reason TEXT NOT NULL, evidence TEXT, reviewed_by TEXT, reviewed_at TEXT)`;

export function readAdjudications() {
  return JSON.parse(fs.readFileSync(new URL('../migrations/data/project_adjudication_map.json',import.meta.url),'utf8')).entries;
}

export async function applyLegacyIdentityApprovals(conn, entries = readAdjudications(), { allowMissing = false } = {}) {
  return withTransaction(conn, async () => {
    await conn.run(reviewSchema);
    let applied = 0;
    for (const entry of entries) {
      if (entry.reviewType !== 'legacy-merge-acceptance' || entry.status !== 'approved') continue;
      if (!entry.approvedBy || !entry.approvedAt || !entry.sourceEvidence || !entry.expectedSource || !entry.expectedTarget)
        throw Error('Legacy acceptance requires attributable approval and exact identity evidence');
      const source = await conn.get('SELECT project_id FROM projects WHERE project_id=?', [entry.sourceId]);
      const target = await conn.get('SELECT * FROM projects WHERE project_id=?', [entry.targetId]);
      if (!source && !target && allowMissing) continue; // Fresh databases have no legacy catalog.
      if (source || !target) throw Error('Legacy merge acceptance requires an absent source and retained target');
      if (target.project_name !== entry.projectName || target.project_name !== entry.expectedTarget.project_name ||
          target.project_name !== entry.expectedSource.project_name ||
          normalizeStreetName(target.street_name) !== normalizeStreetName(entry.expectedTarget.street_name) ||
          normalizeStreetName(target.street_name) !== normalizeStreetName(entry.expectedSource.street_name))
        throw Error('Legacy acceptance identity precondition failed');
      if (entry.expectedTarget.postal_district && target.postal_district !== entry.expectedTarget.postal_district)
        throw Error('Legacy acceptance district precondition failed');
      const previous = await conn.get('SELECT * FROM project_identity_review WHERE project_id=?', [entry.targetId]);
      if (previous && !['Legacy automatic merge awaiting source adjudication', 'Approved historical merge acceptance'].includes(previous.reason))
        throw Error('Separate identity conflict cannot be cleared by a historical acceptance');
      await conn.run(`INSERT INTO project_identity_review(project_id,status,reason,evidence,reviewed_by,reviewed_at)
        VALUES(?,'approved','Approved historical merge acceptance',?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,
          evidence=excluded.evidence,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`,
        [entry.targetId, entry.sourceEvidence, entry.approvedBy, entry.approvedAt]);
      applied++;
    }
    return { applied };
  });
}

export async function mergeReviewedProjects(conn, projects, entries) {
  await conn.run(reviewSchema);
  const byId = new Map(projects.map(p=>[p.project_id,p]));
  let removed = 0;
  for (const entry of entries) {
    if (entry.status !== 'approved') continue;
    // Acceptance of a historical merge is a review decision, not a request to
    // repeat its deletion/reassignment during fresh migrations or baseline replay.
    if (entry.reviewType === 'legacy-merge-acceptance') continue;
    if (!entry.approvedBy || !entry.approvedAt || !entry.sourceEvidence || !entry.expectedSource || !entry.expectedTarget)
      throw Error('Identity merge requires attributable approval and source evidence');
    const source = byId.get(entry.sourceId), target = byId.get(entry.targetId);
    if (!source || !target || source === target) throw Error('Approved identity mapping does not match current projects');
    for (const [actual, expected] of [[source,entry.expectedSource],[target,entry.expectedTarget]]) {
      for (const key of ['project_name','street_name','postal_district']) {
        if (actual[key] !== expected[key]) throw Error('Identity mapping precondition failed: '+key);
      }
    }
    if ((source.postal_district && target.postal_district && source.postal_district !== target.postal_district) || source.project_name !== target.project_name || normalizeStreetName(source.street_name) !== normalizeStreetName(target.street_name))
      throw Error('Conflicting identity merge requires separate source adjudication');
    await conn.run('UPDATE property_transactions SET project_id=? WHERE project_id=?',[target.project_id,source.project_id]);
    await conn.run('UPDATE rental_transactions SET project_id=? WHERE project_id=?',[target.project_id,source.project_id]);
    await conn.run('DELETE FROM project_benchmarks WHERE project_id=?',[source.project_id]);
    await conn.run('DELETE FROM project_identity_review WHERE project_id=?',[source.project_id]);
    await conn.run('DELETE FROM projects WHERE project_id=?',[source.project_id]);
    byId.delete(source.project_id);
    await conn.run('INSERT OR REPLACE INTO project_identity_review VALUES(?,?,?,?,?,?)',
      [target.project_id,'approved','Explicit reviewed identity merge',entry.sourceEvidence,entry.approvedBy,entry.approvedAt]);
    removed++;
  }
  return { projects: [...byId.values()], removed };
}
