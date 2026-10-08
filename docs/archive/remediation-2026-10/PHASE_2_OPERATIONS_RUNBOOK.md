# Phase 2 source and analytics operations

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


Updated 5 October 2026. Owner/operator: Sam Fraser. The project is not live; release restrictions remain active. Metric definitions and exclusions are approved in the [contract](PHASE_2_METRIC_CONTRACT.md). Individual source/identity decisions are separate review records.

## Isolated source evidence

Use Node 22.23.3 and work from the server directory. The following scripts capture and compare data; they do not enable production sync or email.

1. `node scripts/capture-ura-source.js ../audit/DATE/provider-source-UNIQUE` reads the locally configured URA key, saves response files/hashes and logs only scope/count/status. Choose a new folder each time. Tokens/keys are not persisted. Raw captures remain ignored by Git and excluded from Docker context.
   Rental requests cover rolling five-year quarters through the last completed quarter. This capture policy deliberately excludes the in-progress quarter; it does not establish that every month in the requested quarters is available. The manifest and observed record dates establish the comparison bounds. The older additive live-sync path remains disabled and does not provide authoritative snapshot replacement.
2. `node scripts/normalize-ura-audit.js CAPTURE_FOLDER` generates the canonical source ledger, scope manifest and per-identity evidence. It updates draft evidence in the adjudication map, never human approval. Review its source bounds and unavailable quarters. The current API is a moving five-year source, not an archive of all earlier data.
3. `node scripts/reconcile-dataset.js DATABASE SOURCE_LEDGER SOURCE_MANIFEST NEW_REPORT` opens the database read-only and refuses report overwrite. It checks identities, periods, multiplicities, totals and integrity. A false match result is a failed reconciliation, not permission to delete extra records. Output examples are capped; full mismatch counts are retained.

The checked-in capture/rehearsal helpers currently name the 5 October fixture paths. Change them only for a new explicit isolated rehearsal. `rehearseSourceSnapshot` requires test mode and an existing explicitly named candidate. It rejects incomplete batch/quarter coverage and response-hash/envelope failures, archives replaced rows and imports transactionally. Failed validation rolls back both deletion and archive changes. It cannot be used as a production maintenance command.

## Identity review

Start with the [plain-language decision guide](PHASE_2_IDENTITY_REVIEW_GUIDE.md), which explains approval consequences and all 35 recommendations. It is a review aid, not an approval record.

The adjudication map covers all 35 legacy removals, including five source identities with no moved transactions. Review name/street/district, retained original-baseline coordinates, provider coordinates, record ownership and the complete raw evidence. NULL baseline districts/coordinates are unknown, not positive confirmation. A 100m coordinate-support flag is a review aid, not proof that similarly named developments are identical.

New destructive merges require approved entries with reviewer/date, source evidence and exact preconditions. Pending identities retain their records and are excluded from public calculations. Do not edit the review table directly merely to make the release dashboard green. Existing legacy merges require a separate attributable decision before quarantine is lifted.

## Completed local promotion and recovery

The reviewed 5 October source snapshot has been promoted locally. All 35 approvals are applied by migration 014 without repeating historical deletions. The [preparation evidence](../../../audit/2026-10-05/phase2-final-candidate.json) and [promotion evidence](../../../audit/2026-10-05/phase2-final-promotion.json) record exact paths, hashes, source parity, original archive/history preservation and the encrypted backup restored in a fresh process. The original database remains in the recorded sibling backup. No feature flags or scheduled imports were enabled.

The one-time procedure is `scripts/finish-phase2.js`, run from the server directory with Node 22.23.3 and `NODE_ENV=test`. `--prepare` creates a new isolated candidate and restored encrypted backup; `--promote` requires the recorded original/candidate, ledger, manifest and approval hashes and revalidates data and operational preservation. These commands are bound to the reviewed 5 October snapshot and refuse overwrite or changed-source hashes. They are not commands to rerun after successful promotion, nor a general sync procedure.

The candidate preserves every existing operational schema/row; only the explicitly allowed empty `job_slots` table is added by the earlier Phase 1 migration. Promotion requires stopped database users and closed/checkpointed files. Maintenance and swap journals fence application startup; a generation change fences old connections. Exception rollback and process-loss recovery at prepared/source-moved/installed stages are tested on Windows/Linux.

For an interrupted execution of this specific reviewed-promotion procedure, stop database users and run `NODE_ENV=test node scripts/finish-phase2.js --recover` from the server directory (set the environment variable separately in PowerShell). Recovery checks recorded host/PID, paths and the original hash before restoring. It refuses a live or ambiguous owner. Do not manually remove journals, maintenance markers or WAL/SHM files. Recovery is for an interrupted swap; it is not a command to roll back an already completed promotion. Use the recorded backups and a new reviewed maintenance procedure for a later rollback.

Raw source captures, final candidate, restored database, encrypted artifact and recovery key remain local and ignored. Keep the key separately from backups; do not publish either. Hosted/off-host backup, persistent storage, proxy/TLS and actual-host recovery remain deployment checks. General rebuild and scheduled source replacement remain quarantined because this captured feed does not prove future completeness.

## Verification

Run the isolated server suite and client build on Node 22.23.3. The corrected regressions cover independent historical arithmetic, missing and sparse samples, all query surfaces, combined/radius filters, stable pagination, external/local writes, approximate detail routes, source multiplicity, malformed replacement rollback and disabled SORA claims.

The [current Phase 2 report](PHASE_2_COMPLETION_REPORT_2026-10-05.md) records completed local results: 189 tests on Windows/Linux, final-image startup/packaging and independent real-data API arithmetic. Phase 3 remains email, consent, access and recovery; this runbook does not establish delivery, privacy or deployment readiness.
