import { promoteReviewedCandidate } from '../../utils/reviewedPromotion.js';
import { databaseMetrics } from '../../utils/databaseArtifacts.js';
const [targetPath,candidatePath,expectedTargetHash,expectedCandidateHash,stage]=process.argv.slice(2);
await promoteReviewedCandidate({targetPath,candidatePath,expectedTargetHash,expectedCandidateHash,
  validateCandidate:async file=>({match:(await databaseMetrics(file)).counts.projects===1}),
  onSwapStage:point=>{if(point===stage)process.exit(86);}});
