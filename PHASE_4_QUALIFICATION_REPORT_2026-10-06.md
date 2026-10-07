# Phase 4 qualification report — 6 October 2026

**7 October private deployment update:** The actual Droplet now runs a server-local, contact-free analytics pilot. Independent encrypted backups and separate-computer data recovery pass. Public/protected HTTPS, received operator email and broad cold-filter capacity remain open; see [private deployment status](PRIVATE_DEPLOYMENT_STATUS_2026-10-07.md).

**CI follow-up:** The first remote run exposed a file-worker launch option inherited from the startup checker. The repair, two new regression tests and passing exact startup checks are documented in [CI failure repair](CI_FAILURE_REPAIR_2026-10-06.md). Earlier image/test figures below retain their historical provenance.

**Status: local implementation and candidate qualification completed for the approved default-response targets; the full Phase 4 exit gate remains OPEN. Public launch remains NO-GO.** Broad uncached custom filters still take seconds, sustained target-host capacity is unverified, and received operational alerts/hosted recovery are outstanding. The original targets have not been relaxed.

This continues the original readiness/remediation plan while Phase 3 infrastructure is deferred. The owner confirmed that the Droplet, DNS, Resend and independent backup account are not ready. The adviser relationship is an informal trial without a documented arrangement. Collection and outbound sending remain disabled; this work does not approve disclosure to an adviser or public release.

## Implementation

- Analytics responses now carry compact summaries, charts and explicitly paginated transaction examples. Complete map data uses the separate `/api/analytics/map` contract. `/api/projects` uses the same versioned columnar transport. Full amenity details remain available on demand. No hidden project cap was introduced and no complete-market statistic is calculated from the displayed examples.
- Covering indexes and off-thread median sorting reduce raw rental work. Numeric streams preserve float precision and SQLite rounding/null semantics. Domain-specific market generations invalidate caches across connections; operational writes do not unnecessarily discard market results.
- Default sales and rental results are materialized before the server listens, retained in SQLite, keyed by generation/Singapore day and refreshed every thirty seconds. They remain usable after process restart. A raw calculation spanning a market change is rejected rather than published. Preparation cost is distinct from request-serving latency.
- Analytics retention is bounded to 32 MiB of serialized buffers, fifty entries and sixty seconds. Identical misses share work. Expensive calculations have one active slot and sixteen queued slots, with 503/Retry-After beyond capacity. A reserved read-only connection and sixteen native workers prevent heavy SQLite work from blocking short reads.
- The entry bundle fell from about 922 KB to 268 KB. Map/chart/drawer code loads separately; the largest chunk is about 425 KB. Search suggestions and filter removal are keyboard accessible. Dialogs/drawers trap focus, close with Escape and restore focus. Mobile layouts contain tables and forms. Loading, retry, errors and empty results are visible. Coverage wording now identifies location estimates instead of claiming all data is verified.
- Liveness and readiness are separate. Readiness checks migrations, market presence and current default materializations, and rejects maintenance windows. Operational alerts cover stale sources/periods/backups, failed jobs, email problems, disk space and privacy-replica availability. Durable retries and an emergency database-independent transport path are implemented; test/staging transport never becomes accepted.

## Correctness and isolation

The final suite passes **254/254 on Windows Node 24.19.0 and Linux Node 22.23.3**. Linux tests run in a derivative of the final candidate with external networking disabled. New coverage includes real HTTP/map contracts, complete results, mutation-safe caching, coalesced misses, cross-connection invalidation, readiness/maintenance, stale data/backup/disk signals, mock/provider retry exhaustion, emergency alert throttling and leap-day ranges. Existing crash/rebuild/restore/privacy regression tests also pass.

An independent captured window-SQL implementation matched the optimized results **exactly in sixteen full-dataset comparisons**: sales/rentals with defaults, district, historical period, bedroom/size filters, custom lifestyle weights, geographic radius and tenure/property-type combinations. This checks complete outputs, not just headline summaries or a numeric tolerance. See `audit/2026-10-06/phase4-arithmetic-parity.json`.

Only sanitized public-market copies were migrated: 5,905 projects, 132,305 sales, 451,165 rentals, 399 amenities, 3,215 benchmarks and 69 SORA records. Synthetic contacts replace private data. The live `server/property.db` was neither migrated nor modified: its SHA-256 remains `dd6ad961ade71ad5c4830b2595a0edbc07ec08dcebbc5467465723ce6e62c8dc`, matching the recorded Phase 2 promoted database.

## Capacity evidence

The reproducible HTTP harness uses the complete sanitized dataset on local Docker Linux with **one CPU and a 1 GiB memory limit**. This is local characterization; no actual Droplet exists to establish target-host equivalence. First HTTP calls occur after required startup preparation, with a fresh process cache. They are not unprepared raw SQL timings. Numeric final measurements are in `audit/2026-10-06/phase4-http-final.json`.

