# Phase 1 Detailed Implementation Plan: Startup, Scheduling & Data-Write Safety

**Current correction:** The original implementation/completion claims below are superseded by the [corrected Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md) and [operations runbook](PHASE_1_OPERATIONS_RUNBOOK.md). Runtime is now pinned to Node 22.23.3; Docker supervises separate processes, imports are additive, migrations are transactional and scheduled slots are durable. Operational rebuild remains quarantined pending final qualification and source reconciliation. The original governing acceptance gates remain mandatory.

**Document Date:** 2 October 2026
**Governing Documents:**
- [`GO_LIVE_REMEDIATION_PLAN_2026-10-02.md`](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md) (Phase 1)
- [`GO_LIVE_READINESS_REPORT_2026-10-02.md`](GO_LIVE_READINESS_REPORT_2026-10-02.md) (Findings GL-01–04, GL-12, GL-16)
- [`PHASE_0_COMPLETION_REPORT_2026-10-02.md`](PHASE_0_COMPLETION_REPORT_2026-10-02.md)
- [`PHASE_0_SCOPE_AND_GOVERNANCE.md`](PHASE_0_SCOPE_AND_GOVERNANCE.md)
**Assigned Ownership:** Backend & Platform Engineering Lead
**Engineering Estimate:** 4–6 engineering days
**Target Release Scope:** Phased Read-Only Analytics MVP First (Personal Data / Email deferred to Phase 3)

---

## 1. Executive Summary & Objective

Phase 0 established operational containment: unsafe operations were quarantined, background cron jobs were stripped from deploy-time execution, and a verified AES-256-GCM encrypted baseline of the production database (**584,140 transactions**, **5,938 projects**) was successfully rehearsed.

