# Independent review of remediation Phases 0–2 — 2 October 2026

**Subsequent Phase 1 corrections:** this is the historical pre-correction audit. Atomic migration rollback, non-destructive imports, durable job slots/leases and fixture rebuild recovery have since been repaired and verified on Node 22.23.3; the suite now passes 161/161. See [the corrected Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md) for current evidence and remaining image/source/operational gates. The reproduced Phase 1 failures below describe the audited implementation, not the corrected code. Phase 2 findings remain open.

**Subsequent Phase 0 corrections:** this document records the pre-correction audit. Containment, sender isolation, durable local recovery and test isolation have since been corrected; the current isolated suite passes 142/142. See [the revised Phase 0 report](PHASE_0_COMPLETION_REPORT_2026-10-02.md). Phase 1 corrections are documented above; Phase 2 findings remain open. Do not treat historical failures here as a claim about the newly corrected controls.

**Verdict:** Meaningful implementation progress, but the documentation overstates completion. Phase 0 is partially evidenced; Phases 1 and 2 have reproduced failures and should be reopened. The governing release decision remains **NO-GO**. Neither the full product nor the proposed read-only alternative has satisfied its release gates.

## Review scope and evidence

Reviewed the governing readiness report and remediation plan, Phase 0 governance and completion documents, Phase 1/2 detailed plans and completion reports, operational inventory, relevant source/tests/configuration, and existing recovery artifacts. Assessed working-tree HEAD `8759f7e`, including implementation commits `5b0f1f9`, `358b5ab`, and `0f44704`.

Current market, baseline, restored and staging databases were opened **read-only**. Mutation probes, rebuilds and startup exercises used disposable databases under `audit/2026-10-02/phase-validation-fixtures`. No provider calls or outbound emails were needed. Application implementation and historical reports were not changed.

Evidence labels:

- **Reproduced:** independently exercised during this review.
- **Code-confirmed:** visible in implementation; the operational failure was not induced.
- **Unverified:** approval, external source reconciliation, off-host recovery, deployment or other evidence is still needed.

Verification ran on Windows using bundled **Node v24.19.0**, not the declared Node 22 Alpine release image. The Docker daemon was unavailable. Local successes do not establish target-image qualification. The available package tools were invoked directly because `npm` was not on this session's PATH.

## Documentation alignment

The detailed plans generally expand the governing workstreams appropriately. The completion reports, however, replace the original acceptance gates with weaker subsets and then declare all gates passed.

| Document issue | Assessment and correction |
|---|---|
| Phase 2's next-phase description | Its section 6 changes Phase 3 to “Automated Sync Hardening & Pipeline Resilience,” with OneMap throttling and incremental sync. The governing Phase 3 is **email, consent, access and recovery**. Restore that scope; record pipeline follow-up work separately. GL-09–13 cannot be closed by those sync tasks. |
| Gate narrowing | Phase 0 omits off-host/key custody evidence; Phase 1 omits target-image qualification, complete-response validation and interruption/restart guarantees; Phase 2 substitutes count parity for source reconciliation and omits cross-surface/historical metric validation. Carry forward every governing gate verbatim, with evidence and unresolved portions. |
| Approval and accountability | Governance says “APPROVED,” “signed off,” and “named owners,” but names only roles such as Engineering/Product Lead. Phase 2 similarly records product approval without an attributable approval record. This does not prove the decisions were unauthorized, but approval evidence and named accountable people are absent from these artifacts. |
| Read-only scope | A documented choice is not a tested implementation. Lead capture, submission, admin lead access and direct email paths remain available. Document server-side and UI disabling criteria plus existing-data protection. |
| Phase 2 source identity evidence | The planned `server/migrations/data/project_adjudication_map.json` is absent. Migration 010 groups and chooses masters automatically; no per-group source evidence or approved mapping is consumed. Counts/FKs cannot prove every merge is semantically correct. |
| Reconciliation scope | The planned `scripts/reconcile-dataset.js` is absent. Baseline preservation can be verified locally, but validation against complete external source batches, identities and multiplicities is not evidenced. |
| Contradictory numbers | Phase 2's detailed plan predicts 842 sales and 3,647 rentals reassigned; the report claims 427 and 1. Independent comparison supports **427 and 1**. Explain the distinction between affected-group population and actual reassignment. Benchmarks fell **3,291 → 3,223 (-68)**; the completion report's approximate baseline and “+23” obscure that actual change. |
| Artifact references | Phase 2 links to a private developer `C:/Users/.../.gemini/.../PHASE_2_IMPLEMENTATION_PLAN.md`, rather than the checked-in detailed plan. Replace machine-specific `file:///` links with portable repository references. |
| Provenance and canonical docs | The UI, README and specification retain walking/verified-amenity claims. The specification's metric/provenance contract has not been reconciled with the implementation. Phase 2's checked gate for truthful features is premature. |

