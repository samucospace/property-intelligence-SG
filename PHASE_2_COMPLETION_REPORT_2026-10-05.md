# Phase 2 completion and source-validation report

**5 October 2026: Phase 2 complete for the local project.** All 35 identity approvals are applied and the reconciled database is promoted. Public release remains **NO-GO**; later-phase and hosted checks remain open. Sam Fraser is release owner and operational contact.

This supersedes the unsupported original 2 October completion claim. Sam approved the [metric contract](PHASE_2_METRIC_CONTRACT.md), all identity decisions and proceeding with local Phase 2 completion. Provider keys/tokens were neither displayed nor retained in audit outputs.

## Corrected behavior

- Selected-window rental counts, summary, table, chart and map agree. Pagination has stable ID tie-breakers. Radius aggregation has no silent 200-project cap, and exact coordinate keys prevent cache collisions.
- Project gross yield uses selected-period median rent psf and median sale psf over the disclosed 24-calendar-month window ending on the selected date. Project/type/size/tenure matching and three usable positive records on each side apply. Missing estimates show N/A. Bedroom yields are withheld where no comparable sales field exists. Newsletter ranking shares this contract.
- The headline is explicitly **Median Project Gross Yield**, with **Median across eligible projects; each project counts once**. The drawer identifies the median inputs and formula. Individual-rental estimates remain separately labelled.
- Current benchmarks exclude sparse, invalid and future sales. Caches detect external commits, local writes, connection changes and dates on the next request; database errors propagate. Current overview valuations are independently date-filtered.
- Approximate/missing coordinates cannot publish precise livability scores, sub-scores or nearest amenities, including the detail API. Curated catalog coverage and straight-line methodology are disclosed. Walkability and school-admission claims were removed.
- Legacy SORA is a versioned unverified fixture that cannot overwrite observations. SORA comparisons and MAS benchmark claims are disabled. Open-ended area bands retain leases without invented precise midpoint/psf values.
- Future destructive merges require attributable approved mappings and exact preconditions. Unresolved normalization collisions preserve both identities/transactions and remain excluded. Invalid planning areas stay unknown. Transaction-level source districts preserve evidence independently of legacy project labels.
- Source reconciliation compares complete normalized identities, dates, multiplicities and amount totals. The isolated snapshot engine verifies all covered source scopes and response hashes, archives replaced records, retains out-of-window history and rolls back malformed replacements.

## Identity decisions and application

All **35** historical merge decisions were approved by Sam on 5 October: 1–18 individually; 19–24, 26–31 and 33–35 under his explicit matching-coordinate batch criteria; and exceptions #25 ST ANNE'S WOOD (51.8m) and #32 ST THOMAS VILLE (11.9m) after explanation. The six missing original source coordinates and ESPADA's approximately 68.6m difference remain disclosed.

The [decision guide](PHASE_2_IDENTITY_REVIEW_GUIDE.md) retains the original recommendations separately from Sam's decisions. The [adjudication map](server/migrations/data/project_adjudication_map.json) retains IDs, original positions, moved counts, provider evidence, reviewer and date. Migration 014 applies acceptance of already completed historical merges; it does not repeat source deletion or transaction reassignment, and cannot clear a separate unresolved conflict. The promoted database has **35 approved reviews and zero pending reviews**.

## Source reconciliation and database promotion

