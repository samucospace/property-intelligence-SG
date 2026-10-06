# Phase 4 implementation plan — 6 October 2026

**Status:** Local implementation and approved default-target qualification recorded in [the Phase 4 report](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md). The full exit gate remains open for cold custom/sustained capacity and hosted evidence. Hosted Phase 3 checks remain open because the infrastructure/accounts are not ready. Public launch remains NO-GO.

## Scope and targets

The original remediation targets remain the development baseline: sales/rental responses under 500 KB and 300 ms, projects under 1.5 MB, and less than 100 ms additional delay to a concurrent request. Additional proposed qualification budgets are 10 concurrent users, p95 under 300 ms, p99 under one second, no unexpected errors and server RSS under 512 MB. The owner approved the original targets in this chat. Additional mixed-load/memory targets remain provisional, rather than replacing the original limits. Targets will not be silently relaxed.

Use sanitized public-market copies and fake communications. Preserve the reconciled source database and Phase 2 metric definitions. A local container is not evidence of the actual Droplet, public TLS, received alerts or offsite recovery.

## Workstreams

1. Establish a reproducible baseline and mixed sales/rental/search/map/detail workload, with runtime, CPU/memory limits, dataset, cache state and complete-market correctness recorded.
2. Remove repeated nearest-amenity detail from map/project summaries; load detail when requested. Separate the compact analytics contract from complete map data, preserving summary arithmetic and complete filter results.
3. Bound caches by bytes, coalesce concurrent identical misses and preserve cross-process data-version invalidation. Optimize measured expensive SQL paths without changing approved metric definitions.
4. Split frontend bundles and exercise desktop/mobile, keyboard and loading/error/empty states, including sales/rental/search/map/detail and contained lead/admin flows.
5. Separate liveness/readiness from operational freshness, reserve monitoring capacity, and implement disk/provider/source/job/backup failure signals with a testable alert boundary. Received external alerts remain a hosted gate.
6. Qualify the exact release image, dependency/configuration packaging, restart/shutdown and isolated rollback procedures. Preserve explicit hosted gaps and the original Phase 4 exit gates.

## Required outcome

Report implementation, independent correctness checks, measurements against approved budgets, browser/operational evidence, candidate identity and remaining hosted gates. Local completion cannot close the deferred Phase 3 infrastructure/privacy/communications approval requirements or authorize public release.
