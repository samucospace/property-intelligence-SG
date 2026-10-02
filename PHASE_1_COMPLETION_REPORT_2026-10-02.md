# Phase 1 correction and verification report — 2 October 2026

**Status: Local implementation and failure regressions verified; release-image qualification and operational rebuild enablement remain pending. Phase 1 is not signed off.**

This report replaces the previous unsupported “all exit gates passed” statement. Governing scope is [Phase 1 of the remediation plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md); current procedures are in the [Phase 1 runbook](PHASE_1_OPERATIONS_RUNBOOK.md). Sam Fraser is release owner and operational contact. The project is not live and will not go live until every identified issue is fixed and verified. No deployment or owner approval is claimed.

## Implemented corrections

1. **Runtime and installation:** Node 22.23.3 is selected in `.nvmrc`, engine ranges, CI and both Docker stages. An official portable Windows runtime was downloaded and verified against Node's published SHA-256 list. Locked clean installs pass in the root, server and client. Docker directly supervises separate web and scheduler processes with init/restart policies; the release image no longer installs global PM2 or starts maintenance with the web application.
2. **Awaited SQLite initialization:** Database-open and every initialization PRAGMA error reach awaiting callers. Busy handling precedes WAL setup, journal contention has bounded retries, foreign keys are enabled and synchronous durability is FULL. Failed opens close without hanging. Initialization never silently resolves after a failed PRAGMA.
3. **Atomic migrations:** SQLite `BEGIN IMMEDIATE` owns serialization across processes. Pending schema/data changes and migration version records share one transaction; killed workers roll back and release ownership. Table reconstruction uses nested savepoints under the runner's foreign-key handling and final FK validation. Migration 010 also has its own savepoint, so direct ownership reassignment rolls back on failure. Time-based schema-lock theft is removed.
4. **Safe imports:** Every live sales batch/rental quarter is fetched and validated before any writes. Empty/error/malformed scopes, missing identity, invalid amounts/dates and out-of-quarter rentals reject the run. Imports no longer delete same-period history. Semantic multiset unions preserve genuine repeated rows and street/project identity, recognize existing rows independently of legacy hashes, and return only newly committed counts. Imports and benchmark refresh commit or roll back together. Full historical completeness, provider corrections and approved identity reconciliation remain Phase 2 requirements.
5. **Durable scheduling:** Migration 011 adds unique job/minute-slot claims. Restarted/concurrent schedulers cannot repeat a claimed slot. Locks renew and never become stealable solely through expiry; unknown/foreign owners fail closed. Outcomes distinguish skipped/mock work, failed/partial work and success. Startup registers the timer without executing jobs; maintenance is an explicit Compose profile after web health. At-most-once dispatch does not imply automatic crash retry or exactly-once external delivery.
6. **Rebuild safety:** The fixture-only engine clones the complete source, preserving all operational table schemas/row multisets, including unknown suppression tables and durable job slots. Catalog IDs stay stable for operational references. Candidate-only writes, all-table integrity/FKs, population minima (5,500 projects / 130,000 sales / 440,000 rentals), no population shrinkage, operational-state equality, source hashes and verified checkpoints gate promotion. Open/WAL/SHM handles, maintenance markers and stale connection generations fence unsafe access. A persisted swap journal and archived original support verified exception rollback and fresh-process recovery after abrupt termination. Operational rebuild remains quarantined, including `--force`; smaller populations are explicit test-only overrides.

## Verification evidence