Historical containment statements, such as Phase 0's rebuild quarantine, can remain historical. They need a dated status record showing that quarantine was lifted in Phase 1 and that rebuild safety is now disputed. Do not interpret a historical green checkbox as current evidence.

## What independently checks out

### Database preservation and catalog state

| Metric | Baseline | Current | Independent result |
|---|---:|---:|---|
| Projects | 5,938 | 5,903 | 35 fewer project rows |
| Sales | 133,418 | 133,418 | Exact preservation |
| Rentals | 450,722 | 450,722 | Exact preservation |
| Total transactions | 584,140 | 584,140 | Exact preservation |
| Project benchmarks | 3,291 | 3,223 | Recomputed table; -68 rows |
| Approximate projects with stored scores/data | — | 0 of 200 | Both fields withheld |
| Misflagged `NON-LANDED` projects | — | 0 | Current defect repaired |

SQLite integrity checks returned `ok`; foreign-key checks returned no violations for current, baseline, restored and staging files.

Beyond counts, compared **every transaction column except `project_id`** in both directions against the baseline: zero additions, removals or changed rows. Exactly **427 sales and one rental** changed project ownership. Sales value totals remained **S$315,079,118,793**; rental value totals remained **S$2,329,672,020**. This strongly supports migration preservation, but does not establish external source completeness or correct adjudication of every merged identity.

The baseline and existing restored file have equal SHA-256 hashes. This confirms byte-for-byte equality of those artifacts; it does not establish a repeatable encrypted off-host restore with retained keys.

### Startup, build and targeted fixes

- **20/20 fresh application starts** passed locally; **five concurrent Node migration processes** passed; one additional existing-database initialization passed.
- The frontend production build passed in **4.29 seconds**, with a **919 kB JavaScript bundle** and the existing large-chunk warning.
- Docker/CI declare Node 22; Docker pins PM2 to `5.4.3`.
- Street-aware sales/rental hashes and the Saint/Street normalization changes are present. Existing collision fixtures pass.
- Price scatter pagination has SQL `LIMIT/OFFSET` and a transaction-ID tie-breaker; the existing disjoint-page test passes.
- Radius matching no longer applies the 200-project cap; the existing 250-project fixture passes.
- Cross-connection `PRAGMA data_version` invalidation is implemented and its fixture passes. This is narrower than a deployed HTTP freshness bound for every cache and surface.
- Web and maintenance process configurations are separated; startup lead cleanup defaults to disabled.

## Failures and unsupported completion claims

### 1. Rebuild still writes outside its target — release blocker

**Reproduced.** `rebuild-clean-db.js:163` calls `seedAmenities(rebuildConn)`, but `livabilityEngine.js:115` accepts a boolean `forceRefresh` and opens the primary database itself. The connection object is treated as a truthy force-refresh flag.

On disposable, fully initialized databases, rebuilding a different target inserted **399 amenities into the primary database**, while the successfully swapped candidate contained **zero amenities**. Thus “target-only writes” and “source logically unchanged until swap” are false. This is the same class of isolation defect the original plan required eliminating.

The existing suite, run with a clean isolated default database, reports **131 passed / 1 failed**, rather than 132/132. Its lead-preservation rebuild test fails with `SQLITE_ERROR: no such table: seed_versions`, because the leaked seeding connection reaches the unmigrated default database. A populated default database can hide this problem by accepting the unintended writes.

Additional **code-confirmed** gaps:

- Production population gates require only **1,000 projects and 10,000 sales**, with **no rental minimum**, versus the detailed plan's **5,500 / 130,000 / 440,000**. The zero-sales custom-provider fixture demonstrates a bypass intended for tests; the production gate weakness is established separately by code.
- Rebuild checks one HTTP port, permits `--force`, and has no database-wide maintenance lock fencing other writers/schedulers.
- Live checkpoint errors/results are ignored before moving the main file and deleting WAL/SHM files. The two-renames sequence has a process-crash window; exceptions in parts of that sequence fall outside the swap rollback block.
- Only leads and job history are preserved; preservation errors are downgraded to warnings. Full suppression/state preservation and verified rollback are not established.

