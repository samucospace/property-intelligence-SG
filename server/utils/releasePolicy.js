// Read dynamically so every entry point enforces the same deployment policy.
export function releaseFeatures() {
  const scope = process.env.RELEASE_SCOPE || 'analytics-readonly';
  if (!['analytics-readonly', 'full'].includes(scope)) throw new Error('Invalid RELEASE_SCOPE');
  return {
    scope,
    leadCapture: scope === 'full',
    outboundEmail: scope === 'full' && process.env.ENABLE_OUTBOUND_EMAIL === 'true',
    dataSync: process.env.ENABLE_DATA_SYNC === 'true',
    leadCleanup: scope === 'full' && process.env.ENABLE_LEAD_CLEANUP === 'true'
  };
}

export function requireDataSyncEnabled() {
  if (!releaseFeatures().dataSync) throw new Error('Data sync is contained pending Phase 1 safety verification (ENABLE_DATA_SYNC is disabled).');
}
