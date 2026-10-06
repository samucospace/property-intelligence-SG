# Phase 3 operations runbook

The application remains private and public release remains NO-GO until the hosted evidence and owner approvals below are complete. Read-only scope and disabled email/cleanup remain the defaults. Never use live recipients to qualify this work without explicit authorization.

## Deployment configuration

Full production collection validates configuration before startup and at submission/dispatch. Set actual values through the private deployment's secret/configuration system; do not commit them.

| Control | Required configuration |
|---|---|
| Operator access | `ADMIN_OPERATOR`, strong `ADMIN_API_KEY`, separate strong `ADMIN_GATEWAY_SECRET` |
| Owner approvals | `PRIVACY_APPROVAL_REFERENCE`; `RETENTION_REVIEW_REFERENCE` additionally when enabling cleanup |
| Actual advisory recipient | `ADVISORY_PARTNER_NAME`, `ADVISORY_PARTNER_CEA_REGISTRATION`, `AGENT_NOTIFICATION_EMAIL` |
| Named processors | `HOSTING_PROCESSOR_NAME`, `BACKUP_PROCESSOR_NAME` |
| Email | Verified `RESEND_API_KEY`, `SENDER_EMAIL`, `NEWSLETTER_FROM_EMAIL`, `UNSUBSCRIBE_SECRET`, HTTPS `BASE_URL`, `RESEND_WEBHOOK_SECRET` |
| Scope | `RELEASE_SCOPE=full`, `ENABLE_OUTBOUND_EMAIL=true`, `MOCK_EMAIL=false`; enable scheduled newsletter separately |
| Backups | Separately held `BACKUP_KEY_FILE` or strong `BACKUP_ENCRYPTION_KEY`, `OFFSITE_BACKUP_BUCKET`, `OFFSITE_BACKUP_PREFIX`, least-privilege S3-compatible credentials/region/endpoint |
| Privacy | `PRIVACY_LEDGER_PATH` and independently replicated `PRIVACY_LEDGER_REPLICA_PATH` |

The release image contains AWS CLI for the S3-compatible backup transport. Supply credentials at runtime, never in the image. Use a different provider/account for recovery storage. The uploader verifies a downloaded copy before recording success and deletes expired objects only under this application's `property-backup-` namespace. Review bucket IAM, provider lifecycle/version-retention settings and key custody on the host; a successful local transport test is not evidence of storage independence.

Compose passes the new settings and mounts both privacy paths. **Its default `./privacy-replica` folder is a local convenience, not independent recovery storage.** For a full release, override `PRIVACY_REPLICA_HOST_PATH` with an actual independent mounted destination and test loss/reconnect behavior. An unavailable replica prevents acknowledged withdrawal/erasure from being committed to the application database. Any events written locally before a replica error must be reconciled before collection resumes.

## Migration and legacy review

Migration 018 adds outbox leases, consent/provider event history and retention review timestamps. It invalidates old confirmation tokens without defensible expiry, quarantines existing confirmed newsletter contacts for fresh verification, and suppresses legacy queued work requiring reviewed requeue. Existing lead records remain available for review.

Take a verified pre-migration backup. Apply migrations through the existing single-owner startup/maintenance path. Use a disposable copy to verify legacy row counts and operational tables before upgrading the private host.

With the current database initialized, provision the ledger explicitly:

```sh
node server/scripts/initialize-privacy-ledger.js
```

This exports existing suppression records without truncating an existing ledger. It refuses to silently replace a missing/out-of-date replica. Initialization is for a known current database, **not** a way to manufacture an empty privacy history after losing the host.

Review legacy advisory classifications before enabling cleanup. `POST /api/admin/leads/:id/conversion` accepts `{ "converted": true }` or `{ "converted": false }`, records the operator action and marks the record reviewed. Converted records receive a conversion timestamp; converted records without one and unreviewed legacy advisory records are held from deletion. New advisory submissions have an explicit reviewed default of unconverted. The approved retention schedule uses 12 months from creation for reviewed unconverted enquiries and five years from recorded conversion for converted enquiries.

## Private administrative access

The public Caddy proxy strips `X-Admin-Gateway`. Administrative routes require a separately protected private gateway in production. `Caddyfile.private-admin.example` shows an allowlisted private listener; verify its IP restrictions/TLS and the absence of a public route or direct exposed backend port. Prefer a VPN/private network; if the chosen gateway also provides MFA, record and test that policy.

