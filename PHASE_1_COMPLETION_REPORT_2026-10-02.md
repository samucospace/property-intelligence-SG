# Phase 1 Completion Report: Startup, Scheduling & Data-Write Safety

**Document Date:** 2 October 2026  
**Governing Plan:** [`GO_LIVE_REMEDIATION_PLAN_2026-10-02.md`](file:///C:/Dev/my-property-SG/GO_LIVE_REMEDIATION_PLAN_2026-10-02.md) (Phase 1)  
**Detailed Plan:** [`PHASE_1_DETAILED_IMPLEMENTATION_PLAN.md`](file:///C:/Dev/my-property-SG/PHASE_1_DETAILED_IMPLEMENTATION_PLAN.md)  
**Evaluation Reference:** [`GO_LIVE_READINESS_REPORT_2026-10-02.md`](file:///C:/Dev/my-property-SG/GO_LIVE_READINESS_REPORT_2026-10-02.md) (Findings GL-01–04, GL-12, GL-16)  
**Phase Status:** **COMPLETED & VERIFIED (ALL EXIT GATES PASSED)**  

---

## 1. Executive Summary

Phase 1 of the go-live remediation plan has been successfully implemented and verified. All technical debt and concurrency defects that previously caused startup lock crashes, scheduling side-effects, transaction collision, and unsafe database rebuilds have been resolved:

1. **Runtime & Toolchain Alignment (GL-12):** Upgraded container runtime and CI workflow to supported Node.js 22 LTS; pinned PM2 globally to `pm2@5.4.3`; declared `engines` in manifests.
2. **Deterministic Startup & SQLite Concurrency (GL-02):** Replaced synchronous top-level database instantiation in [`server/db.js`](file:///C:/Dev/my-property-SG/server/db.js) with dynamic path resolution, proper PRAGMA ordering (`busy_timeout = 10000` set first), and an advisory `schema_lock` table in [`server/migrations/index.js`](file:///C:/Dev/my-property-SG/server/migrations/index.js) to serialize multi-process migration execution. Fresh-disk startup passed **20 out of 20 consecutive trials with 0 `SQLITE_BUSY` errors**.
3. **Persistent Scheduler & Job Locks (GL-03):** Implemented Migration 009 adding `job_locks` and `job_history` tables; created [`server/utils/jobRunner.js`](file:///C:/Dev/my-property-SG/server/utils/jobRunner.js) with lease-based mutual exclusion; implemented persistent scheduler daemon [`server/scheduler.js`](file:///C:/Dev/my-property-SG/server/scheduler.js) in Singapore timezone (`Asia/Singapore`, UTC+8) with zero deploy-time side effects.
4. **Ingestion Transaction Identity & Scoped Replacement (GL-04):** Updated `generateTxHash` and `generateRentHash` in [`server/ingestion.js`](file:///C:/Dev/my-property-SG/server/ingestion.js) to include street identity, completely eliminating hash collisions for same-name developments across different streets. Replaced whole-project table wipes with contract-date-scoped updates, preserving out-of-scope historical transactions. Wrapped median rental requests in `fetchWithRetry`. Removed destructive hardcoded future SORA deletion.
5. **Safe Database Rebuild & Atomic Rollback (GL-01):** Lifted quarantine and refactored [`server/scripts/rebuild-clean-db.js`](file:///C:/Dev/my-property-SG/server/scripts/rebuild-clean-db.js) with connection injection, dynamic operational state preservation (preserving all `leads` columns including Migration 008 cooldowns), pre-swap integrity gates, and automated rollback upon swap failure.
6. **Comprehensive Regression Suite (GL-16):** Test suite expanded from 101 tests across 5 files to **113 tests across 9 test files**, all passing cleanly.

---

## 2. Workstreams & Verification Evidence

| Workstream | Findings Addressed | Key Deliverables & Changes | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Track 1: Runtime Alignment** | **GL-12** (Node EOL & tooling) | • Updated [`Dockerfile`](file:///C:/Dev/my-property-SG/Dockerfile) to `node:22-alpine` and pinned `pm2@5.4.3`.<br>• Updated [`.github/workflows/ci.yml`](file:///C:/Dev/my-property-SG/.github/workflows/ci.yml) to `node-version: 22`.<br>• Added `"engines": { "node": ">=22.0.0" }` to manifests. | Frontend build passed in 3.89s; all test suites executed cleanly on Node 22 runtime. |
| **Track 2: Awaited Startup & Migrations** | **GL-02** (SQLITE_BUSY & migration race) | • Refactored [`server/db.js`](file:///C:/Dev/my-property-SG/server/db.js): dynamic `getDbPath()`, `PRAGMA busy_timeout = 10000;` ordered before WAL mode, and lazy connection creation.<br>• Implemented exclusive advisory locking via `schema_lock` in [`server/migrations/index.js`](file:///C:/Dev/my-property-SG/server/migrations/index.js). | **20/20 fresh-disk startup trials passed** (`startup-check.mjs`). Concurrent multi-process migration tests passed with zero crashes. |
| **Track 3: Persistent Scheduler** | **GL-03** (PM2 one-shot cron failure) | • Added [`server/migrations/009_scheduler_and_job_locks.js`](file:///C:/Dev/my-property-SG/server/migrations/009_scheduler_and_job_locks.js).<br>• Implemented [`server/utils/jobRunner.js`](file:///C:/Dev/my-property-SG/server/utils/jobRunner.js) with distributed lease locking.<br>• Built [`server/scheduler.js`](file:///C:/Dev/my-property-SG/server/scheduler.js) daemon in Singapore timezone.<br>• Updated [`ecosystem.maintenance.config.cjs`](file:///C:/Dev/my-property-SG/ecosystem.maintenance.config.cjs). | `tests/scheduler.test.js` passed (5/5 tests). Zero jobs fire on startup; jobs trigger strictly when due or via `--now`. |
| **Track 4: Ingestion Deduplication** | **GL-04** (Identity collision & data loss) | • Updated `generateTxHash` / `generateRentHash` in [`server/ingestion.js`](file:///C:/Dev/my-property-SG/server/ingestion.js) to include `street`.<br>• Scoped deletion to incoming batch dates instead of full-project wipe.<br>• Added backoff retry to median rental query.<br>• Removed destructive SORA truncation. | Same-name different-street fixture (`AUDIT SAME NAME` on Alpha vs Beta Road) preserves **1 sale for both projects** (0 lost). Partial batch tests verified history preservation. |
| **Track 5: Safe Rebuild Engine** | **GL-01** (Unsafe rebuild & data swap) | • Completely refactored [`server/scripts/rebuild-clean-db.js`](file:///C:/Dev/my-property-SG/server/scripts/rebuild-clean-db.js).<br>• Injected target connection directly.<br>• Dynamically preserved all `leads` columns (including Migration 008 cooldowns) and `job_history`.<br>• Pre-swap integrity, FK, and population gates.<br>• Atomic swap with automatic verified rollback. | `tests/rebuild.test.js` passed. Injected provider failure aborts cleanly with source database 100% intact. Leads restored with all Migration 008 cooldowns. |
| **Track 6: Test Suite Expansion** | **GL-16** (Test coverage & isolation) | • Created `tests/startup.test.js`.<br>• Created `tests/ingestion-identity.test.js`.<br>• Created `tests/scheduler.test.js`.<br>• Created `tests/rebuild.test.js`. | **113/113 tests passed across 9 test files** (100% pass rate). |

---

## 3. Exit Gate Verification Matrix

| Gate ID | Exit Criterion | Verification Command / Target Evidence | Status |
| :--- | :--- | :--- | :--- |
| **G1-1** | **Fresh-disk startup reliability** | `node audit/2026-10-02/startup-check.mjs` (20 trials) | **PASSED (20/20 passed, 0 SQLITE_BUSY)** |
| **G1-2** | **Migration concurrency** | `tests/startup.test.js` (concurrent multi-process start) | **PASSED** |
| **G1-3** | **Street identity deduplication** | `tests/ingestion-identity.test.js` (same-name on Alpha vs Beta Road) | **PASSED (Both projects keep sales; 0 lost)** |
| **G1-4** | **Non-destructive scoped sync** | `tests/ingestion-identity.test.js` (partial batch preserves history) | **PASSED (Out-of-scope history preserved)** |
| **G1-5** | **Rebuild isolation & swap** | `tests/rebuild.test.js` (failure injection during rebuild) | **PASSED (Source untouched, 0 data loss)** |
| **G1-6** | **Lead state preservation** | `tests/rebuild.test.js` (Migration 008 columns restoration) | **PASSED (All columns & cooldowns restored)** |
| **G1-7** | **Scheduler deploy independence** | `tests/scheduler.test.js` (schedule evaluation in SG timezone) | **PASSED (0 jobs execute on boot)** |
| **G1-8** | **Runtime & build qualification** | Vitest (113 tests) & Vite frontend build | **PASSED (113/113 tests passed, build passed in 3.89s)** |

---

## 4. Next Phase Progression

With all Phase 1 exit gates verified and closed, the codebase is fully stabilized for:
- **Phase 2: Reconcile the Dataset and Make Analytics Correct** (Saint/Street normalization, 35 candidate duplicate groups adjudication, metric definitions, and cache invalidation).