| Original approved target | Local result | Interpretation |
|---|---|---|
| Default sales response under 500 KB / 300 ms | 27,926 bytes / 44.3 ms — PASS | Prepared default serving |
| Default rental response under 500 KB / 300 ms | 119,006 bytes / 39.2 ms — PASS | Prepared default serving |
| `/api/projects` under 1.5 MB | 1,019,558 uncompressed bytes | Complete project contract |
| Second request adds under 100 ms | 3.4 ms — PASS | Default sales while uncached broad rental runs |

The first concurrent run exposed about 2.4 seconds of interference. A separate connection alone did not fix native worker starvation; the bounded calculation queue plus reserved worker capacity did. The retained pre-final-guard observation measured approximately 34 ms sales, 43 ms rental, 2 ms added concurrent delay, and a 188 MiB process resident high-water mark. The exact final image recorded a 192 MiB process resident high-water mark. Older observations are retained explicitly as earlier evidence.

The 140-request, ten-caller mixed workload includes initial district misses, summaries, complete rental maps, search and amenity details. It is a short workload, approximately four seconds, not a sustained soak. The exact final image measured p95 1.63 seconds, p99 1.63 seconds and an uncached broad rental 3.00 seconds. The additional proposed p95 300 ms, p99 one second and RSS 512 MiB budgets remain provisional; the latency proposal is **not met** by that mixed cold workload. Raw default preparation previously measured 7.13 seconds on Windows. These figures are not hidden behind warm-cache reporting.

## Browser, operations and release artifact

Headless Chrome 154 with an isolated temporary profile passes desktop 1440×1000 and mobile 390×844 journeys: real sales/rental APIs, map mounting, autocomplete by keyboard, amenity/rental details, dialog focus/Escape/restore, About, and server-side lead/admin containment. Loading, failed request, Retry and empty states use clearly recorded simulated responses. No page errors or page-level horizontal overflow were observed. External tiles/fonts were blocked, so this does not verify live tile service availability, real mobile devices or an exhaustive accessibility audit. JSON and screenshots are in `audit/2026-10-06/phase4-browser.json` and `phase4-*-sales.png` / `phase4-*-rental.png`.

Real local scheduler timer slots persisted a mocked `skipped` alert attempt and a later `success` monitor run. The backup warning remained pending with zero accepted sends. Existing accelerated scheduler/overlap/crash tests pass. This establishes timer/state handling; it does not establish a successful offsite backup, an operator receipt or a hosted scheduled run.

The previous Phase 3 image was rehearsed on the migrated disposable dataset before returning to the new image. The rollback result is recorded separately; actual offsite data rollback on the intended host remains open. Graceful restart/shutdown, production startup with generated temporary secrets, non-root runtime, required packaged data and exclusion of local credentials/database have been checked locally. Production server and current frontend dependency audits report zero vulnerabilities. CI configuration includes regression, frontend build, image build and production-image qualification; a remote CI run has not been asserted.

Final candidate: `property-intelligence-sg:phase4-candidate-20261006`, image identity `sha256:dd1227de60814d222c0156a0e41fe93bdc03354c3466fee8ce7ab7fa0d6c4dcc`. It is a working-tree build at HEAD `42c8a3c68c012c61f33d0af473cff853f9cf66cc`, not a new committed release or published image. The validation manifest records the exact candidate and supporting evidence. Read [PHASE_4_OPERATIONS_RUNBOOK.md](PHASE_4_OPERATIONS_RUNBOOK.md) for repeated qualification, monitoring and rollback.

## Remaining exit gates

| Open work | Required evidence / owner |
|---|---|
| Cold custom filters and sustained capacity | Optimize/profile broad misses; establish the full mixed workload and any additional budgets with the owner; qualify on the intended host without relaxing the approved default targets |
| Hosted runtime and proxy | Provision Droplet/DNS; verify actual TLS, Caddy, origins, exposed ports, filesystem/secrets, restart and recovery; freeze a committed candidate and run CI |
| Received alerts and incident ownership | Select a named operator/transport; real stale-source, disk/provider/backup failure drills with receipt; external uptime/host monitoring |
| Independent recovery and hosted schedules | Separate account/provider/key custody and privacy replica; successful offsite backup, clean-host restore, RPO/RTO and application/data rollback; actual hosted scheduled runs |
| Collection/adviser/email, if enabled | Named verified recipient and owner-approved disclosure/retention/processor arrangements, verified sender and authorized full email journey; continue read-only scope while these remain open |

Implementation and local evidence allow infrastructure preparation to proceed. They do not close the full Phase 4 exit gate or authorize Phase 5 public launch.
