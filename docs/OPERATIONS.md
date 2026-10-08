# Singapore Home Intel operations

Canonical operating guide, updated **8 October 2026**. Release/incident owner: **Sam Fraser**. Product rules: [PRODUCT_SPEC.md](PRODUCT_SPEC.md). Working rules: [AGENTS.md](../AGENTS.md). Historical evidence: [archive index](archive/README.md) and `audit/`.

**Public launch remains NO-GO.** Private analytics-only staging is deployed. This document consolidates observations made through **7 October 2026**; it does not claim a new host inspection on 8 October. Recheck host state before any operational change. Source implementation, local tests, host verification and owner approval are separate evidence categories.

## Operating inventory

| Item | Last observed/configured state, 7 October |
|---|---|
| Host | DigitalOcean SGP1, `159.223.40.68`; Ubuntu 24.04.5, 2 shared vCPU, 4 GB RAM, 80 GB disk |
| Domain | `homeintel.sg`, Namecheap BasicDNS; A `@` and `staging` to the host, CNAME `www` to `homeintel.sg` |
| Private URL | `https://staging.homeintel.sg`, password protected, no-index; apex/www are not the application launch endpoints |
| Access | SSH key login as `homeintel`; password/keyboard-interactive login disabled; Docker membership is privileged access |
| Exposure | Caddy 80/443; backend **127.0.0.1:3001 only**. Never add public port 3001/all-TCP rules. Keep SSH restricted to authorized operator addresses and verify cloud rules independently of UFW |
| Compose | Project `homeintel-private`; `/opt/homeintel/release/compose.private-local.yml` plus `compose.staging-proxy.yml`; explicit `maintenance` scheduler profile |
| Image | `property-intelligence-sg:map-ux-20261007`; identity `sha256:5a6205393991b9e68ac1aa6c064faff040eff99bd5b81da3adc10bc7a9993e16` |
| Built source | `58a031ebc552f13f68ba72240eb58540674bceee`; subsequent documentation commit `94af571` does not change the deployed image |
| Persistent files | `/opt/homeintel/data`, `/opt/homeintel/privacy`, `/opt/homeintel/privacy-replica`; last two have empty history in this zero-contact pilot |
| Private configuration | `/opt/homeintel/config/runtime.env`, `staging-proxy.env`; restrictive permissions, no values committed |
| Backup key | `/opt/homeintel/backup-keys/backup-encryption.key`, mounted read-only; recovery copy must remain outside the host and Git |
| Offsite storage | Independent Backblaze B2 account, bucket `homeintel-backups-lovelyview`, region `us-east-005`, endpoint `https://s3.us-east-005.backblazeb2.com`, application prefix `homeintel/` |
| Scheduling | Separate scheduler: encrypted daily backup at **04:00 Asia/Singapore**. Sync, cleanup, newsletters/customer email and internal alert monitoring remain disabled |
| Alert approach | UptimeRobot independent availability emails; separate Resend operational email transport to the owner's privately configured mailbox. Resend account/sender setup and receipt tests remain open |

The checked-in [deployment compose snapshot](../audit/2026-10-07/compose.private-local.yml) and [proxy overlay](../audit/2026-10-07/compose.staging-proxy.yml) document this deployment, not future release defaults. Staging Caddy strips incoming `Authorization` and `X-Admin-Gateway` before proxying and keeps certificate volumes persistent. A certificate was issued on 7 October; future renewal has not been observed. Recovery-key copies and provider credentials remain private and ignored; move any plaintext credential notes into the owner's password manager without publishing their contents.

## Containment that must stay enabled

Keep `RELEASE_SCOPE=analytics-readonly`. `/api/features` controls visible scope; blocked collection/admin endpoints must fail server-side even with valid credentials. Outbound customer email, data sync and cleanup stay disabled. The separate scheduler may run approved backups; this does not authorize other jobs. No real contacts are uploaded to the current pilot database. An existing source database's contact/privacy history is not disposable merely because this pilot is read-only.