The [official URA reference](https://eservice.ura.gov.sg/maps/api/) describes a rolling five-year source and revisions/withdrawals. Four sale batches and 23 requested rental quarters were captured: **132,246 sales** observed September 2021–September 2026 and **451,165 rentals** observed September 2021–August 2026. The first two rental quarters were empty; this does not establish earlier archive completeness.

Against the older local snapshot, [comparison evidence](audit/2026-10-05/phase2-source-reconciliation.json) found 843 missing / 1,956 extra sale occurrences and 3,206 missing / 2,763 extra rental occurrences. These are differences against a newer source version, including source-district differences, not proven accidental loss. Original rows were retained rather than silently discarded.

The [final candidate evidence](audit/2026-10-05/phase2-final-candidate.json) verifies **zero missing/extra occurrences and matching amount totals** against the captured source. All **133,359 covered original sales and 450,722 original rentals** are archived inside the database; original ownership, dates and amounts match. All **59 older sales** outside the source window remain active with matching ownership/dates/amounts. Existing operational schemas and rows are preserved; the only permitted addition is the empty Phase 1 `job_slots` table.

The [completed local promotion](audit/2026-10-05/phase2-final-promotion.json) records **5,905 projects, 132,305 sales, 451,165 rentals, 14 applied migrations**, integrity OK and zero foreign-key violations. Database SHA-256: `dd6ad961ade71ad5c4830b2595a0edbc07ec08dcebbc5467465723ce6e62c8dc`. The original sibling rollback backup retains SHA-256 `e6067d6033aac82c3392db8108fd7221ecefa576e44c7efb247ead6b381fa252`.

A new encrypted backup was restored in a fresh Node process before promotion, with matching hash and table counts. The promotion procedure validates source/candidate hashes, source parity and preservation before and after the swap. Maintenance/journal fencing, generation changes, exception rollback and fresh-process recovery protect interrupted swaps. Original backup, restored backup and final candidate remain local. No scheduled sync, mail or cleanup was enabled.

This establishes parity with the captured provider version, not completeness of earlier provider history. Raw responses/ledgers remain ignored locally; their hashes and evidence remain reviewable without publishing credentials or the full feed.

## Verification and original exit gates

**189 tests in 15 files pass on Windows and Linux with Node 22.23.3.** These include independent historical arithmetic, sample/missing-data handling, stable pagination, complete combined/radius filters, local/external cache changes, identity preservation, source multiplicity, malformed replacement rollback and nine reviewed-promotion tests covering operational records, bound hashes, open handles, failure rollback and process termination at all swap stages. The original Phase 0/1 regressions still pass.

The frontend production build passes with its existing bundle-size warning. The [final Docker qualification](DOCKER_QUALIFICATION_REPORT_2026-10-05.md) verifies 20 fresh, five existing and five concurrent starts, production health/frontend responses, non-root execution and absence of baked credentials/database. Independent Python median arithmetic agrees with the real-data HTTP API: ST MICHAEL REGENCY, October 2025–September 2026, four usable rents and four matched sales, **3.02%** median project gross yield. The sole selected eligible project also determines the headline. The promoted local database passes the same API check on a disposable copy.

| Governing exit gate | Local evidence / disposition |
|---|---|
| Approved identity repair, source evidence, integrity/FKs and no unexplained replay losses/duplicates | Passed: 35 approvals applied; promoted source parity, original archives, older history and operational state verified. |
| Known normalization/classification defects resolved or quarantined | Passed locally: landed/normalization repairs, unknown planning areas, unresolved identity exclusions and approximate-coordinate withholding. |
| External commits become visible without restart within a documented freshness bound | Passed on next request in external/local commit regressions. Actual host/provider integration remains a deployment check. |
| Stable disjoint pages and complete radius/combined filters, with explicit bounds | Passed: stable ID pages and 249 independently qualifying radius/filter records; existing input bounds and map clustering retained. Host load verification remains later release work. |
| Hand arithmetic matches all metric surfaces, historical filters and sparse/missing samples | Passed in isolated arithmetic regressions, drawer/formula alignment and independent real-data HTTP check. |
| Product owner approves definitions/scope; unsupported claims removed | Sam approved the median definition/exclusions and all identities. SORA disabled; straight-line/incomplete catalog and N/A disclosures implemented. |

Phase 2 is complete locally. Hosted configuration, provider integration, load verification and off-host backup/recovery remain private-deployment tasks as requested by Sam. General rebuild and scheduled sync remain disabled because a captured snapshot does not prove future provider completeness. Phase 3 retains **email, consent, access and recovery**; Phase 4 retains deployment automation, observability and realistic staging checks. Every identified issue must be fixed and verified before public launch. This work has not been deployed, committed or pushed.

Operations: [Phase 2 runbook](PHASE_2_OPERATIONS_RUNBOOK.md). Release gates: [governing plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md).