**Required:** Recontain operational rebuilds; inject all writes, enforce exclusive maintenance and completeness contracts, preserve all required state, and test live-handle/WAL and interrupted-swap recovery on disposable databases.

### 2. Partial or malformed imports can erase good transactions — release blocker

**Reproduced.** The import deletes every existing sale for incoming project/month dates **before validating incoming amounts/areas** (`ingestion.js:428–458`). Starting with two valid sales in one month:

1. Importing one partial same-month sale leaves **one**, losing both previous sales.
2. Importing a same-month record with zero price leaves **zero**, with a returned success status.

The live sales path uses the same delete-before-validation pattern (`:159–190`). Its rental path deletes an entire quarter across all projects (`:275`) based on a nonempty response, without proof that the response is complete. Existing history tests cover a different month/year, not partial coverage within the replacement period.

Also **reproduced:** four empty sales batches and 24 empty rental-quarter responses returned `status: 'success'` and zero ingested rows. **Code-confirmed:** live ingestion increments totals before batch commit; a rolled-back batch can leave misleading totals, and `runJobWithLock` treats a returned partial-success object as a successful job unless it throws.

**Required:** Validate complete responses and explicit replacement scope before deleting; reject malformed/incomplete authoritative responses; prove same-period partial safety and replay multiplicity; count only committed writes and propagate partial/failure states honestly.

### 3. Migration 010 is not atomic or interruption-safe

**Reproduced.** Injected a failure on project deletion after ownership reassignment. The migration threw, but two transactions remained reassigned to the canonical project. No rollback restored the original ownership.

Neither Migration 010 nor the migration runner wraps these changes and the applied-migration record in a single transaction (`migrations/index.js:91–92`). The advisory schema lock controls concurrent runners, not atomicity. Its fixed 45-second stale-lock eviction also lacks a heartbeat/live-owner check. Database PRAGMA initialization callbacks discard errors (`db.js:38–48`), so the claimed error-handled initialization is incomplete.

**Required:** Make destructive migration changes and version recording atomic, test interruption and retry, and strengthen ownership/error handling. Successful ordinary concurrent starts do not close these separate requirements.

### 4. Sparse-sample and historical yield contracts are incomplete

**Reproduced.** A project with **one sale and three rentals** receives a sale benchmark of **S$2,000 psf** and a headline gross yield of **3%**. The current database has **1,262 benchmark rows** with fewer than three sales and a non-null sale psf estimate.

The headline only checks rental transaction count (`queryEngine.js:1042`); benchmark generation does not withhold sparse sales. The existing sparse fixture seeds one sale **and one rental**, so it passes by excluding the rental sample and fails to isolate the missing sales guard.

**Code-confirmed:** rental yields still use current rolling sale benchmarks rather than sale benchmarks matched to historical date/size/property filters. The Option A headline aggregation is implemented, but that alone does not harmonize valuation definitions across dashboard, drawer and email.

**Required:** Implement explicit sales and usable-rental sample thresholds, matched benchmark semantics or truthful current-benchmark labels, and independent fixtures for each surface, historical dates, size matching and missing psf values.

### 5. Rental pagination counts and date windows disagree

**Reproduced.** A fixture with six rentals across the selected wider window returns `totalCount: 3` and `totalPages: 3` at limit 1. Six rows actually match and need six pages.

The rental query calculates the correct filtered `countRow`, but returns the rolling-headline `summaryRow.total_count` (`queryEngine.js:1137`). Its map/yield calculation uses the selected window, while other summary metrics replace the selected start date with a rolling cutoff. In the probe, widening the selected window changed headline yield **3% → 1.8%**, while the reported total remained three. The rental order also lacks an ID tie-breaker, unlike the repaired price pagination.

**Required:** Return the matching count, agree/document separate headline and selected-window semantics, align outputs with that contract, and test date-boundary, same-date pagination and mixed filters independently.

### 6. Approximate-coordinate quarantine is bypassed by project detail

**Reproduced.** A `district_centre` project with null stored score/data receives **score 18, “Car Dependent”** from `getProjectLivability`.

The detail helper does not read `geo_source`; null stored values cause fallback calculation (`livabilityEngine.js:338–398`). `GET /api/projects/:id/livability` calls that helper directly (`index.js:651`). The existing quarantine test checks precomputed fields and project-list output, not this detail path.

**Required:** Enforce location-quality withholding at every calculation/API boundary and add a detail-route regression check.

### 7. Scheduler execution is not durable across restart

**Reproduced.** Two fresh daemon instances ticking the same harmless fake job in the same minute executed it **twice**, with two successful history entries. Completed slot identity lives only in `lastExecutedSlots`; completion releases the database job lock. A restart or second scheduler can reacquire and repeat the slot.

