/**
 * Migration 006: Pre-compute Livability Scores (Step 3.1)
 * Computes default livability scores and sub-scores for all projects with coordinates,
 * storing them in projects.livability_score and projects.livability_data.
 */

import { calculateLivabilityScore, getParsedAmenities } from '../livabilityEngine.js';

export const name = '006_precompute_livability';

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  console.log('[Migration 006] Pre-computing livability scores into projects table...');
  const amenities = await getParsedAmenities(conn);
  const projects = await all(`SELECT project_id, latitude, longitude FROM projects`);

  let count = 0;
  for (const p of projects) {
    if (!p.latitude || !p.longitude) {
      await run(
        `UPDATE projects SET livability_score = NULL, livability_data = NULL WHERE project_id = ?`,
        [p.project_id]
      );
      continue;
    }

    const full = await calculateLivabilityScore(p.latitude, p.longitude, null, amenities, { trimmed: false });
    const dataPayload = JSON.stringify({
      subScores: full.subScores,
      nearest: full.nearest
    });

    await run(
      `UPDATE projects SET livability_score = ?, livability_data = ? WHERE project_id = ?`,
      [full.score, dataPayload, p.project_id]
    );
    count++;
  }

  console.log(`[Migration 006] Successfully pre-computed livability for ${count} projects.`);
}
