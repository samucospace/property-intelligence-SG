# Phase 0 correction and verification report — 2 October 2026

**Status: Local containment and recovery controls verified. Hosted/off-host exit evidence remains pending deployment.**

This revision replaces the original claim that every Phase 0 gate had passed. Governing scope is [Phase 0 of the remediation plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md). Sam Fraser is the release owner and operational contact, confirmed directly in the chat. The application remains **NO-GO** because Phase 1/2 and subsequent release gates remain open.

## Corrections implemented

1. **Unsafe operations contained:** Operational rebuilds reject execution, including `--force`. Explicit disposable test fixtures remain available. The amenity seeding leak into the primary database was fixed. Ingestion APIs, sync script and scheduler sync default to disabled. Startup, direct-script and scheduled lead cleanup default to disabled.
2. **Read-only release enforced:** Server-side guards reject lead submission, newsletter confirmation and admin access, including exports/deletions. `/api/features` keeps the corresponding client flows hidden. Existing unsubscribe handling remains available.
3. **Every sender isolated:** Confirmation, agent notification and weekly newsletter use `emailAdapter.js`. Staging/test always use fake transport. Production live sending requires full scope and explicit enablement; provider failures are checked. Mock newsletter captures do not mark contacts as having received a live dispatch. Durable delivery/idempotency/consent remains Phase 3 work.
4. **Credential and database separation:** Staging/test skip automatic local `.env` loading. Staging requires explicit `DB_PATH`, mock provider credentials and a staging marker before migrations/startup. A separate example environment documents launch configuration.
5. **Staging no longer copies PII:** Preparation copies only allowlisted market tables into a new file, creates two synthetic leads, and excludes all source contacts, tokens and job logs. Existing/source targets are refused. Current schema/catalog migrations are applied to the disposable staging target.
6. **Durable recovery:** New captures use unique names and a retained 32-byte random key file outside backup/restore directories. A separate restore process validates AES-GCM authentication, complete snapshot SHA256, all-table counts, integrity and FKs. Capture also preserves source/build files with hashes and records Git HEAD/runtime. Production recurring backups now require encryption configuration rather than silently storing plaintext.
7. **Honest governance:** Sam is named; local versus future off-host evidence is explicit. Previous unsupported approvals and “all gates passed” statements have been removed.

## Independent verification

| Check | Result / evidence |
|---|---|
| Isolated regression suite | **142/142 tests passed, 12/12 files**, Node v24.19.0 on Windows; `audit/2026-10-02/phase0-fix-tests.log` |
| Frontend production build | Passed; existing large-bundle warning remains a Phase 4 concern |
| Operational rebuild rejection | Regression verifies rejection before touching a sentinel file; force does not bypass quarantine |
| Disabled HTTP routes | Thirteen route/method variants return 403 with no DB creation, including case and trailing-slash variants; real prepared staging rehearsal confirms lead/admin/confirmation/sync containment |
| Actual staging data | **5,903 projects; 133,418 sales; 450,722 rentals; two synthetic leads; zero copied job-history rows; ten migrations** |
| PII sanitation with nonempty source | Fixture contains private names, notes, email, phone, token and job-error sentinels; none reach staging, including a raw-byte sentinel check |
| All email paths | Confirmation, advisory and weekly fixture dispatch captured without provider requests; simulated provider failure returns 503; mock newsletter leaves sent timestamp null |
| Staging startup | Health `ok`, forbidden routes 403, two synthetic leads unchanged; `audit/2026-10-02/phase0-staging-rehearsal.json` |
| Recovery fixture | New-process restore from persisted separate key passes; wrong key and overwrite rejected; source lead/token state preserved |
| Actual current-market recovery | See the unique capture manifest under `server/backups/` and `audit/2026-10-02/PHASE_0_LOCAL_RECOVERY_VERIFICATION.md`; original baseline is not overwritten |

## Original exit-gate disposition

| Original Phase 0 requirement | Current disposition |
|---|---|
| Baseline can be restored | Locally verified, with persisted separate key and fresh-process restore |
| Off-host recovery copy and isolated recovery | **Deferred to private deployment; required before public release.** Daily DigitalOcean backups plus separate-provider encrypted copies are planned, not configured or verified; local machine optional additional copy |
| No unapproved rebuild/mail side effect of deployment | Locally verified containment; maintenance remains separate from web deployment |
| Operational inventory | Updated to distinguish checked-in configuration from hosted/DNS/provider facts not yet verified |
| Sanitized staging/fake services/isolated tests | Locally verified, including nonempty PII fixture and prepared-database startup check |
| Separate staging credentials | Mock-only staging configuration, no automatic production `.env` import; tested |
| Scope and owners written down | Sam Fraser named; read-only scope enforced; public release approval remains pending |

## Deployment-stage acceptance (before public release)

Sam confirmed the project is not live and will not go live until every identified issue is fixed and verified. Hosted backup work is deferred until private deployment: enable daily DigitalOcean Droplet backups, configure automated encrypted database copies to a separate provider/account, retain keys separately, and validate server and database restoration. Record location, key custody, timing, restore results, backup-failure alerts and Sam's acknowledgment. Agree RPO/RTO and retention through the original recovery workstream. See the [deployment-stage backup strategy](PHASE_0_OPERATIONS_RUNBOOK.md#deployment-stage-backup-strategy-deferred-not-live). This deferral does not mark hosted recovery complete or authorize public launch.

Subsequent Phase 1 work repairs and locally verifies ingestion preservation, migration atomicity, scheduler restart guarantees and fixture rebuild recovery; see the [corrected Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md). Target-image/source/operational qualification remains pending. Phase 2 metrics/pagination, detail-location withholding and reconciliation remain open. This historical Phase 0 verification does not certify those later gates.
