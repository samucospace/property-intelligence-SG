# Product and technical specification: Singapore Home Intel

**Current specification: 5 October 2026. Release status: NO-GO; local development only.**

This replaces the earlier “Production Verified” specification. Sam Fraser is release owner and operational contact. Every identified issue must be fixed and verified before public launch.

## Scope and runtime

Independent Singapore residential property research: historical transactions, rental estimates, maps and amenity proximity. The current policy is analytics-readonly. Lead capture, outbound mail, cleanup and sync remain disabled until their release gates pass. Implemented routes are not evidence of operational readiness.

Node 22.23.3 with locked npm installations; React/Vite; Express; SQLite WAL with awaited initialization and transactional migrations. Docker runs the web service directly; the maintenance profile enables a separate scheduler. Local Linux container qualification passes; hosted configuration remains a deployment gate. Jobs retain durable slot claims; no exactly-once external-effect or automatic crash-retry claim is made.

## Metrics and queries

The [Sam-approved metric contract](PHASE_2_METRIC_CONTRACT.md) defines selected periods, monthly rental boundaries, period-matched sale windows, three usable samples per side, property/size/tenure matching, honest null/N/A values and the median-of-project-yields headline. It governs dashboard, drawer, API and newsletter calculations. Bedroom yields are withheld when no comparable sales field exists. Finite rental area bands use estimated midpoints; open-ended bands retain the lease but have no precise psf estimate.

Stable pagination includes record-ID tie-breakers. Complete radius aggregation excludes approximate district-centre coordinates; map rendering clusters markers rather than truncating the analytical population. Pending project identity reviews are excluded from public analytics without deleting transactions. Unknown planning areas remain unknown or explicitly labelled district descriptions.

Caches check SQLite data_version, local write revision, connection identity and date before reuse. External commits are visible on the next request; recovery/database errors propagate. No blanket latency or cross-query snapshot-consistency promise is made. Current overview valuations are independently date-filtered from transactions.

## Sources and safe reconciliation

The [official URA API reference](https://eservice.ura.gov.sg/maps/api/) describes four sale batches and quarter-scoped rentals in a moving five-year history. Revised/withdrawn source records can differ from older retained snapshots. Current endpoints use eservice.ura.gov.sg/uraDataService/insertNewToken/v1 and invokeUraDS/v1; keys/tokens belong in headers and never in reports/logs.

Ordinary imports perform an additive multiset union after validation. They preserve genuine repeated records and existing history, and do not claim authoritative deletion/replacement. Transaction source_district retains provider-level district evidence; legacy NULL values fall back to project labels and are not original source evidence.

Capture raw responses and hashes; independently normalize source ledgers; compare full identities, periods, multiplicities and amount totals read-only. Rehearse replacement only on isolated candidates with transactionally archived original rows and out-of-scope preservation. Operational replacement/rebuild remain quarantined pending reviewed source differences and target-platform validation. Identity merges require explicit approved mappings, evidence and exact preconditions; source similarity does not establish human approval.

## Spatial and rate provenance

Amenities are an incomplete curated seed catalog plus any imported POIs. Distances are straight-line haversine estimates; optional times divide distance by 80 metres/minute. They are not pedestrian routes or school-admission eligibility measurements. Detail responses return catalog/school counts and methodology. Approximate/unavailable locations have no precise scores, sub-scores or nearest-amenity claims.

SORA comparisons are disabled pending verified dated observations. Legacy historical rates are retained as an explicitly unverified versioned fixture and cannot overwrite existing observations. They must not be marketed as MAS benchmarks.

## Release evidence

Use the [governing plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md), [Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md), [Phase 2 report](PHASE_2_COMPLETION_REPORT_2026-10-05.md) and [operations runbook](PHASE_0_OPERATIONS_RUNBOOK.md). Local tests do not establish deployment, consent compliance, legal certification or disaster recovery. Complete all original gates before public launch. Hosted backups remain deployment-stage work: daily DigitalOcean backups plus encrypted copies to a separate provider/account, separate keys and verified restoration.