The local `privacy-replica` directory is an **empty-history placeholder**, not independent recovery storage. Do not import contacts or enable consent features until independent durable append/fsync replication is configured and loss/reconnect/replay is tested. A daily B2 backup or unverified object-storage mount does not satisfy synchronous privacy-event protection.

## Daily checks and incidents

Connect using the operator's SSH key. These are **read-only commands on the Droplet**, not commands to paste into local PowerShell:

```sh
cd /opt/homeintel/release
docker compose --project-name homeintel-private --env-file /opt/homeintel/config/runtime.env -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance ps
docker compose --project-name homeintel-private --env-file /opt/homeintel/config/runtime.env -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance logs --tail=100 app scheduler caddy
curl --fail --silent http://127.0.0.1:3001/api/health/ready
df -h /opt/homeintel/data
docker stats --no-stream
```

Inspect logs privately; do not paste credentials, confirmation links or contact records into reports. Check persisted `job_history`, offsite artifacts and monitoring states using a read-only database connection or existing diagnostic tooling; a running scheduler is not proof that a due-time backup succeeded.

| Probe | Interpretation |
|---|---|
| `/api/health/live` | HTTP process answers; a sustained failure needs investigation |
| `/api/health/ready` | Required schema, populated market and current prepared defaults; 503 means keep traffic out |
| `/api/health` | Legacy database connectivity, insufficient to certify readiness |

Protected HTTPS probes require staging authentication. Configure the external uptime service's supported authenticated probe securely, then demonstrate outage and recovery emails. Do not remove protection to make a monitor work or put passwords in a URL/repository.

For internal alerts, first create/verify Resend account and sending domain. Privately configure a separate restricted `OPERATIONS_RESEND_API_KEY`, `OPERATIONS_ALERT_TRANSPORT=email`, fixed `OPERATIONS_ALERT_EMAIL_FROM`/`OPERATIONS_ALERT_EMAIL_TO`, and production-mode delivery. Only enable `ENABLE_OPERATIONS_MONITORING=true` after configuration and an authorized receipt drill; test/mock modes cannot prove actual receipt. Keep customer email disabled. A supplied UptimeRobot URL may be a heartbeat/callback, not an incoming application-alert destination. External monitoring remains necessary when the process or its email provider fails.

Monitor readiness, backup age (26 hours), failed/interrupted jobs, disk space (512 MiB threshold), source periods (120 days), enabled-sync age (eight days), email queue failures when enabled, and privacy replica availability when configured. These are implemented initial thresholds, not completeness promises. For disk/database/privacy failure, stop imports and keep collection/sending disabled; preserve evidence and repair storage before retrying. For provider failure, preserve the queue/idempotency keys, inspect receipts and correct transport rather than blindly resending. Never remove WAL, swap journals or maintenance markers to force a green status.

## Change, qualification and deployment procedure

1. Work locally against isolated fixtures. Use Node **22.23.3** and the lockfiles. From the root, `npm ci`, `npm --prefix server ci`, `npm --prefix client ci`; `npm test` runs the server suite and `npm run build` builds the client. Follow the test harness's isolation; never substitute an operational database path.
2. Keep approved metric/coverage semantics intact. Build and test the exact release image; record source commit, image identity, runtime, configuration scope and dataset generation. A documentation-only commit requires documentation checks, not a redeployment.
3. Prepare a new market-only deployment export without copying contact/job/privacy data. The profiling helper `server/scripts/prepare-staging-db.js` creates marked isolated fixtures **with two synthetic contacts**; do not mistake it for the zero-contact deployment export or overwrite an existing destination.
4. Before a deployment/migration, verify encrypted pre-change backup and separately held keys, stop scheduler writes, drain requests as required and verify rollback compatibility on an isolated restored copy. Keep persistent directories and certificate volumes. Do not assume an older image can read a newer schema.
5. Deploy the approved candidate to protected staging, verify readiness/health/frontend, contained routes, proxy headers/origins, permissions, port binding and restart behavior. Observe CI for that source revision and host tests; an older pass is not current evidence.
6. Record dated results in `audit/YYYY-MM-DD/` and update this inventory/gate table. Do not relax performance budgets or turn off protection to obtain a pass. Public traffic follows a separate owner release decision.