| Check | Current result |
|---|---|
| Full isolated suite on selected runtime | **161/161 tests, 13/13 files passed**, Node 22.23.3 on Windows; `audit/2026-10-02/phase1-node22-tests.log` |
| Added failure regressions | 19 dedicated cases in `server/tests/phase1-safety.test.js`: same-period partial/multiplicity replay, malformed/empty imports, provider failure before writes, committed-count rollback, migration ledger failure, direct migration 010 interruption, terminated migration worker, scheduler restart/concurrency/lease/outcome cases, staging timer startup, interrupted rebuild recovery, live handles, suppression/job preservation and failed database open |
| Clean installation | Root/client/server `npm ci` passed using Node 22.23.3 and npm 10.9.9. Initial server registry timeouts were resolved by retrying with fewer simultaneous downloads; only the successful retry qualifies the install |
| Frontend production build | Passed on Node 22.23.3; `audit/2026-10-02/phase1-node22-build.log`. Existing 919.29 kB bundle warning remains a Phase 4 issue |
| Actual application startup/health | **20/20 fresh-disk starts, 5/5 existing-database restarts, 5/5 concurrent processes passed** on Node 22.23.3; `audit/2026-10-02/phase1-node22-startup.json` |
| Disposable staging scheduler | A database marked staging starts its real daemon/timer without boot dispatch, runs the fake due job, and does not repeat it after daemon restart; dedicated regression |
| Native SQLite failure/recovery | Migration process terminated inside an uncommitted migration; fresh connection sees rollback and successfully retries. Rebuild worker exits abruptly at prepared/source-moved/installed stages; a separate recovery process restores the original main-file hash and preserved state |
| Cross-process source handles | Another worker holding the source open prevents promotion; the original database hash remains unchanged |
| Compose configuration | `docker compose --env-file server/.env.staging.example config --quiet` passed with synthetic configuration values; no services deployed |
| Server production dependency audit | Zero reported vulnerabilities after clean installation; `audit/2026-10-02/phase1-dependency-audit.json`. This is a dated dependency result, not completion of the full Phase 4 security review |
| Release-image build/startup | **Pending.** Docker Desktop fails during Windows inference-manager startup; its Linux engine is unavailable. CI now builds/loads the image and runs `server/scripts/qualify-startup.js`, but no successful CI/image run is claimed |

All mutations and crash tests used disposable databases. The real market database was not imported, migrated or rebuilt; no live provider requests or emails were sent. Local tests do not establish Linux/Alpine or hosted behavior.

## Original governing exit gates — retained without narrowing

| Original Phase 1 criterion | Disposition |
|---|---|
| At least 20 consecutive fresh-disk starts and repeated existing-database starts pass in the target image; interrupted/concurrent migration tests are deterministic. | Local Node 22 startup and interruption/concurrency checks pass. **Target-image run still required.** |
| An isolated rebuild leaves the source logically unchanged until the intended swap; empty, partial, provider-failure and interrupted-swap cases preserve or restore the original data. | Verified on disposable Windows fixtures, including abrupt termination and another process holding handles. **Target-platform qualification and complete reconciled source proof remain required before operational enablement.** |
| Same-name/different-street fixtures preserve both projects' transactions; replay is idempotent without removing legitimate multiplicity. | Locally verified; new semantic identity includes project ownership/full transaction fields rather than depending solely on raw hashes. |
| Partial imports preserve out-of-scope history; malformed/empty provider results cannot erase good data; failure status and committed counts agree. | Locally verified, including partial same-period data, sales and rentals, complete live-scope fetch-before-write and failed-write rollback. Authoritative deletion/replacement is not enabled. |
| Staging proves a scheduled job runs when due, runs once, survives scheduler restart and does not run merely because the application was deployed. | Verified in isolated local staging using the real daemon/timer and fake job; persistent shared-DB concurrency/restart cases pass. Hosted staging remains a deployment-stage check. |
| Clean install, tests and image build pass on the selected supported runtime. | Node 22 locked installs, suite and frontend build pass. **Container image build/run pending Docker recovery or a recorded successful CI run.** |

## Remaining closure work

1. Obtain a successful Linux release-image build and qualification run, and record image identity/output. The local Docker failure matches an [open report in Docker's tracker](https://github.com/docker/desktop-feedback/issues/625); it is an environment blocker, not a green application gate. No Docker data reset, container/volume deletion or host filesystem repair was performed.
2. Retain rebuild quarantine until a complete, reconciled source dataset and the target-platform maintenance/promotion/recovery rehearsal are reviewed. The live fetch reports `sourceCompleteness: unverified`; it cannot authorize destructive replacement. Counts alone cannot approve an authoritative rebuild.
3. During private deployment, verify the intended proxy/storage/permissions, service separation, real scheduled timing and backup configuration. Keep sync, cleanup and mail disabled until their governing gates pass. Hosted/off-host backup setup remains deferred to deployment, as Sam directed.

Phase 2 analytics, source identity adjudication/provenance and external reconciliation remain open. Phase 3 retains its original email/consent/access/recovery scope. These Phase 1 corrections do not authorize public release.
