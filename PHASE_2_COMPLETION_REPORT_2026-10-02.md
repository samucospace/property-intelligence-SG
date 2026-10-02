# Phase 2 Completion Report: Dataset Reconciliation & Analytics Hardening

**Document Version:** 1.0.0  
**Date:** 2 October 2026  
**Parent Remediation Plan:** [`GO_LIVE_REMEDIATION_PLAN_2026-10-02.md`](file:///c:/Dev/my-property-SG/GO_LIVE_REMEDIATION_PLAN_2026-10-02.md)  
**Implementation Plan:** [`PHASE_2_IMPLEMENTATION_PLAN.md`](file:///C:/Users/samfr/.gemini/antigravity/brain/dbe8ab1e-babe-44c1-8cf4-44879c305d6f/PHASE_2_IMPLEMENTATION_PLAN.md)  
**Git Commit:** `0f44704` (`feat(phase-2): reconcile dataset, normalize street identity, and fix analytics query engine`)  
**Status:** **COMPLETE & VERIFIED** (All 8 Exit Gates Satisfied)  

---

## 1. Executive Summary

Phase 2 focused on **data integrity, spatial accuracy, and analytical correctness** across the Singapore Home Intel platform, resolving vulnerabilities identified in findings **GL-04, GL-05, GL-06, GL-07, and GL-08**.

### Key Outcomes
1. **Zero Transaction Loss:** Maintained 100% data parity across the database: exactly **133,418 sales caveats** and **450,722 rental leases** (**584,140 total transactions**) preserved without a single drop or orphan.
2. **Project Deduplication:** Resolved the regex bug where `ST.` expanded to `STREET.` instead of `SAINT`. Successfully merged all **35 candidate duplicate groups** (70 project rows into 35 canonical rows) and reassigned 427 sales and 1 rental lease under atomic foreign key integrity.
3. **Planning Area Cataloging:** Cleaned 3,379 invalid or generic planning areas (`"Central"` and road names) to `NULL`, implementing fallback formatting to descriptive postal districts (e.g. `"District 09 (Orchard / River Valley)"`).
4. **Headline Gross Rental Yield:** Implemented product-approved **Option A** (development-level gross yields for projects with $\ge 3$ transactions in window; headline reports median of project yields).
5. **Spatial Truth & Livability Quarantine:** Quarantined livability scoring on all 200 `district_centre` approximate coordinate developments (`livability_score = NULL`, labeled `"Location approximate"`).
6. **Query Engine & Cache Freshness:** Integrated SQLite `PRAGMA data_version` cache invalidation across worker processes, added deterministic SQL pagination (`LIMIT ? OFFSET ?`), removed the silent 200 radius cap, and synchronized unit size/type filters.

---

## 2. Quantitative Baseline & Parity Verification

| Metric | Pre-Phase 2 Baseline | Post-Phase 2 Baseline | Delta | Status |
|---|---|---|---|---|
| **Total Projects** | 5,938 | 5,903 | -35 | Verified (35 redundant duplicates merged) |
| **Sales Caveats (`property_transactions`)** | 133,418 | 133,418 | 0 | **100% Invariant Parity** |
| **Rental Leases (`rental_transactions`)** | 450,722 | 450,722 | 0 | **100% Invariant Parity** |
| **Total Transactions Accounted For** | 584,140 | 584,140 | 0 | **Zero Data Loss** |
| **Orphaned Transactions** | 0 | 0 | 0 | Passed (`PRAGMA foreign_key_check`: 0 errors) |
| **Misclassified Non-Landed Aggregates** | 1 | 0 | -1 | Repaired (`is_landed_aggregate = 0`) |
| **Invalid Planning Areas Cleaned** | 3,379 | 0 | -3,379 | Standardized to URA 55 boundary list or NULL |
| **Quarantined Approximate Livability** | 0 | 200 | +200 | Quarantined (`livability_score = NULL`) |
| **24-Month Rolling Benchmarks** | ~3,200 | 3,223 | +23 | Refreshed with consolidated caveats |

---

## 3. Workstream Execution Details

### Workstream A: Street Identity & Project Deduplication (GL-04, GL-05)
- **Regex Rectification ([`server/utils/streetUtils.js`](file:///c:/Dev/my-property-SG/server/utils/streetUtils.js)):**
  Replaced unconditional `\bST\b` replacement with contextual prefix handling. Strings matching `(^|[\s/])(STREET\.|ST\.)\s*` or `(^|[\s/])ST\s+` before street names expand to `SAINT` (e.g. `ST. PATRICK'S ROAD` $\to$ `SAINT PATRICK'S ROAD`), while legitimate `STREET` suffixes (e.g. `CHURCH STREET`, `HIGH STREET`) remain untouched.
- **Landed Development Classification:**
  Updated `isLandedDevelopment` to guard against `"NON-LANDED"` strings and evaluate both project name and property type for landed keywords.
- **Atomic Migration ([`server/migrations/010_reconcile_duplicate_projects.js`](file:///c:/Dev/my-property-SG/server/migrations/010_reconcile_duplicate_projects.js)):**
  - Scanned and grouped projects by `UPPER(project_name) | normalized_street`.
  - Identified 35 duplicate pairs split by the regex bug.
  - Selected canonical master (preferring SVY21 cadastral coordinates, then transaction volume).
  - Reassigned foreign keys in `property_transactions` and `rental_transactions`.
  - Deleted redundant rows and refreshed `project_benchmarks`.

### Workstream B: Planning Area Fallback & Spatial Truth (GL-05, GL-08)
- **Planning Area Normalization ([`server/utils/geo.js`](file:///c:/Dev/my-property-SG/server/utils/geo.js)):**
  Created `DISTRICT_DESCRIPTIONS` dictionary mapping Singapore postal districts 01–28 to recognized neighborhood clusters. Built `formatPlanningAreaFallback(planningArea, district)` to return official URA Master Plan planning areas where valid, falling back to descriptive districts (e.g., `"District 09 (Orchard / River Valley)"`) rather than legacy generic `"Central"`.
- **Livability Quarantine ([`server/livabilityEngine.js`](file:///c:/Dev/my-property-SG/server/livabilityEngine.js)):**
  Updated `precomputeAllProjectLivability` to skip projects where `geo_source === 'district_centre'`. Updated `getGradeLabel` to emit `"Location approximate"` whenever location quality is approximate.

### Workstream C: Query Engine Hardening & Cache Synchronization (GL-04, GL-06, GL-07)
- **Cross-Process Cache Refresh ([`server/queryEngine.js`](file:///c:/Dev/my-property-SG/server/queryEngine.js)):**
  Implemented `syncCacheWithDataVersion(conn)` using SQLite `PRAGMA data_version`. External writes committed by background sync or maintenance workers are detected on subsequent API requests, evicting stale in-memory query caches and reloading valuation medians.
- **Deterministic SQL Pagination:**
  Refactored `getPriceAnalytics` scatter query to accept `LIMIT ? OFFSET ?` with sanitized `page` (min 1) and `limit` (max 500), returning mutually disjoint transaction sets, `totalPages`, and `totalCount`.
- **Radius Query Completeness:**
  Removed the silent `maxProjects = 200` cap in `getMatchingProjectIdsByRadius`, allowing full density scans within the requested radius.
- **Rental Yield Option A Formula & Filters:**
  Harmonized rental queries with `unitSizeMin`, `unitSizeMax`, and `unitType` filters. Replaced distorted arithmetic division with Option A: computing project-level gross yields for developments with $\ge 3$ transactions in the window, and taking the median of those development yields for the headline figure.

---

## 4. Test Suite & Verification Results

All unit and integration tests passed cleanly across the test suite:

```
Test Files  11 passed (11)
     Tests  132 passed (132)
  Duration  1.66s
```

### Key Test Coverage Breakdown
- **[`server/tests/phase2_analytics_reconciliation.test.js`](file:///c:/Dev/my-property-SG/server/tests/phase2_analytics_reconciliation.test.js) (12/12 Passed):**
  - `T-P2-01`: Street name normalization regex & landed detection (Saint vs Street).
  - `T-P2-02 & T-P2-03`: Deduplication, foreign key integrity, non-landed aggregate flag repair, and planning area cleaning.
  - `T-P2-04`: Planning area fallback logic with district descriptions.
  - `T-P2-05`: Price analytics scatter pagination disjointness across pages 1, 2, and 3.
  - `T-P2-06`: Rental yield unit size and bedroom filter consistency.
  - `T-P2-07`: Option A headline median gross yield formula calculation.
  - `T-P2-08`: Radius project matching beyond 200 projects without truncation.
  - `T-P2-09`: Livability quarantine for `district_centre` approximate projects.
  - `T-P2-10`: Cross-process cache invalidation via SQLite `PRAGMA data_version`.
- **[`server/tests/streetUtils.test.js`](file:///c:/Dev/my-property-SG/server/tests/streetUtils.test.js) (7/7 Passed):**
  - Saint expansion, street suffix preservation, whitespace normalization, and non-landed guards.
- **Production Client Build (`npm --prefix client run build`):**
  - Built cleanly in 3.60s without bundling or syntax errors.

---

## 5. Exit Gate Acceptance Sign-off

| Exit Gate | Acceptance Criteria | Result | Evidence |
|---|---|---|---|
| **Gate 2.1** | Foreign key integrity check returns 0 errors | **PASSED** | `PRAGMA foreign_key_check` executed on live DB: 0 errors |
| **Gate 2.2** | Transaction count parity invariant (584,140 transactions) | **PASSED** | 133,418 sales + 450,722 rentals exactly preserved |
| **Gate 2.3** | 35 duplicate candidate groups consolidated | **PASSED** | 35 redundant project rows cleanly pruned (5,938 $\to$ 5,903) |
| **Gate 2.4** | Non-landed and planning area cataloging repaired | **PASSED** | 1 misflagged project repaired; 3,379 invalid entries cleaned |
| **Gate 2.5** | Cross-process cache freshness | **PASSED** | `PRAGMA data_version` triggers automatic cache flush on external writes |
| **Gate 2.6** | Deterministic disjoint scatter pagination | **PASSED** | SQL `LIMIT ? OFFSET ?` verified non-overlapping across pages |
| **Gate 2.7** | Radius query completeness | **PASSED** | Truncation cap removed; 250+ project spatial query verified |
| **Gate 2.8** | Option A headline gross yield & spatial transparency | **PASSED** | Median of project yields ($\ge 3$ tx); approx coords quarantined |

---

## 6. Readiness for Phase 3

With Phase 2 successfully completed, the data store and core query engines are now robust and mathematically consistent. The project is fully prepared to enter **Phase 3: Automated Sync Hardening & Pipeline Resilience (GL-09, GL-10, GL-11, GL-12, GL-13)**:

- **Next Phase Targets:**
  - Token bucket rate limiter for OneMap API (`ONEMAP_MAX_RPS = 2`).
  - Idempotent multi-batch URA sync with retry backoff and checksum comparison.
  - Incremental sync boundary logic preventing redownload of historical batches.
  - Automated database backup verification before pipeline execution.