Useful isolated qualification entry points are `server/scripts/qualify-release-image.js`, `qualify-startup.js`, `profile-analytics.js`, `qualify-phase4-http.js`, and `qualify-phase4-browser.cjs`. Inspect their CLI/environment and required isolated fixture setup before running. Prepared/default serving and raw cold-query measurements must be recorded separately. Browser/error simulations do not establish external tile delivery. Restart isolated test containers to reset real rate limits; do not count 429s as successful capacity.

### Performance requirements and current limits

Keep the original targets: default sales/rental responses **under 300ms and 500KB**, compact project payload **under 1.5MB**, concurrent added delay **under 100ms**. No project-endpoint latency budget was approved. Agree any additional cold/warm p95/p99, sustained concurrency/error and total-memory budgets with the owner before treating a workload as release qualification.

On the actual host, 7 October prepared/default sales measured 129.6ms/27,926 bytes, rentals 116.7ms/119,006 bytes, projects 564.5ms/1,019,558 bytes, and added concurrent delay 4.0ms. Those original default targets passed. A short 140-request/10-caller mixed workload had p95/p99 about 6.52/6.56 seconds and a broad raw rental request about 10.65 seconds. Broad cold custom queries and sustained capacity remain unresolved; do not present prepared results as cold-query compliance.

The implementation bounds retained analytics buffers to 32MiB/50 entries/60 seconds; active calculations, workers and other caches are additional memory. Heavy queries allow one active calculation and sixteen queued; excess distinct misses receive 503 with `Retry-After: 5`. Identical misses coalesce. Docker sets `UV_THREADPOOL_SIZE=16` before Node starts; dotenv after startup is too late. Startup prepares defaults before accepting traffic and refreshes preparation every thirty seconds. Generation fences protect market freshness.

## Backup, restore and rollback

Daily backups use consistent SQLite snapshots, mandatory AES-256-GCM encryption and manifests containing encrypted and plaintext snapshot SHA-256. Database and privacy artifacts upload offsite and are downloaded/verified before success is recorded. Application retention is 30 days within its `property-backup-` namespace; separately verify B2 versions/lifecycle and restricted key permissions. Preserve a recovery key outside both host and repository and test access before claiming recoverability.

On 7 October, two real encrypted backups uploaded/downloaded successfully. A separate Windows/Docker restore using offsite artifacts and separately held keys verified authentication, hashes, integrity, foreign keys, schema and counts in **83.542 seconds**, with zero contacts. This establishes data restore evidence; it does not establish complete replacement-server/application recovery or replay of real privacy history. A manual invocation of the scheduler job is not an observed 04:00 timer slot.

Recovery targets remain **RPO at most 24 hours; RTO under 30 minutes**. Recover onto an isolated candidate first:

```sh
node server/scripts/restore-baseline.js \
  --backup=/recovery/property-backup.db.enc \
  --key-file=/secure/property-backup-key \
  --output=/recovery/verified-restored.db \
  --sha256=PLAINTEXT_SNAPSHOT_SHA256_FROM_MANIFEST \
  --privacy-ledger=/independent/current-withdrawals.privacy.jsonl
```

Run in the matching controlled recovery environment/image with private configuration. Use the manifest's **snapshotSha256**, not the encrypted checksum, after verifying the downloaded encrypted artifact against its manifest. Restoration authenticates/decrypts, checks the complete snapshot, integrity/foreign keys, upgrades schema and replays independently recovered privacy events. `sourceSha256` describes the original snapshot; final `sha256` describes the reconciled candidate. Production rejects missing ledger input. For this zero-contact pilot, prove empty-history provenance; for contacts, establish current independent history before resuming traffic/sending.

Stop scheduler and new requests, drain app writes and retain a verified pre-change backup before any controlled swap. Validate schema/table counts, approved metric samples, job state, consent/suppression and readiness on the candidate. Preserve operational history and replay withdrawals/erasures/retention tombstones to prevent resurrection. Use the existing reviewed swap/recovery-marker machinery; **do not blindly rename restored files over the live database**. If freshness or rollback compatibility cannot be established, keep service contained and investigate.

