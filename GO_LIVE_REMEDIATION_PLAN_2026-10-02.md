# Phased go-live remediation plan — 2 October 2026

**6 October Phase 4 update:** Compact complete-map contracts, bounded/coalesced queries, prepared default analytics, browser/accessibility and operational monitoring are implemented and locally qualified. The original default-response/payload/concurrent-delay targets pass; broad cold custom filters and full hosted qualification remain open. See [Phase 4 qualification](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md) and [operations runbook](PHASE_4_OPERATIONS_RUNBOOK.md). Public launch remains NO-GO.

This plan implements the findings in `GO_LIVE_READINESS_REPORT_2026-10-02.md`. The current release decision is **NO-GO**. It is a plan, not a record of completed fixes.

**Phase 0 update:** local containment, isolated staging and durable local restoration are verified in the [corrected completion report](PHASE_0_COMPLETION_REPORT_2026-10-02.md). Sam Fraser is release owner and operational contact. The project is not live, and Sam requires every identified issue to be fixed and verified before public release. Hosted backup work is deferred to private deployment: daily DigitalOcean Droplet backups plus automated encrypted database copies to a separate provider/account, with separate key custody and verified restores before launch. See the [backup strategy](PHASE_0_OPERATIONS_RUNBOOK.md#deployment-stage-backup-strategy-deferred-not-live). The original recovery exit requirement remains open; this is a timing deferral, not a passed gate. Phase 1/2 completion is disputed by the [independent review](PHASE_0_TO_2_INDEPENDENT_VALIDATION_2026-10-02.md).

Estimates below are rough focused engineering effort, not promised elapsed dates. They assume one experienced engineer with access to a staging host, provider test accounts and a business owner who can resolve metric/privacy questions. External setup and data reconciliation can extend the schedule. Approximately **20–35 engineering days**, plus external waiting time, is a reasonable initial planning range; re-estimate after Phase 1 and data reconciliation. Phases 2–4 can partly overlap when staffed separately, but their acceptance gates cannot be skipped.

## Phase 0 — Contain unsafe operations and establish a recoverable baseline

**Owner:** engineering/operations. **Effort:** 0.5–1 day. **Findings:** GL-01, GL-03, GL-11.

1. Mark the current rebuild script unsafe and remove it from the operational path until repaired. Pause automatic destructive cleanup/rebuild and uncontrolled outbound mail while configuring staging.
2. Capture a consistent database backup and working-tree/build baseline. Keep backup encryption keys separately. Establish an off-host recovery copy and test opening/restoring it in an isolated environment.
3. Inventory enabled processes, schedules, environment variables, sender/domain setup, deployment ports and storage. Record presence/configuration without copying secret values into reports.
4. Establish sanitized staging data, fake email/provider adapters and isolated test DB defaults. Separate staging credentials from production credentials.
5. Choose release scope: full lead/email product or read-only analytics; retain or defer livability/SORA. Name the release owner and operational contact.

**Exit gate:** the baseline can be restored; no unapproved script can rebuild or send mail as a side effect of deployment; staging is isolated; scope and owners are written down.

## Phase 1 — Fix startup, scheduling and data-write safety

**Current status (5 October):** 189 regressions pass on Windows and Linux using Node 22.23.3. The final release image passes repeated startup, production health/frontend, packaging and real-data API arithmetic; see the [Docker qualification report](DOCKER_QUALIFICATION_REPORT_2026-10-05.md). The reviewed Phase 2 snapshot is promoted locally with verified backup/recovery. General rebuild and scheduled sync remain quarantined; hosted checks remain deferred to private deployment. The original gates are retained and public launch remains NO-GO.

**Owner:** backend/platform. **Effort:** 4–6 days. **Findings:** GL-01–04, GL-12, GL-16.

1. Select a supported Node LTS and align local development, CI and Docker. Pin the process manager and build dependencies through a reproducible installation path.
2. Replace fire-and-forget SQLite initialization with awaited, error-handled setup. Apply busy handling before contended operations. Serialize migrations through one owner before serving requests or launching jobs.
3. Replace the one-shot PM2 cron pattern with an appropriate scheduler. Use explicit timezone, job locks, run IDs, last-success records and startup dependencies. Separate “deploy services” from “run maintenance.”
4. Refactor ingestion/rebuild to take explicit connections and validated source scopes. Include full project identity in deduplication; preserve genuine repeated transactions. Make all provider requests bounded and validate complete responses before deletion/replacement.
5. Repair the rebuild end-to-end: target-only writes, full lead/suppression/job-state preservation, integrity/completeness gates, exclusive maintenance, safe handle/WAL lifecycle, verified rollback. Test it only on disposable databases until these checks pass.

**Exit gate:**

- At least 20 consecutive fresh-disk starts and repeated existing-database starts pass in the target image; interrupted/concurrent migration tests are deterministic.
- An isolated rebuild leaves the source logically unchanged until the intended swap; empty, partial, provider-failure and interrupted-swap cases preserve or restore the original data.
- Same-name/different-street fixtures preserve both projects' transactions; replay is idempotent without removing legitimate multiplicity.
- Partial imports preserve out-of-scope history; malformed/empty provider results cannot erase good data; failure status and committed counts agree.
- Staging proves a scheduled job runs when due, runs once, survives scheduler restart and does not run merely because the application was deployed.
- Clean install, tests and image build pass on the selected supported runtime.

## Phase 2 — Reconcile the dataset and make analytics correct

**5 October update: Phase 2 complete locally.** Sam approved the [metric contract](PHASE_2_METRIC_CONTRACT.md) and all 35 historical identities, retaining evidence limitations. All approvals are applied; the reconciled database contains 5,905 projects, 132,305 sales and 451,165 rentals. Captured-source parity has zero missing/extra occurrences, original covered records are archived, older sales and operational records are preserved, and encrypted restore/rollback are verified. All 189 tests pass on Windows/Linux; the final image passes repeated startup, production packaging and independent real-data API arithmetic. The [current report](PHASE_2_COMPLETION_REPORT_2026-10-05.md) retains the original exit gates. Hosted verification and later phases remain open; nothing is deployed.

**Owner:** backend/data engineer with product owner. **Effort:** 5–8 days. **Findings:** GL-04–08.

1. Resolve Saint/Street normalization and adjudicate the 35 duplicate candidate groups against source identity. Repair the incorrect landed flag and invalid planning areas. Record before/after project IDs, counts and transaction ownership; avoid indiscriminate name/coordinate merges.
2. Reconcile historical transactions with validated source batches after fixing ingestion. Counts alone are insufficient: compare identities, periods, multiplicities, totals and representative samples. Explain differences from the 584,140-record baseline.
3. Regenerate benchmarks and scores from reconciled records. Separate unavailable estimates from zero and publish sample/coverage metadata. Exclude approximate coordinates from precise location scoring.
4. Implement data-version-based API cache refresh across processes, stable price pagination, complete radius semantics and consistent filters across all outputs.
5. Agree and implement metric definitions: headline yield aggregation, date windows, sale/rental matching, property/unit-size matching, sample thresholds and historical versus current valuations. Align dashboard, drawer and email calculations with the specification.
6. Source/validate amenities and SORA, record dates/provenance and correct user-facing claims, or disable those features for the initial release. Remove destructive hardcoded SORA truncation.

**Exit gate:**

- Every proposed identity repair has source evidence and an approved mapping; integrity/FK checks pass; no unexplained losses or duplicates arise from replay.
- All currently known normalization/classification defects are resolved or explicitly quarantined from public calculations.
- After an external sync commits, a running API exposes the new data/benchmarks within a documented freshness bound without a restart.
- Pagination pages are disjoint and stable; radius and combined filters match an independent complete result set; oversized queries are explicitly bounded/rejected rather than silently truncated.
- Hand-calculated small datasets match all metric surfaces, including historical filters, missing data and sparse samples.
- Product owner signs off the definitions and any scope reductions. Unsupported precision/provenance claims are absent from the release UI and documentation.

## Phase 3 — Finish email, consent, access and recovery controls

**6 October update:** The independently identified Phase 3 code gaps have been repaired, with expanded HTTP, native-process and recovery tests. See the [corrected report](PHASE_3_COMPLETION_REPORT_2026-10-06.md) and [operations runbook](PHASE_3_OPERATIONS_RUNBOOK.md). Hosted recovery/communications evidence and owner approval remain open; the original exit gates below are retained and public launch remains NO-GO.

**Owner:** backend/operations; business owner approves privacy and communications. **Effort:** 4–7 days. **Findings:** GL-09–13.

1. Check provider result objects in every email path. Add durable delivery states, atomic dispatch claims, idempotency, bounded retries and bounce/complaint suppression. Mark provider acceptance only after successful acceptance; distinguish it from delivery.
2. Fail closed when enabled production email features lack required sender/provider configuration. Return honest user-facing errors and avoid logging usable confirmation links in production.
3. Add expiring single-use confirmation with explicit action. Preserve consent evidence and preference history; quarantine legacy contacts that lack sufficient evidence. Consult suppression during signup/import and after restoration.
4. Implement approved retention/deletion rules, including converted leads and retained backups. Document restoration procedures that reapply deletions and suppression before sending resumes.
5. Enforce strict endpoint schemas. Decide the admin boundary: private/MFA-gated access for a small deployment or appropriate operator accounts. Test origin policy, credentials, rotation, revocation and access logging.
6. Require the approved production backup protection, implement off-host retention, separate keys and complete a clean-environment restore. Agree RPO/RTO with the owner.

**Exit gate:**

- Fake-provider 4xx, 5xx, timeout and crash cases never generate false success or mark failed delivery as sent; duplicate workers do not cause uncontrolled duplicate sends.
- Expired/replayed tokens are rejected; a link scanner GET alone cannot grant marketing confirmation; consent/suppression survives migration, cleanup and restore.
- Invalid-type/range inputs produce bounded 4xx responses; unauthenticated and unauthorized admin operations fail; cross-origin behavior matches the deployed architecture.
- An authorized staging recipient completes signup, confirmation, newsletter and unsubscribe; configured bounce/complaint handling is exercised. Domain/sender verification is recorded.
- Encrypted recovery succeeds within agreed RPO/RTO and retains the full current schema and lead preference/job state.
- The accountable owner approves the actual notices, partner identity, processors, retention and sender practices.

**Read-only release alternative:** disable collection UI, submission endpoints, admin lead access and all outbound email jobs. Verify disabled routes server-side. This can defer email/consent implementation, but existing personal data must still be protected and backed up appropriately.

## Phase 4 — Establish performance and operational release evidence

**Owner:** backend/frontend/platform. **Effort:** 4–7 days. **Findings:** GL-12–16 and release UX.

1. Split compact map/summary/list data from property detail; stop repeating full amenity details for every map item. Optimize the cold rental path and benchmark queries. Bound cache memory and coalesce simultaneous identical misses.
2. Agree numerical latency, payload, concurrency and memory budgets before testing. Use the earlier remediation plan's targets as the starting proposal; any relaxation requires an explicit accepted product/capacity decision.
3. Add regression tests for every reproduced defect, disk-backed lifecycle tests, fake-service failure tests and real HTTP contract tests. Enforce isolation before any module imports. Cover sales/rental/search/map/detail/lead/admin journeys in browser tests as relevant to scope.
4. Implement liveness/readiness and source/job/backup freshness monitoring. Exercise alert delivery and incident ownership, including disk-full, provider outage, stale data and backup failure.
5. Deploy the exact release image to staging through the intended proxy and persistent storage. Test TLS, headers, origins, ports, secrets, filesystem permissions, restart/shutdown, backup and rollback. Repeat dependency audit and a secrets/configuration review of the release artifact and repository exposure.
6. Test mobile layouts, keyboard access, loading/error/empty states and truthful sample/coverage labels. Reduce the frontend bundle where needed to meet page-load budgets.

**Exit gate:**

- The release candidate passes CI plus target-image integration and browser tests with no unexplained failures.
- A repeatable mixed-filter workload on target-equivalent hardware meets approved cold/warm p95/p99, error, payload and memory budgets; results record hardware, dataset, concurrency, duration and cache state.
- Query correctness remains unchanged by optimization. No complete-market statistic is derived from a hidden result cap.
- Monitoring alerts reach the named operator; restores and application/data rollback work from the documented runbook.
- Staging observes at least one actual scheduled run and accelerated simulations of longer schedules, with persisted success evidence and overlap prevention.
- Every P0/P1 finding is closed with evidence or made inapplicable through a tested scope reduction. “Accepted risk” is not an adequate substitute for unresolved data loss or materially incorrect published analytics.

## Phase 5 — Controlled launch and follow-through

**Owner:** release owner and operations. **Effort:** 2–4 days of launch preparation/observation, with a longer observation calendar as needed.

1. Freeze the candidate, capture a recoverable pre-release backup and publish the corrected canonical report/specification/runbook. Record the exact commit, image digest, data version and configuration scope.
2. Complete a short release review against the checklist below. Establish rollback triggers and the person authorized to invoke them.
3. Release to a small initial audience; monitor actual errors, cold-query latency, resource usage, sync freshness, email outcomes and backup success.
4. Expand only after the agreed observation window is healthy. Investigate data discrepancies and suppressed/failed emails before increasing traffic.
5. Schedule follow-up work for deferred amenity coverage, historically matched benchmarks, richer filters, accessibility refinements and broader infrastructure resilience according to actual usage.

## Release sign-off checklist

| Gate | Required evidence | Accountable role |
|---|---|---|
| Data preservation | Rebuild/sync failure-injection and rollback results; reconciled dataset | Backend/data |
| Startup/runtime | Clean target-image bootstrap, upgrade and supported runtime | Platform |
| Correct analytics | Independent fixtures, complete filters/pagination, freshness tests | Backend + product |
| Truthful features | Provenance, uncertainty and agreed scope reflected in UI/spec | Product |
| Email/consent, if enabled | Provider failures, consent/suppression, authorized delivery journey | Backend + business |
| Access/privacy | Endpoint schemas, protected admin boundary, approved notices/retention | Engineering + business |
| Recovery | Encrypted off-host restore, key access, RPO/RTO, suppression replay | Operations |
| Scheduling/monitoring | Due-time job evidence, lock/restart tests, received alerts | Operations |
| Capacity | Target-equivalent mixed-load results against approved budgets | Engineering |
| Release artifact | CI/browser results, dependency/security configuration review, exact image | Release owner |

For each finding, record status, owner, implementation reference, test evidence and closure date. Keep “implemented,” “locally verified,” and “verified in staging” distinct. Update the canonical report only from that closure record; historical completion language must not replace present evidence.
