# Phase 1 startup, scheduling and database safety runbook

Updated 5 October 2026. Release owner and operational contact: **Sam Fraser**. The project is not live; every identified issue must be fixed and verified before public release. The [Phase 0 containment policy](PHASE_0_OPERATIONS_RUNBOOK.md) remains active. Local Linux Docker qualification now passes; see the [qualification report](DOCKER_QUALIFICATION_REPORT_2026-10-05.md).

## Runtime and service separation

Use Node **22.23.3**, selected in `.nvmrc`, package engine ranges, CI and both Docker stages. Install with `npm ci` in the root, `server` and `client`; use the committed lockfiles. Docker supervises one Node process per container with an init process and `restart: unless-stopped`. PM2 is no longer installed in the release image; the ecosystem files are legacy references, not the current deployment path.

Ordinary `docker compose up -d --build` starts the web application and Caddy only. It does not start maintenance. Hosted configuration is still a deployment task, not a claim that this command has been run against a public host.

After configuring encrypted backups and passing the applicable maintenance/release gates, explicitly enable the separate scheduler with:

```sh
docker compose --profile maintenance up -d scheduler
docker compose logs --tail=100 scheduler
```

The scheduler waits for web health and initializes migrations before scheduling. Boot only registers the timer; due checks begin on the timer. Sync, cleanup and email remain disabled by default. Backup scheduling needs a configured production encryption secret and a writable backup location; off-host transfer remains the separate deployment-stage task documented in Phase 0.

## Durable scheduled execution

Schedules use Asia/Singapore. `job_slots` uniquely identifies each job/minute slot across restarts and workers; `job_history` records outcomes and committed counts. A slot claim is not erased when execution finishes or fails. This gives **at-most-once dispatch**, not a promise of exactly-once effects or automatic crash retry. A failed or interrupted slot needs operator investigation and an explicit manual rerun after checking committed effects.

Locks renew while jobs run. Lease expiry alone never authorizes another worker to overlap a live owner. Process death can be established only for a matching host identity; foreign/unknown owners and reused PIDs fail closed. Stop and verify the owner is gone before operator recovery of such locks. Do not clear slot/lock records simply to make an error disappear.

For authorized manual maintenance, use the scheduler wrapper so execution uses the same locks and history:

```sh
docker compose exec -T scheduler node server/scheduler.js --now=cron-db-backup
```

Choose one explicit job name; `--now` without a name should not be used operationally. Manual runs have new run IDs rather than an automatic retry of an old slot. Skipped/mock outcomes do not count as last success; partial/failure results fail the job and preserve honest committed counts. Durable email delivery/retry behavior remains Phase 3 work.

## Non-destructive imports

Live ingestion fetches and validates every requested sales batch and rental quarter before writing. Failed, malformed or empty responses abort without changing records. Dates, project/street identity, positive finite amounts/areas and rental quarter boundaries are checked. Requests retain bounded timeouts/retries.

Imports are **additive multiset unions**, not authoritative period replacement. Existing rows are never deleted because a response contains fewer same-period records. Replaying a complete payload adds no duplicates; genuine repeated transactions retain their multiplicity. Existing semantic rows are counted independently of legacy raw hashes. Counts are returned only after the import and benchmark transaction commits.

A successful import means validated records were committed, **not** that the provider's historical coverage is complete or its corrections reconciled. Provider corrections/deletions and adjudicated project identities require Phase 2 reconciliation. Do not enable scheduled production sync solely because the local tests pass.

## Rebuild containment and recovery

Operational rebuild remains quarantined, including `--force`. Only explicit injected disposable test databases can exercise the repaired engine. It clones the complete source, preserving unknown operational schemas and row multisets as well as leads, suppression and durable job state. Candidate-only writes, integrity/FK checks, minimum populations (5,500 projects / 130,000 sales / 440,000 rentals), no population shrinkage, and exact operational-state comparisons gate promotion. Tiny minimums are explicit fixture overrides only.

Existing catalog IDs are retained for operational references, including lead context and unknown FK-backed tables. Transaction tables are rebuilt; catalog deletions or identity changes require the Phase 2 adjudicated mapping. Population thresholds do not prove source completeness.

The engine rejects open source handles, acquires a maintenance marker, checks source hashes and checkpoints, and refuses promotion while source WAL/SHM handles remain. Database wrappers reject maintenance/pending-recovery operations and stale replacement generations. The swap journal and archived original support rollback; startup refuses pending recovery rather than creating a new empty database after an interrupted rename. Exception rollback and fresh-process recovery at prepared, source-moved and installed stages are tested on disposable files.

Never manually remove a real maintenance marker or swap journal or rename/delete real WAL/SHM files. Production promotion/recovery enablement still needs the target-platform rehearsal, reviewed complete source dataset, stopped database users and an approved maintenance procedure. The reviewed 5 October Phase 2 snapshot was promoted locally through its separate hash-bound procedure; the general rebuild engine remains quarantined. See the Phase 2 runbook.

## Verification

```sh
npm --prefix server test
npm --prefix client run build
node server/scripts/qualify-startup.js --output=audit/2026-10-02/phase1-node22-startup.json
```

The startup qualification uses temporary databases and mock credentials; it starts/health-checks 20 fresh databases, five existing-database restarts and five concurrent processes. CI also runs it inside the built release image. `server/scripts/qualify-release-image.js` separately verifies production startup, health/frontend responses, non-root execution and absence of local credentials/database. Run image checks with networking disabled, a read-only root and writable temporary storage; CI contains the exact commands. See [the current Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md) for results and pending gates.
