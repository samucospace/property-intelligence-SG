# Phase 3 completion report — corrected after independent review

**Subsequent Phase 4 work:** The current candidate and 254-test qualification are recorded in [the Phase 4 report](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md). The Phase 3 results below remain historical local evidence; hosted/privacy/communications gates remain open.

**Date:** 6 October 2026  
**Release owner:** Sam Fraser  
**Status:** Implementation gaps repaired and locally qualified; hosted recovery, communications and owner approval gates remain open. Public launch remains **NO-GO**.

This report supersedes the earlier claim that every Phase 3 gate had passed. The original readiness/remediation requirements remain governing. The [independent review](PHASE_3_INDEPENDENT_REVIEW_2026-10-06.md) records the pre-repair defects; the [operations runbook](PHASE_3_OPERATIONS_RUNBOOK.md) describes deployment and recovery.

## Implemented repairs

1. **Real outbox integration:** Newsletter confirmation, advisory notification and weekly digest paths now enqueue durable intents. Lead creation and email intent commit in one SQLite transaction. Advisory retries have stable request IDs, and newsletter campaigns have stable recipient/week keys. API responses distinguish queued work from provider acceptance.
2. **Crash recovery:** Claims have unique fencing tokens and five-minute expiry, with batches capped at ten. The provider adapter carries the idempotency key and a 15-second abort signal. The production scheduler serializes dispatch jobs and paces provider calls. Work beyond the safe provider retry window is held for reconciliation. Mock dispatches cannot count as live acceptance; accepted payloads are scrubbed.
3. **Honest send metadata:** Confirmation request throttling has its own timestamp. Confirmation and newsletter acceptance timestamps advance only with a provider message ID. Missing/suppressed advisory recipients fail closed; failed sends cannot produce a false "already dispatched" response.
4. **Consent lifecycle:** GET remains non-mutating; POST consumes an unexpired token transactionally, clears quarantine and appends consent evidence. Missing/invalid expiry is rejected with consistent SQLite UTC comparison. Migration 018 quarantines existing confirmed contacts for fresh verification and invalidates unverifiable legacy tokens. New consent evidence uses notice version `2026-10-06-v2`.
5. **Privacy recovery:** Withdrawals/deletions append to an independent durable JSONL ledger before database changes. Production requires a configured replica; intake validates replica synchronization and dispatch checks ledger suppression even if a database write previously failed. Restore runs successfully as a native Node process, requires the recovered ledger in production, upgrades the schema, then reapplies withdrawal and erasure before returning an isolated candidate. Erasure removes personal rows and related queued payloads; retention erasure is record-scoped.
6. **Backups:** Production rejects missing/short keys and plaintext retention. Backup manifests contain encrypted and original snapshot checksums. Validated encrypted privacy snapshots accompany database snapshots. S3-compatible replication uploads, downloads to verify content, preserves recovery metadata and applies namespace-bounded retention. AWS CLI is included in the release image; the scheduler cannot record a successful backup if replication fails.
7. **Access and retention:** Unique signed sessions identify the configured operator, support logout and fail closed on revocation-storage errors. Sensitive routes no longer accept a raw admin key. Production requires the private gateway, and public Caddy strips its identifying header. Audit failures abort sensitive changes; import/sync actions are audited. A conversion endpoint records reviewed status/timestamps. Unreviewed legacy advisory records and converted records lacking a conversion date are held from deletion.
8. **Validation and notices:** Coercive numeric/object inputs, impossible dates and invalid ranges are rejected. The collection notice describes the implemented retention/backup lifecycle and names configured recipients/processors. Unverified partner wording was reduced. Production collection requires actual recipient, processor, sender and approval configuration.
9. **Dependency repairs:** Patched `proxy-addr` from 2.0.7 to 2.0.8 in the server lockfile and `source-map-js` from 1.2.1 to 1.2.2 in server/client lockfiles. Registry audits of the resulting lockfiles reported zero vulnerabilities.

## Evidence

- **Windows:** 238/238 tests passed across 20 files using Node 24.19.0.
- **Node 22.23.3/Linux:** 238/238 tests passed across 20 files on native container storage. See `audit/2026-10-06/phase3-validation.json` for candidate identity and evidence.
- **26 additional integration regressions:** Real signup/confirmation/digest/unsubscribe routes; rollback on outbox failure; five competing native processes; crash before dispatch and after simulated provider acceptance; lease fencing; bounded 422/429/500/504/timeout failure handling; signed bounce/complaint events and replay; native encrypted restore/deletion replay; S3 transport verification/retention through a fake transport; logout/gateway/revocation failures; conversion/retention and malformed HTTP inputs.
- **Frontend build:** Succeeds; approximately 922 kB JavaScript / 267 kB gzip. The existing bundle-size warning remains a Phase 4 improvement.
- Tests use disposable databases and fake provider responses. No live email, deployment or real remote storage operation was performed. Application migrations were not run against the live/local market database.

## Original detailed-plan gates

| Gate | Requirement | Current status |
|---|---|---|
| G3-1 | Provider failure handling | Locally verified, including actual application paths and bounded errors |
| G3-2 | Duplicate worker prevention | Locally verified across five native processes, with crash/fencing/idempotency tests |
| G3-3 | Expiring single-use tokens | Locally verified through HTTP, including missing expiry and replay |
| G3-4 | Scanner-safe confirmation | Locally verified: GET cannot grant confirmation |
| G3-5 | Suppression enforcement | Locally verified for intake, dispatch, webhook, cleanup and restore |
| G3-6 | Strict input schemas | Locally verified through helpers and HTTP |
| G3-7 | Administrative boundary | Local authorization/revocation/audit tests pass; target private gateway/origins still require verification |
| G3-8 | Encrypted recovery/privacy | Native local recovery verified; independent-host recovery and measured RPO/RTO remain open |
| G3-9 | Owner notice/privacy approval | **Open:** actual notices, partner identity, processors, retention and sender practices need recorded owner approval |

## Remaining release work

Provision and verify the private administrative gateway, independent bucket and current privacy replica, separate key custody, sender/domain/webhook configuration and operational alerts. Complete an authorized staging communications journey and a clean-host restore against the plan's RPO/RTO targets. Record approval of the actual rendered privacy notice and recipient/processor details; review legacy advisory classifications before enabling cleanup.

Phase 4 performance, browser/mobile/accessibility and monitoring evidence remains required. Keep collection/email/cleanup disabled until the applicable configuration and release gates are satisfied. These external requirements are not converted into passed gates by local tests or by merely setting configuration references.