**Phase 1 objective:** Eliminate the root architectural defects preventing reliable startup, deterministic scheduling, and non-destructive data ingestion.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               PHASE 1 WORKSTREAM TOPOLOGY                               │
├────────────────────────────┬───────────────────────────────────────────────────────────┤
│ Track 1: Runtime (GL-12)   │ Upgrade Node 20 (EOL) -> Node 22 LTS, pin PM2 & tooling    │
├────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Track 2: Startup (GL-02)   │ Fix unawaited SQLite init, busy_timeout ordering & locks   │
├────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Track 3: Scheduler (GL-03) │ Persistent scheduler daemon, job locks & execution ledger │
├────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Track 4: Ingestion (GL-04) │ Street-aware transaction hashes, scoped non-destructive tx │
├────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Track 5: Rebuild (GL-01)   │ Connection injection, pre-swap integrity gates & rollback │
├────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Track 6: Testing (GL-16)   │ Central test isolation, 20x disk startups, fault injection│
└────────────────────────────┴───────────────────────────────────────────────────────────┘
```

---

## 2. Workstream Details & Technical Specifications

### Track 1: Runtime & Toolchain Alignment (GL-12)
**Goal:** Align development, CI, and container runtime on supported Node.js 22 LTS with pinned, reproducible dependencies.

#### Technical Diagnosis
- `Dockerfile` and `.github/workflows/ci.yml` target Node 20, which reached End-Of-Life (EOL) in 2026.
- `Dockerfile` installs PM2 globally via unpinned `npm install -g pm2`, introducing supply chain drift.
- Local environments default to Node v24, causing cross-runtime discrepancies with CI/production.

#### Target Implementation
1. **Node.js LTS Version:** Pin to Node.js 22 LTS (Active LTS, `node:22-alpine`).
2. **Process Manager:** Pin PM2 globally to exact version `pm2@5.4.3`.
3. **Engine Declaration:** Update `package.json` in root, `server/`, and `client/` to enforce:
   ```json
   "engines": {
     "node": ">=22.0.0 <23.0.0",
     "npm": ">=10.0.0"
   }
   ```
4. **CI Pipeline:** Update `.github/workflows/ci.yml` `actions/setup-node@v4` with `node-version: 22`.
5. **Dockerfile Updates:**
   - Update Stage 1: `FROM node:22-alpine AS client-builder`
   - Update Stage 2: `FROM node:22-alpine`
   - Pin PM2: `RUN npm install -g pm2@5.4.3`

---

### Track 2: Awaited Startup, SQLite Concurrency & Serialized Migrations (GL-02)
**Goal:** Eliminate uncaught `SQLITE_BUSY` crashes on fresh database creation and guarantee deterministic migration execution across concurrent workers.

#### Technical Diagnosis
1. **Unawaited Top-Level Execution:** `server/db.js:18` instantiates `new sqlite3.Database(dbPath)` immediately when imported. `db.serialize()` executes `PRAGMA journal_mode = WAL;` before `PRAGMA busy_timeout = 5000;`. On fresh disk files, setting WAL without busy handling triggers unhandled `SQLITE_BUSY: database is locked`.
2. **Static DB_PATH Capture:** `server/db.js:9` evaluates `process.env.DB_PATH` once at module import. Scripts that subsequently modify `process.env.DB_PATH` cannot redirect already-imported connections.
3. **Competing Startup Connections:** `server/index.js` imports `db.js` (opening connection 1), then `startServer()` calls `initDb()`, which calls `createConnection()` (opening connection 2). Both attempt WAL initialization and schema checks simultaneously.
4. **Uncoordinated Migrations:** `server/migrations/index.js` checks `schema_migrations` without an exclusive lock or single transaction wrapper. If the web server and a maintenance job start concurrently, both race on table creation.

#### Target Implementation
1. **Refactor [`server/db.js`](server/db.js):**
   - Dynamic path resolution: Provide `getDbPath()` instead of static top-level assignment.
   - Strict PRAGMA initialization order in `createConnection(customPath)`:
     ```javascript
     conn.serialize(() => {
       // 1. Set busy_timeout FIRST before any journal or write operations
       conn.run('PRAGMA busy_timeout = 10000;');
       // 2. Enable WAL journal mode
       conn.run('PRAGMA journal_mode = WAL;');
       // 3. Normal synchronous for WAL performance & safety
       conn.run('PRAGMA synchronous = NORMAL;');
       // 4. Enforce foreign keys
       conn.run('PRAGMA foreign_keys = ON;');
     });
     ```
   - Lazy/Awaited Primary Connection: Replace the unconditional top-level `new sqlite3.Database()` with an explicit `getPrimaryDb()` or awaited initialization helper `initDatabaseConnection()`.
2. **Refactor [`server/migrations/index.js`](server/migrations/index.js):**
   - Implement an exclusive SQLite advisory migration lock:
     - Execute `BEGIN IMMEDIATE` or acquire a lock row in a dedicated `schema_lock` table with an expiration timestamp.
     - Prevent concurrent processes from executing migrations simultaneously.
   - Atomically wrap each migration execution with its `schema_migrations` insertion:
     ```javascript
     await withTransaction(conn, async () => {
       await migration.up(conn);
       await conn.run(`INSERT INTO schema_migrations (name) VALUES (?)`, [migrationName]);
     });
     ```
3. **Refactor [`server/index.js`](server/index.js):**
   - Structure `startServer()` as a strict sequential barrier:
     ```
     [1. Validate Environment]
              │
              ▼
     [2. Acquire Lock & Await Migrations (initDb)]
              │
              ▼
     [3. Pre-warm Caches & Static Seeds]
              │
              ▼
     [4. Start Express HTTP Listener]
              │
              ▼
     [5. Ready & Health Probe Enabled]
     ```
   - Do NOT pre-warm caches or bind HTTP ports if migrations fail or are in progress.

---

### Track 3: Persistent Scheduler & Job Locking Architecture (GL-03)
**Goal:** Replace ephemeral PM2 cron restarts with a resilient, long-running scheduler daemon featuring SQLite-backed distributed locks and Singapore timezone awareness.

#### Technical Diagnosis
- `ecosystem.config.cjs` defined one-shot tasks with `autorestart: false` and `cron_restart`.
- On container start, PM2 spawned all scripts simultaneously (sync, cleanup, backup, newsletter), causing deploy-time data mutation and rapid process exits. PM2 cannot evaluate `cron_restart` once a process terminates.
- While Phase 0 decoupled crons into `ecosystem.maintenance.config.cjs`, a reliable scheduling mechanism is required for production.

#### Target Architecture
1. **Persistent Worker Daemon (`server/scheduler.js`):**
   - Single long-running process managed by PM2 (`property-intelligence-scheduler`) or container daemon with `autorestart: true`.
   - Incorporates lightweight in-process cron scheduling (e.g., node-cron) configured explicitly for `Asia/Singapore` (UTC+8).
2. **Database-Backed Job Coordination Schema:**
   - Add Migration 009 (`009_scheduler_and_job_locks.js`):
     ```sql
     CREATE TABLE IF NOT EXISTS job_locks (
       job_name TEXT PRIMARY KEY,
       locked_at DATETIME NOT NULL,
       locked_by TEXT NOT NULL,
       run_id TEXT NOT NULL,
       lease_expires_at DATETIME NOT NULL
     );

     CREATE TABLE IF NOT EXISTS job_history (
       run_id TEXT PRIMARY KEY,
       job_name TEXT NOT NULL,
       started_at DATETIME NOT NULL,
       finished_at DATETIME,
       status TEXT NOT NULL, -- 'running', 'success', 'failed'
       items_processed INTEGER DEFAULT 0,
       error_message TEXT
     );
     ```
3. **Locking & Execution Protocol (`server/utils/jobRunner.js`):**
   - **No Deploy-Time Execution:** Jobs run ONLY when their cron time triggers or via explicit CLI `--now` flag.
   - **Atomic Lease Acquisition:** Query `job_locks`. If lock exists and `lease_expires_at > CURRENT_TIMESTAMP`, skip run. Otherwise, acquire lock with 15-minute lease.
   - **Heartbeat & Release:** If job completes, update `job_history` to `success` and release `job_locks`. If job crashes, lease expires automatically.
4. **Decoupled Production Ecosystem:**
   - Web application container runs strictly `property-intelligence-sg`.
   - Background jobs execute via `server/scheduler.js` without side-effects on web deployment.

---

### Track 4: Ingestion Transaction Identity & Scoped Replacement (GL-04)
**Goal:** Fix deduplication collisions across same-name developments on different streets, and replace blind full-project table wipes with scoped, validated updates.

#### Technical Diagnosis
1. **Deduplication Hash Collision:**
   - `server/ingestion.js:17` defines `generateTxHash(projName, dateStr, price, area, floorRange, occurrenceIndex, noOfUnits, propertyType, district)`.
   - The hash omits `streetName` and `projectId`.
   - In probe tests, two distinct projects named `"AUDIT SAME NAME"` in District 09 on `"AUDIT ALPHA ROAD"` and `"AUDIT BETA ROAD"` generated identical hashes. The second transaction was silently discarded by the `UNIQUE(raw_hash)` constraint.
2. **Destructive Whole-Project Deletion:**
   - `server/ingestion.js:134` executes `DELETE FROM property_transactions WHERE project_id = ?` whenever a project appears in a sales batch.
   - If an incremental sync or single batch contains only recent transactions, all prior historical transactions for that development are wiped.
3. **Unbounded Rental Requests:**
   - `server/ingestion.js:341` executes median rental queries using raw Axios calls without `fetchWithRetry` backoff or timeout bounds.

#### Target Implementation
1. **Fix Transaction Hashing in [`server/ingestion.js`](server/ingestion.js):**
   - Incorporate project identity and street into hash inputs:
     ```javascript
     export function generateTxHash(projId, streetName, projName, dateStr, price, area, floorRange, occurrenceIndex = 1, noOfUnits = 1, propertyType = '', district = '') {
       const raw = `${projId}|${streetName || ''}|${projName}|${dateStr}|${price}|${area}|${floorRange || ''}|${occurrenceIndex}|${noOfUnits}|${propertyType || ''}|${district || ''}`;
       return crypto.createHash('md5').update(raw).digest('hex');
     }
     ```
   - Apply matching fix to `generateRentHash` with `projId` and `streetName`.
2. **Safe Scoped Replacement Strategy:**
   - Never execute unconditional `DELETE FROM property_transactions WHERE project_id = ?`.
   - Instead, scope deletions by explicit contract date window matching the incoming batch:
     ```javascript
     // Delete only within the exact date/quarter scope represented in the validated batch
     await conn.run(
       'DELETE FROM property_transactions WHERE project_id = ? AND contract_date BETWEEN ? AND ?',
       [projId, minBatchDate, maxBatchDate]
     );
     ```
   - Validate incoming payload in memory first. If payload is empty or invalid, abort deletion and preserve existing data.
3. **Bounded Network Client:**
   - Route all external HTTP calls in `ingestion.js` (including median rentals and token refresh) through `fetchWithRetry` with 30s timeout and exponential backoff.
4. **Explicit Connection Injection:**
   - Update `fetchUraData`, `importRealUraData`, and `seedSoraRates` to accept an optional `conn` object, ensuring they operate on rebuild or staging databases without ambient `DB_PATH` leaks.

---

### Track 5: Safe End-to-End Database Rebuild Architecture (GL-01)
**Goal:** Lift the Phase 0 quarantine on `server/scripts/rebuild-clean-db.js` with an atomic, isolated rebuild engine featuring connection injection, complete schema preservation, and verified rollback.

#### Technical Diagnosis
- Quarantined in Phase 0 due to mutating `process.env.DB_PATH` after module loading.
- Accepted `partial_success` results from URA sync.
- Restored `leads` using a hardcoded column list, dropping Migration 008 columns (`last_confirmation_sent_at`, `last_newsletter_sent_at`).
- Used uncoordinated file swap without ensuring WAL truncation or verified rollback.

#### Target Implementation
1. **Un-quarantine & Refactor [`server/scripts/rebuild-clean-db.js`](server/scripts/rebuild-clean-db.js):**
   - Remove the hard-abort quarantine block.
   - Require explicit exclusive lock: Check that no other process holds an active write lock on `property.db`.
2. **Connection Injection (No Ambient Env Mutation):**
   - Build target database in an isolated temporary file: `property.db.rebuild.<timestamp>`.
   - Pass `rebuildConn` directly into `runMigrations(rebuildConn)`, `fetchUraData(accessKey, rebuildConn)`, `seedAmenities(rebuildConn)`, etc.
3. **Dynamic Operational State Preservation:**
   - Introspect `leads`, `schema_migrations`, and `job_history` dynamically:
     ```javascript
     const leads = await liveConn.all('SELECT * FROM leads');
     // Re-insert using dynamic column mappings so all future migration columns are preserved
     ```
4. **Strict Pre-Swap Verification Gates:**
   - Rebuild script MUST NOT swap unless all gates pass:
     - `PRAGMA integrity_check` returns `ok`.
     - `PRAGMA foreign_key_check` returns 0 rows.
     - `SELECT COUNT(*) FROM projects` >= 5,500.
     - `SELECT COUNT(*) FROM property_transactions` >= 130,000.
     - `SELECT COUNT(*) FROM rental_transactions` >= 440,000.
     - `Status` from URA ingestion is strictly `Success` (zero partial errors).
5. **Atomic File Swap & Checkpoint Lifecycle:**
   - Flush WAL: `PRAGMA wal_checkpoint(TRUNCATE);` and close all rebuild handles cleanly.
   - Atomic rename:
     1. Move `property.db` -> `property.db.bak.<timestamp>`
     2. Move `property.db.rebuild.<timestamp>` -> `property.db`
   - Re-open new `property.db` and execute validation query.
   - If validation fails, immediately restore `property.db.bak.<timestamp>` -> `property.db` (automatic verified rollback).

---

### Track 6: Test Isolation, Regression Suite & Exit Gate Evidence (GL-16)
**Goal:** Establish central test isolation and automated regression suites validating Phase 1 exit gates.

#### Technical Implementation
1. **Central Test Isolation Harness (`server/tests/setup.js`):**
   - Provide clean environment isolation before any module import.
   - Use dedicated disposable temp database per test file or test case.
2. **New Dedicated Test Suites:**
   - `server/tests/startup.test.js`:
     - 20 consecutive fresh-disk startups on disk files without `SQLITE_BUSY`.
     - Concurrent multi-process startup race conditions.
     - Recovery from interrupted migrations.
   - `server/tests/ingestion-identity.test.js`:
     - Same project name on different streets creates separate projects and transactions without collision.
     - Legitimate duplicate transactions with identical price/area/date preserved.
     - Partial sync does not wipe out-of-scope historical transactions.
   - `server/tests/scheduler.test.js`:
     - Job lock acquisition and lease expiration.
     - Double-execution prevention.
     - Deploy-time no-op verification.
   - `server/tests/rebuild.test.js`:
     - End-to-end rebuild execution on disposable database.
     - Injected provider failure triggers rollback with original database intact.
     - Complete preservation of all `leads` columns including Migration 008.

---

## 3. Step-by-Step Implementation Roadmap (Day-by-Day)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           6-DAY ENGINEERING EXECUTION ROADMAP                    │
├───────┬──────────────────────────────────────────────────────────────────────────┤
│ Day 1 │ Track 1: Upgrade Node 22 LTS, pin PM2, align CI & Dockerfiles             │
│       │ Track 2: Refactor server/db.js connection lifecycle & PRAGMA ordering    │
├───────┼──────────────────────────────────────────────────────────────────────────┤
│ Day 2 │ Track 2: Migration transaction locking & startup barrier in server/index │
│       │ Track 6: Implement 20x fresh-disk startup test & concurrent start tests  │
├───────┼──────────────────────────────────────────────────────────────────────────┤
│ Day 3 │ Track 4: Fix generateTxHash / generateRentHash street identity           │
│       │ Track 4: Implement scoped non-destructive batch updates in ingestion.js  │
├───────┼──────────────────────────────────────────────────────────────────────────┤
│ Day 4 │ Track 3: Create Migration 009 (job_locks/history) & server/scheduler.js  │
│       │ Track 3: Implement atomic lease runner and Singapore cron scheduling     │
├───────┼──────────────────────────────────────────────────────────────────────────┤
│ Day 5 │ Track 5: Refactor server/scripts/rebuild-clean-db.js with connection     │
│       │          injection, dynamic lead preservation & atomic swap rollback     │
├───────┼──────────────────────────────────────────────────────────────────────────┤
│ Day 6 │ Track 6: Execute full exit gate rehearsal on Linux target image           │
│       │ Compile Phase 1 Completion Report and verify all gate criteria           │
└───────┴──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Phase 1 Exit Gate Verification Matrix

| Gate ID | Exit Criterion | Verification Command / Target Evidence | Success Threshold |
| :--- | :--- | :--- | :--- |
| **G1-1** | **Fresh-disk startup reliability** | Run 20 consecutive fresh disk starts: `node audit/2026-10-02/startup-check.mjs` (updated for 20 runs) | **20/20 pass**, 0 `SQLITE_BUSY` errors |
| **G1-2** | **Migration concurrency** | 5 concurrent Node processes starting against empty database simultaneously | Deterministic execution, 0 lock aborts, 1 winner executes migrations, others await |
| **G1-3** | **Street identity deduplication** | Run same-name different-street fixture (`AUDIT SAME NAME` on Alpha vs Beta Road) | Both projects have their respective transactions; **0 transactions lost** |
| **G1-4** | **Non-destructive scoped sync** | Ingest partial batch containing only 1 quarter of data for an existing project | Pre-existing quarters outside the batch are **100% preserved** |
| **G1-5** | **Rebuild isolation & swap** | Execute rebuild with connection injection; inject simulated network failure at Step 5 | Source database logically identical; target cleaned up; **0 data loss** |
| **G1-6** | **Lead state preservation** | Rebuild test on database with Migration 008 lead columns and cooldowns | All columns (`last_confirmation_sent_at`, etc.) **100% restored** |
| **G1-7** | **Scheduler deploy independence** | Deploy / start web service with scheduler daemon configured | Zero jobs execute on startup; scheduled jobs trigger only at due time |
| **G1-8** | **Runtime & CI build** | Run `npm test`, `npm run build`, and `docker build` on Node 22 | Clean pass across all suites; 0 audit vulnerabilities |

---

## 5. Risk Assessment & Rollback Playbook

| Risk Event | Severity | Probability | Mitigation Strategy | Rollback Action |
| :--- | :--- | :--- | :--- | :--- |
| **Schema hash incompatibility** | High | Low | If `raw_hash` calculation changes, existing rows retain older hashes while new rows use street-prefixed hashes. | Retain hash migration helper or recalculate hashes via versioned migration. |
| **SQLite WAL file locking on Windows** | Medium | Medium | SQLite on Windows can lock files if connections remain unclosed. Ensure `conn.close()` in all `finally` blocks and enforce `busy_timeout = 10000`. | Revert to single shared serialized connection if multi-connection pool encounters persistent Windows locking. |
| **Scheduler overlapping runs** | Medium | Low | Long-running URA sync could exceed schedule interval. | SQLite-backed `job_locks` with 15-minute lease enforces mutual exclusion. |
| **Rebuild disk space exhaustion** | Low | Low | Building full duplicate database requires ~500MB free disk space. | Rebuild script checks available disk space (> 2GB free) before starting. |

---

## 6. Document Sign-Off & Approvals

- **Prepared By:** Backend & Platform Engineering Lead
- **Reviewed By:** Release Owner & Product Lead
- **Status:** **Ready for Execution**
