import { applyLegacyIdentityApprovals } from '../utils/projectAdjudication.js';
import { refreshProjectBenchmarks } from '../queryEngine.js';
import { precomputeAllProjectLivability } from '../livabilityEngine.js';

export async function up(conn) {
  await applyLegacyIdentityApprovals(conn, undefined, { allowMissing: true });
  await refreshProjectBenchmarks(conn);
  await precomputeAllProjectLivability(conn);
}
