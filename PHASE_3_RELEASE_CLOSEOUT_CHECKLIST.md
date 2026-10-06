# Phase 3 release closeout checklist — 6 October 2026

The Phase 3 repairs pass 238 tests on Windows and Node 22/Linux. These checks establish local behavior. The remaining gates below need actual infrastructure, communications evidence or owner decisions. The older deployment guide lists proposed accounts/providers, not confirmed current setup.

**Owner update:** No Droplet, domain/DNS setup, Resend or independent backup account is ready. Hosted Phase 3 qualification is deferred until infrastructure is provisioned. The adviser relationship is an informal trial with no documented arrangement; recipient/consent approval remains open. Local Phase 4 work can proceed in parallel, with collection and sending contained.

## Remaining work and closure evidence

| Workstream | What is still open | Evidence required to close it | Dependency |
|---|---|---|---|
| Private deployment/access | Deploy the verified candidate privately; configure TLS, private admin access, origins, secrets, permissions and persistent storage. | Public/direct backend access cannot reach admin actions; authorized private operator can log in/out; restarts preserve data; target proxy/security checks pass. | Confirm Droplet/access, domain/DNS and operator access method. |
| Independent recovery storage | Configure the separate backup account/bucket and continuous independent privacy-event replica. The default second local folder is insufficient. | Upload/download checks succeed; storage survives loss of the Droplet; failed/reconnected replica is handled safely; retention and separate key custody are verified. | Existing backup account/provider and replica destination. |
| Clean-host recovery | Restore encrypted database plus current withdrawals/deletions using independently held recovery materials. | SQLite/schema/job-state checks pass; erased people are absent and opt-outs remain effective; measure against the plan's 24-hour data-loss bound and under-30-minute recovery target. | Working independent storage and separately recoverable keys. |
| Real communications | Verify sender/domain, webhook and usable privacy/contact inboxes; test the complete authorized recipient journey. | Signup, explicit confirmation, digest, unsubscribe and bounce/complaint handling work through the actual provider. Record acceptance/delivery separately. | Resend/DNS setup and an explicitly approved test address. |
| Privacy and recipient approval | Complete actual recipient/CEA registration, processors, transfer arrangements and retention notice; review legacy advisory classifications. | Owner approves the actual rendered notice and practices; legacy records are reviewed before cleanup is enabled. Configuration reference strings alone are insufficient evidence. | Owner supplies the actual recipient and hosting/backup choices. |
| Monitoring and schedules | Implement operational failure/freshness checks and connect alerts to the operator. Current job failures are logged, but received alerts are not yet implemented/verified. | Deliberate backup/email/replica failures produce received alerts; stale jobs/backups are detected; due-time execution and restart/overlap behavior are observed on the host. | Choose alert recipient/channel; private host for actual delivery and scheduling evidence. |
| Remaining Phase 4 qualification | Local default targets, browser/accessibility, bounded queries, monitoring and disposable application rollback are qualified; see the Phase 4 report. Cold custom filters and hosted checks remain open. | Sustained mixed workload on intended hardware; received alerts; clean-host recovery and proxy qualification. | Provision infrastructure and finish cold/mixed capacity work. |

## Execution order

1. Confirm what already exists: host, domain/DNS, Resend, independent backup account and accessible management tools. Supply non-secret identifiers; place credentials in the private runtime configuration.
2. Prepare private deployment and recovery storage together. Keep collection, outbound email, cleanup and general data sync disabled while infrastructure is being qualified.
3. Complete the rendered privacy/recipient notice for owner review. If no advisory recipient has been appointed, keep advisory collection disabled while preparing other work; the current full-release guard requires an actual recipient before full scope can start.
4. Implement monitoring, then prove failure alerts, actual schedule execution and clean-host recovery.
5. Run the live-provider journey only with an explicitly approved test recipient and configured sender/webhook. Do not send to legacy subscribers as a qualification exercise.
6. Complete Phase 4 qualification and record the release decision against the original readiness/remediation gates.

The [Phase 3 operations runbook](PHASE_3_OPERATIONS_RUNBOOK.md) contains the current configuration and restore procedures. The [completion report](PHASE_3_COMPLETION_REPORT_2026-10-06.md) retains the original gate definitions. This checklist is not deployment authorization, privacy approval or a passed release gate.