General source rebuild/scheduled replacement remains quarantined. Read-only capture/normalization/reconciliation tools can prepare new evidence, but do not authorize promotion. The one-time `finish-phase2.js` procedure is bound to the approved 5 October snapshot and must not be rerun as routine maintenance. Never remove its journals to bypass recovery ownership checks.

## Remaining gates and next actions

All engineering implementation reports are subject to the original exit gates. Sam owns decisions and supplies account/recipient access; engineering supplies isolated and hosted evidence. Close each row only with a dated artifact/observation and any required owner approval.

| Gate | Evidence through 7 October | Next action / accountable party |
|---|---|---|
| Startup/data correctness | Reconciled source; approved metrics/35 identities; startup race repaired; 282 tests passed on Windows/Linux; 55 actual-host isolated startup trials passed | Engineering: retain regression coverage and qualify any changed candidate |
| Private host/proxy | Protected TLS, backend loopback, restrictive files and empty-contact dataset observed | Engineering/Sam: recheck cloud SSH allowlist, actual config and image before changes; observe certificate renewal |
| Scheduled backup | Manual app and scheduler job runs/offsite verification passed | Engineering: observe and record actual 04:00 due-time run, persisted success and overlap/restart behavior |
| Backup custody/retention | Independent B2 transport and isolated data restore passed | Sam + engineering: verify owner vault access, effective provider version retention and bucket/key restrictions |
| Full recovery/rollback | 83.542s isolated data restore; local crash/swap regressions | Engineering: clean replacement-host HTTPS recovery and timed application/data rollback, proving 24h RPO / <30min RTO |
| Received alerts | Transport implemented; Resend setup/actual receipt unverified | Sam: create/verify sender account; engineering: configure and exercise internal failure/resolution plus independent uptime emails |
| Capacity | Original default targets pass; broad cold queries slow | Engineering + Sam: improve broad cold queries, agree missing budgets and run sustained target-host workload/memory qualification |
| Browser/release artifact | Local browser/accessibility/error tests, private map changes and source CI evidence | Engineering: current candidate browser/mobile/real tile checks, dependency/secrets/artifact review; retain exact evidence |
| Public analytics launch | No owner sign-off or observation plan completed | Sam + engineering: close applicable gates, freeze candidate/backup, specify rollback triggers and small-audience observation plan before Phase 5 |
| Real contact/consent scope | Disabled, zero-contact pilot; local code tests only | Sam: actual notices/recipient agreement/registration/processors/retention/sender approval; engineering: independent continuous privacy replica and loss/reconnect/replay tests |
| Customer communication/admin | Disabled; provider/consent/access logic locally tested | Engineering + Sam: private operator gateway/session verification and authorized signup-confirmation-digest-unsubscribe/bounce/complaint journey before enablement |
| Future source maintenance | Reviewed snapshot only; replacement remains quarantined | Engineering + Sam: complete fresh-source/identity review and preservation evidence before any new promotion |

Analytics-only scope can defer customer communication/adviser gates while keeping those features disabled; it does not defer recovery, monitoring, truthful analytics or capacity. Phase 5 is controlled launch after applicable gates and explicit owner sign-off, not the only remaining work.

For a later full release, require a separately protected admin gateway (the public proxy strips `X-Admin-Gateway`), operator-bound two-hour revocable sessions, deny on revocation/audit failures, and private sender/webhook secrets. Preserve expiring single-use confirmation, durable leased outbox/idempotency and bounce/complaint suppression; provider acceptance is distinct from inbox receipt. Review uncertainty before replacement sends rather than resetting claims. Initialization of a privacy ledger from a known-current database cannot manufacture lost independent history. The archived [Phase 3 runbook](archive/remediation-2026-10/PHASE_3_OPERATIONS_RUNBOOK.md) supplies historical implementation detail; revalidate code/configuration before adapting it, under the current gates above.
