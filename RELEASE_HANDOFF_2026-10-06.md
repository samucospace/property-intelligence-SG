# Release-readiness source handoff — 6 October 2026

This commit captures the accumulated Phase 2 corrections, Phase 3 repairs and Phase 4 local implementation/evidence. It does **not** authorize public launch. The canonical readiness/remediation reports link to the current status; earlier reports retain their historical evidence.

## Included work

- Phase 2: reviewed project-identity mappings, transaction-source reconciliation, preservation/promotion safeguards, corrected metric/provenance contracts and operational documentation.
- Phase 3: durable consent/email lifecycle, delivery leases/retries, suppression/retention and provider events, signed/revocable administrator sessions, private gateway controls, encrypted independent-backup transport and privacy-ledger-aware restore.
- Phase 4: compact versioned summary/map contracts, covering indexes, exact median worker, bounded/coalesced analytics, prepared default snapshots and market-generation invalidation, capacity protection, split frontend bundles, keyboard/mobile improvements, readiness and durable operational alerts.
- Qualification: regression tests, browser/HTTP harnesses, sixteen independent arithmetic comparisons, sanitized audit results, screenshots, exact image provenance, scheduler observation and disposable application rollback.

Runtime is Node 22.23.3 in the Docker image. Migrations 012–021 are included; take and verify the required pre-upgrade backup before any deployment. The existing live database was not changed by the Phase 3/4 work. SQLite files, backups, provider captures, local credentials, privacy ledgers, dependencies/build output and transient browser debugging captures remain outside source control.

## Validation and candidate provenance

The final suite passed 254/254 on Windows Node 24.19.0 and Linux Node 22.23.3. The full staged dataset retained 5,905 projects, 132,305 sales and 451,165 rentals. Sixteen comparisons matched the independent window-SQL outputs exactly. Desktop/mobile browser journeys and the previous Phase 3 image rollback passed locally. Current production-server and frontend dependency audits reported zero vulnerabilities.

On local Docker with one CPU / 1 GiB limit, the approved default targets passed: sales 44.3 ms / 27,926 bytes; rental 39.2 ms / 119,006 bytes; projects 1,019,558 bytes; added concurrent delay 3.4 ms. These serving timings use startup-prepared defaults. Raw broad rental filters still take about three seconds; the short mixed workload measured p95/p99 around 1.63 seconds. No sustained hosted capacity pass is claimed.

The locally qualified image is `property-intelligence-sg:phase4-candidate-20261006`, identity `sha256:dd1227de60814d222c0156a0e41fe93bdc03354c3466fee8ce7ab7fa0d6c4dcc`. It was built from the uncommitted working tree on baseline `42c8a3c68c012c61f33d0af473cff853f9cf66cc`, before this source handoff commit. Historical manifests intentionally retain that original provenance. Rebuild from this commit, record the new digest and repeat image qualification before deploying; a new image cannot inherit the old digest's evidence automatically. No image was pushed or service deployed by this source-code push.

## Open gates and next work

1. Optimize and qualify broad cold custom filters; establish a sustained workload on the intended host. Keep the original default targets unchanged.
2. Provision the Droplet/domain/DNS, then verify actual proxy/TLS, ports, origins, secrets and filesystem access. Run remote CI and freeze the deployment candidate.
3. Establish an independent backup account, key custody and privacy replica; prove offsite backup and clean-host recovery with measured RPO/RTO and application/data rollback.
4. Name the incident operator, configure the alert transport/external uptime monitoring, and verify received failure alerts and actual hosted scheduled runs. Local scheduler alerts were mocked and never recorded as accepted.
5. Before enabling collection or sending, finish sender/provider setup and the owner-approved recipient, disclosure, processor and retention arrangements. The adviser is currently an informal trial relationship; read-only scope and disabled communications remain the defaults.

## Current documentation

- [Phase 2 completion and preserved-data evidence](PHASE_2_COMPLETION_REPORT_2026-10-05.md)
- [Phase 3 corrected completion report](PHASE_3_COMPLETION_REPORT_2026-10-06.md) and [release closeout checklist](PHASE_3_RELEASE_CLOSEOUT_CHECKLIST.md)
- [Phase 4 qualification report](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md) and [operations runbook](PHASE_4_OPERATIONS_RUNBOOK.md)
- [Phase 4 evidence manifest](audit/2026-10-06/phase4-validation.json)
- [Canonical readiness](GO_LIVE_READINESS_REPORT_2026-10-02.md) and [remediation plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md)

The working-tree tests/image checks above are local evidence. A source push does not itself establish remote CI success, hosted verification or release sign-off.