Log in through the private gateway with `POST /api/admin/login`; use the issued operator-bound two-hour `X-Admin-Session`/Bearer token. Direct `X-Admin-Key` access to sensitive routes is rejected. Logout revokes that unique token. Scheduled maintenance uses its internal database connection; it does not need unrestricted public service-key access. Changing the signing key invalidates outstanding sessions. Database revocation errors deny access, and audit failures abort sensitive actions.

## Email dispatch and provider events

Signup/advisory endpoints return 202 for durable queued work. A queued response does not claim inbox delivery. The scheduler's `cron-email-outbox` checks due work every minute when live email is explicitly enabled. Weekly newsletter generation enqueues one item per recipient/campaign; provider acceptance alone advances newsletter acceptance metadata.

Claims have five-minute leases; batches are limited to ten, with a 15-second provider timeout. A stale claimant cannot persist an acceptance after another worker takes ownership. Requests carry stable provider idempotency keys. Resend currently retains keys for 24 hours; work whose first dispatch is older than 23 hours is held as `permanent_failed` with an uncertainty message rather than blindly resent. See [Resend's idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys).

If acceptance is uncertain, review the provider receipt before explicitly creating a replacement intent. Never reset claims or change keys as a shortcut. Mock dispatches cannot become live acceptance. Accepted payloads are scrubbed; erasure/suppression also scrubs affected queued payloads.

Configure the provider webhook to `POST /api/email/webhook`, selecting delivery, bounce and complaint events. Signature verification uses the original raw request bytes. Events are deduplicated by the signed provider event ID; bounce/complaint events append privacy history and suppress further sends. Provider acceptance remains distinct from delivery history. Exercise actual provider test events and verify DNS/domain/sender authorization before live use.

## Backup and restore

The scheduled backup uses a consistent SQLite snapshot, encrypts it with AES-256-GCM and writes a manifest containing both encrypted and original snapshot SHA-256 values. Production refuses missing/weak keys and plaintext retention. The privacy ledger also receives a validated encrypted snapshot and manifest; its continuous independent replica covers withdrawals/deletions after the daily backup. Both artifacts replicate before the backup job is reported successful. Failed replication must be alerted through the deployment's operational monitoring.

For recovery, stop application/scheduler traffic, obtain the encrypted database, its manifest, the separately held key and the latest independently recovered privacy ledger. Verify the encrypted file against the manifest; the restore command verifies the decrypted snapshot checksum and SQLite integrity/foreign keys, upgrades the schema, then replays privacy before returning an isolated candidate:

```sh
node server/scripts/restore-baseline.js \
  --backup=/recovery/property-backup.db.enc \
  --key-file=/secure/property-backup-key \
  --output=/recovery/verified-restored.db \
  --sha256=PLAINTEXT_SNAPSHOT_SHA256_FROM_MANIFEST \
  --privacy-ledger=/independent/current-withdrawals.privacy.jsonl
```

Use the manifest's `snapshotSha256`, not the encrypted file checksum. Production restore rejects a missing ledger input. The returned `sourceSha256` describes the original snapshot, while `sha256` describes the reconciled output. Global erasure removes restored personal records and queued payloads; scoped retention tombstones remove the particular expired record without withdrawing an unrelated active subscription.

If privacy freshness cannot be established, keep traffic and sending disabled. Verify current-schema table counts, reviewed consent state and job state before using the existing controlled swap procedure. Measure recovery against the detailed plan's 24-hour RPO / under-30-minute RTO targets. Record actual times and key access from a clean host, rather than assuming local test timings establish them.

## Evidence still required before full release

- Owner approval of the actual rendered notice, named recipient/registration, processors, transfer arrangements, retention and sender practices.
- Verified private gateway/proxy, TLS/origin behavior, secrets and filesystem access on the target host.
- Authorized staging recipient's complete signup, explicit confirmation, digest, unsubscribe and bounce/complaint journey.
- Independent bucket/ledger replica, replication failure/reconnect checks, effective remote retention and clean-host restore with measured RPO/RTO.
- Received backup/email failure alerts and at least one actual scheduled run. Phase 4 capacity, browser/UX and monitoring evidence remains separately required.
