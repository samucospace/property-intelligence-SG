# Phase 2 detailed implementation and verification plan

**Updated 5 October 2026. Local implementation and verification complete; owner: Sam Fraser.**

Parent: [governing plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md). Findings: GL-04–08. See [current evidence](PHASE_2_COMPLETION_REPORT_2026-10-05.md). This supersedes the original automatic-merge and district-to-planning-area assumptions.

## Identity and source work

1. Correct Saint/Street normalization and landed classification without indiscriminate merges. Record all 35 removed baseline identities, including five without moved transactions, in the checked-in project adjudication map. Retain IDs, before/after identity/coordinates, moved counts and provider evidence.
2. Require attributable reviewer/date, source evidence and exact preconditions before merging. Apply ownership/deletion/version changes atomically; unknown operational foreign keys block deletion. Preserve unapproved identities and quarantine their calculations. Already merged owners require source review before adjudication is claimed.
3. Keep invalid planning areas unknown. Postal-district descriptions must not become asserted planning areas.
4. Capture four sale batches and rental quarters, retaining raw responses/hashes without credentials. Empty older scopes establish unavailable history. Independently normalize transaction-level districts, dates, amounts, areas, floor/tenure/type, unit count, bedrooms and bands.
5. Compare identities, multiplicities and amount totals read-only. Separate out-of-window history from missing/additional current-scope records. Rehearse scoped replacement in a disposable candidate with every replaced row archived and out-of-scope history retained. Missing batches/quarters, hash failures and malformed records must prevent commit. Independently compare the candidate to the source ledger.
6. Review differences and mappings before operational promotion. Existing rebuild quarantine and Phase 1 target-image gates remain.

## Query, metric and provenance work

Implement the [approved metric contract](PHASE_2_METRIC_CONTRACT.md): selected-window summaries/counts, historical sales windows, usable-sample thresholds, finite-band disclosures, null/N/A values, correct drawer formula and shared newsletter rankings. Verify hand arithmetic, sparse/missing data, combined filters, stable pages, complete radius aggregation and external-commit freshness.

Withhold approximate-location scores at every API boundary, including stale sub-scores/nearest amenities. Disclose straight-line distances, incomplete catalog/school coverage and optional 80m/min estimates. Remove walkability, school-eligibility and verified-national-catalog claims. Retain legacy SORA as explicitly unverified and disable comparisons pending dated observations. Align README, specification, UI and newsletter.

## Original exit gates retained

- Every proposed identity repair has source evidence and an approved mapping; integrity/FK checks pass; no unexplained losses or duplicates arise from replay.
- All currently known normalization/classification defects are resolved or explicitly quarantined from public calculations.
- After an external sync commits, a running API exposes the new data/benchmarks within a documented freshness bound without a restart.
- Pagination pages are disjoint and stable; radius and combined filters match an independent complete result set; oversized queries are explicitly bounded/rejected rather than silently truncated.
- Hand-calculated small datasets match all metric surfaces, including historical filters, missing data and sparse samples.
- Product owner signs off the definitions and any scope reductions. Unsupported precision/provenance claims are absent from the release UI and documentation.

Phase 3 remains **email, consent, access and recovery**. Pipeline follow-up does not replace that scope.