**Code-confirmed:** leases expire after 15 minutes without renewal, so a still-running job can lose exclusivity. Skipped jobs can be recorded as success. The tests exercise schedule predicates and sequential locks; they do not prove daemon restart, due-slot persistence, multi-worker completion or lease renewal.

**Required:** Persist unique job/slot claims, renew or fence long-running leases, represent skipped/partial outcomes correctly, and exercise restart/overlap and due-time staging runs.

### 8. Phase 0 email isolation and recoverability are only partial

**Code-confirmed:** `emailAdapter.js` exists but is not imported by the actual email paths. `index.js` and the newsletter script instantiate Resend directly. Consequently, `NODE_ENV=staging` or `MOCK_EMAIL=true` alone does not prevent outbound mail through those paths when a real key is present. The read-only charter also has no encompassing route/UI enforcement.

The staging database has **zero leads**, so the claimed sanitation verification does not demonstrate nonempty-PII handling. It remains at eight migrations, as does the original baseline; no target staging rehearsal of Phases 1/2 is evidenced.

**Code-confirmed:** `baseline-drill.js:111` generates an in-memory random encryption key used for the immediate decrypt at `:125`, without persisting it separately. The drill proves an immediate round trip, not recovery of that encrypted artifact after the process ends. The existing plaintext baseline and restored copy remain usable. Durable key custody, an off-host encrypted copy and a fresh-process restore are **unverified**.

**Required:** Wire the fake transport into every sender and enforce staging credentials/isolation; test nonempty sanitation; retain recovery keys separately and prove a new-process off-host restore without overwriting the original baseline.

### 9. Provenance and UI disclosure work is unfinished

**Code-confirmed:** UI text still advertises “walkable livability indices” (`client/src/App.jsx:678`) and “walking distance rings” (`components/PropertyMap.jsx:517`). README/specification retain walking/verified claims; all **399 amenities** are still marked `seed` in the database.

SORA truncation removal is present, but rates remain hardcoded inside ingestion; the planned versioned fixture and source/date metadata are absent. Newsletter content calls those values MAS benchmarks. Retaining features is permissible only with supported provenance or the agreed disclosures, and with incomplete coverage made visible. The completion report has not proved that gate.

## Revised phase disposition and next actions

| Phase | Independent disposition | Needed before closure |
|---|---|---|
| 0 | **Partially verified** | Durable key/off-host restore; connected fake senders and tested staging isolation; named owners/approval evidence; enforced release scope |
| 1 | **Reopen — failures reproduced** | Target-only rebuild, complete/scoped ingestion, atomic migrations, durable scheduling, isolated passing tests and Node 22 target-image evidence |
| 2 | **Reopen — preservation verified, correctness incomplete** | Source-approved identity mapping/reconciliation; sparse/historical/filter contracts; rental counts/pagination; detail quarantine; truthful features and attributable product approval |

Recommended sequence:

1. Suspend operational rebuild use pending correction and make the chosen read-only/no-mail scope enforceable.
2. Correct rebuild isolation and ingestion deletion safety first; then migration interruption and scheduler restart safety.
3. Correct analytics sample/date/count contracts and detail quarantine; verify all promised metric surfaces.
4. Add missing source adjudication, external reconciliation and recovery evidence.
5. Update the completion reports with **implemented / locally verified / staging verified / pending approval** statuses. Restore the original Phase 3 scope and maintain one finding-to-gate closure register.
6. Run an isolated clean suite and the Node 22 release-image/staging rehearsals. Advance independent Phase 3 preparation as useful, but do not claim Phases 0–2 have passed their gates.

## Reproducible audit artifacts

- `audit/2026-10-02/validate-phase-data.py` and `phase-validation-data.json`: read-only database metrics, full transaction comparison and observed reassignment mapping.
- `audit/2026-10-02/validate-phase-probes.mjs`, `phase-validation-probes.json` and `.log`: disposable ingestion, analytics, detail-quarantine, scheduler, rebuild and interrupted-merge probes. Provider requests are replaced with fake responses.
- `audit/2026-10-02/validate-phase-startup.mjs` and `phase-validation-startup.json`: 20 local application starts, five concurrent processes and existing-database initialization.
- `audit/2026-10-02/phase-validation-tests.log`: isolated suite output, **131 passed / one failed**.

These artifacts support the findings above. They do not substitute for business/source approvals, provider integration, target-image behavior or operational staging evidence.
