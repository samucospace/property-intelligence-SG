# Phase 0 local containment, staging and recovery runbook

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


Owner and operational contact: **Sam Fraser**. These procedures support local verification; the governing release remains NO-GO pending the later phases.

## Safe operating mode

Keep `RELEASE_SCOPE=analytics-readonly`, `ENABLE_DATA_SYNC=false`, `ENABLE_LEAD_CLEANUP=false`, `ENABLE_STARTUP_LEAD_CLEANUP=false`, `ENABLE_OUTBOUND_EMAIL=false`, and `ENABLE_SCHEDULED_NEWSLETTER=false`. The same defaults apply when flags are absent. Do not use an operational rebuild; it is quarantined even with `--force`.

The web process has no maintenance jobs. Start maintenance separately only after its required configuration is ready. Do not enable sync until the original Phase 1 safety gates are satisfied, or enable full-product/email/cleanup until the relevant approvals and tests pass.

## Preparing and running staging

Run commands from the repository root with the selected Node runtime available:

```powershell
node server/scripts/prepare-staging-db.js --source=server/property.db --target=server/staging-new.db
```

Choose a **new** target file; existing targets and the source itself are rejected. The script copies allowlisted public-market tables, creates synthetic contacts and a staging marker, and verifies integrity. It never imports production personal data or job logs.

Copy `server/.env.staging.example` to `server/.env.staging`, set `DB_PATH` to the new prepared file, and start explicitly:

```powershell
node --env-file=server/.env.staging server/index.js
```

Staging never loads `server/.env` automatically. Real provider keys and unprepared database paths reject staging startup. `/api/features` must show read-only scope, and submission/admin/confirmation/ingestion requests must return 403. If the feature request fails, client lead capture remains hidden. Full-product fixture testing can use `RELEASE_SCOPE=full` with separate test secrets; the adapter still prevents external sending.

## Capturing a durable local baseline

The first capture explicitly creates a key if it is missing:

```powershell
node server/scripts/baseline-drill.js --create-key
```

The script creates a unique capture directory, reads `server/property.db` through a read-only connection, encrypts a consistent snapshot and verifies restoration in a **new process**. It saves source/build files and hashes. Existing baseline files and existing keys are never overwritten. Subsequent captures reuse the saved key:

```powershell
node server/scripts/baseline-drill.js
```

Default key location is `.recovery-keys/phase0.key`; capture folders are in `server/backups/`; verification restores are in `audit/recovery-drill/`. The key is excluded from Git and container builds. Keep it in a separate secure location with access limited to the recovery operator. Do not place it inside the backup or restored-data directories or disclose its value in logs/reports. After verifying a capture, protect any retained plaintext restore with the same controls as the source data.

The current key folder has restricted Windows permissions verified for Sam, the Codex sandbox account/group, SYSTEM and Administrators. For any new key location, review and restrict Windows permissions explicitly: file creation mode alone does not establish Windows access controls. A key must remain readable by Sam after tooling/process changes; perform a fresh-process restore to verify this.

The historical `baseline-authoritative-20261002.db.enc` was created with an unsaved random key. Do not rely on that encrypted artifact; its historical plaintext baseline remains available, and the new durable captures supersede its recoverability claim.

## Restoring without an application process

Use the paths and `snapshotSha256` from the capture's `manifest.json`; the following placeholders must be replaced:

```powershell
node server/scripts/restore-baseline.js --backup=C:/recovery/capture/database.db.enc --key-file=C:/separate-keys/phase0.key --output=C:/recovery/new-restore.db --sha256=EXPECTED_SNAPSHOT_SHA256
```

The output must be a new isolated file. Wrong keys, hash mismatches, integrity/FK failures and overwrite attempts fail. The script removes a failed output it created. Do not replace a running database with the restored file; any application/data promotion requires the later approved rollback/restore procedure. Keep email, cleanup and sync disabled until suppression/deletion and application compatibility checks are complete.

## Deployment-stage backup strategy (deferred; not live)

Sam confirmed on 2 October 2026 that the project is not live and will not go live until every identified issue is fixed and verified. Configure and validate the following when a private DigitalOcean deployment is established, before public release. These are planned controls, not implemented or tested hosted services.

1. Enable **daily DigitalOcean Droplet backups** for whole-server recovery. The percentage-based plan currently adds 30% to the Droplet cost and retains seven daily copies; confirm pricing and retention during setup. Separately attached volumes need their own snapshot/backup arrangement. [Pricing](https://www.digitalocean.com/pricing/backups), [limitations](https://docs.digitalocean.com/products/backups/details/limits/).
2. Automate consistent, encrypted SQLite backups to **a separate cloud provider/account**, independent of the DigitalOcean hosting account. Select and record the destination at deployment; it is not configured yet. Preserve the manifest and the source/build release artifacts needed for recovery. Sam's local machine may hold an additional copy; it is no longer the planned primary off-host destination.
3. Keep a recoverable copy of the encryption key separately from backup storage, with access restricted to the recovery operator. Agree retention, maximum acceptable data loss (RPO) and recovery time (RTO) with Sam.
4. Rehearse both whole-server recovery and a clean-environment database restore from the transferred encrypted copy. Record destination, snapshot hash, all-table integrity results, duration and operator acknowledgment. Verify automated backup-failure alerts before launch.

DigitalOcean's **99.99% monthly Droplet availability SLA** covers specified infrastructure failures and provides eligible service credits; it excludes application/configuration errors and account restrictions. It does not certify application availability or database recoverability. [Droplet SLA](https://www.digitalocean.com/sla/cpu-droplets). DigitalOcean recommends application-level backups for active database workloads, so server backups complement the tested SQLite recovery procedure.

The hosted/off-host evidence remains open as a deployment-stage acceptance item. It does not require hosting the application now and does not waive any remediation or public-release gate. A second directory on the hosting machine is not an off-host copy.

## Verification records

- `PHASE_0_COMPLETION_REPORT_2026-10-02.md`: current dispositions and evidence.
- `audit/2026-10-02/phase0-fix-tests.log`: isolated regression result.
- `audit/2026-10-02/phase0-staging-rehearsal.json`: actual local staging route/health result.
- `audit/2026-10-02/PHASE_0_LOCAL_RECOVERY_VERIFICATION.md`: actual durable capture/restore evidence.

The test harness isolates database paths and mock credentials before modules import. Run `npm --prefix server test` and `npm --prefix client run build` when npm is available. Node 22 target-image, hosted storage/proxy and actual off-host transfer remain later evidence; local verification must not be relabeled as hosted verification.
