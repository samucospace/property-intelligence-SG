# Operational inventory — corrected 2 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**Release owner and operational contact:** Sam Fraser. **Deployment:** local machine only, as confirmed by Sam. No external hosting is currently established. The previous inventory's DNS/provider configuration assertions were not backed by deployment evidence and are not treated as verified here.

## Processes and operating defaults

| Entry point | Current policy |
|---|---|
| Compose `app` / Docker CMD | One web process; no maintenance launched on deploy; Docker init/restart supervision |
| Compose `scheduler` / `maintenance` profile | Explicit separate scheduler; durable due slots; sync/cleanup/newsletters disabled by default; ecosystem files are legacy references |
| `server/scripts/rebuild-clean-db.js` | Operationally quarantined, including `--force`; injected test fixtures only |
| `server/scripts/sync-ura.js` and ingestion API | Require explicit `ENABLE_DATA_SYNC=true`; keep disabled until Phase 1 safety gates pass |
| `server/scripts/cleanup-leads.js` | Defaults to skipped; full scope plus `ENABLE_LEAD_CLEANUP=true` required operationally |
| Confirmation / advisory / weekly senders | Shared adapter; read-only release disables email; staging/test transport is fake |
| Recurring backup | Production requires configured encryption; off-host transfer not yet configured |

## Runtime and storage

Phase 0 verification used Node v24.19.0; Phase 1 now uses official checksum-verified **Node 22.23.3** on Windows. `.nvmrc`, CI, engines and Docker align to that runtime. Docker supervises separate processes directly; PM2 is not in the release image. See the [Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md) for current target-image qualification status.

- Market database: `server/property.db`; current dataset has 5,903 projects and 584,140 transactions.
- Migration 011 (durable schedule slots) is verified in disposable fixtures; the actual market database was not migrated during this work. Apply pending migrations only through the transactional runner at a controlled startup.
- Prepared staging: `server/staging-phase0-20261002.db`, with only public market data and two synthetic contacts.
- Historical baseline: `server/backups/baseline-authoritative-20261002.db` and its historical recovery artifact; retained unchanged. Its old random encryption key was not saved by the previous drill.
- New durable captures: unique `server/backups/baseline-*/` directories containing encrypted database, manifest and source/build snapshot.
- Recovery key: `.recovery-keys/phase0.key`, excluded from Git and container builds, outside backup/restore directories. Retain separately and review OS access controls.
- New-process restored copies: unique directories under `audit/recovery-drill/`.
- Planned deployment-stage recovery: daily DigitalOcean Droplet backups plus automated encrypted database copies to a separate provider/account (destination not yet selected/configured), with separate key custody and tested restores before public release. Sam's local machine is an optional additional copy. See [backup strategy](PHASE_0_OPERATIONS_RUNBOOK.md#deployment-stage-backup-strategy-deferred-not-live). The project is not live; every identified issue must be fixed and verified before launch.

Configured default web port is 3001; local prepared staging was rehearsed on 3002. Container/proxy configuration proposes ports 80/443 and persistent `/app/data`; this describes configuration, not an existing public deployment.

## Environment contract

| Variable | Purpose / safe operating default |
|---|---|
| `NODE_ENV` | Staging/test never automatically load local `.env` |
| `DB_PATH` | Explicit isolated prepared database required for staging |
| `RELEASE_SCOPE` | `analytics-readonly` by default; only `full` is an alternate supported value |
| `ENABLE_DATA_SYNC` | `false`; keep contained pending ingestion repair |
| `ENABLE_LEAD_CLEANUP` | `false`; retention/preservation approval required before enabling |
| `ENABLE_STARTUP_LEAD_CLEANUP` | `false`; also subject to lead-cleanup policy |
| `ENABLE_OUTBOUND_EMAIL` | `false`; live use also requires full scope and production environment |
| `ENABLE_SCHEDULED_NEWSLETTER` | `false`; subject to scope/outbound gates |
| `MOCK_EMAIL` | Staging/test always fake, even if this flag is accidentally false |
| `RESEND_API_KEY`, `URA_ACCESS_KEY` | Secret credentials; staging accepts only mock values, never copied from local production `.env` |
| `ADMIN_API_KEY`, `UNSUBSCRIBE_SECRET` | Separate application secrets; no raw values in reports; admin routes disabled in read-only scope |
| `BACKUP_KEY_FILE` | Separately retained backup key; preferred for recurring encrypted backup |
| `BACKUP_ENCRYPTION_KEY` | Alternative secret encryption configuration; mandatory encryption in production |
| `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` | Local recurring backup location/retention; not an off-host configuration |
| `BASE_URL`, sender/recipient variables, `ALLOWED_ORIGIN`, `DOMAIN` | Hosted/sender/origin values require later deployment/provider verification |

DNS, sender/domain verification, proxy/TLS behavior, alert routing, hosted storage and actual background schedules remain deployment evidence to collect. This inventory records configuration names and purpose; it does not expose credential values or certify those external systems.
