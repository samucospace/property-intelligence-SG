# Phase 4 operations and qualification runbook

Public launch remains NO-GO. Use the Phase 3 closeout checklist for infrastructure, recovery, email and recipient approvals. All local Phase 4 qualification used sanitized market data, synthetic contacts and blocked/fake external communications.

## Start and monitor

Use the exact candidate digest recorded in the Phase 4 qualification report. Docker sets `UV_THREADPOOL_SIZE=16` before Node starts. For a non-Docker process, set it in the launching environment; loading it from dotenv after startup is insufficient. Heavy analytics have one active calculation and at most sixteen queued calculations. Identical misses share work; additional distinct misses receive 503 and `Retry-After: 5`.

Startup applies migrations 019–021 and prepares three default analytics materializations before listening. Allow startup preparation time; do not route public traffic to an empty database. Preparation runs again every thirty seconds. Materializations are keyed by market generation and Singapore calendar day. Market writes invalidate them, while lead/job writes do not. A market change during a raw calculation rejects the result with 503 rather than publishing a potentially mixed generation. During maintenance or controlled swaps, readiness fails closed. Probe results can be cached for five seconds.

| Probe | Meaning | Action |
|---|---|---|
| `/api/health/live` | HTTP process answers; independent of analytics limits | Restart only for a sustained process failure; investigate first |
| `/api/health/ready` | Required schema, populated market and current prepared defaults | 503 means keep traffic out and inspect startup, maintenance, data or preparation |
| `/api/health` | Legacy database connectivity only | Do not use this to certify release readiness |

Health routes have no public analytics rate limiter. Short metadata and autocomplete reads use a reserved read-only connection, retaining database-maintenance and generation checks. The retained analytics cache stores serialized buffers with a 32 MiB byte budget, fifty-entry limit and sixty-second TTL. This budget excludes active calculations, worker memory and the other domain caches; measure total process memory separately.

## Operational alerts

Set `ENABLE_OPERATIONS_MONITORING=true` and a private HTTPS `OPERATIONS_ALERT_WEBHOOK_URL` only after selecting the operator and transport. The maintenance scheduler checks once per minute. The web process does not start maintenance. A 2xx webhook response establishes transport acceptance; it does not prove an operator received or acknowledged the alert. Confirm that separately with a real, authorized failure drill. Test/staging never posts to the real endpoint.

Signals include missing migrations/market/prepared analytics, failed or interrupted jobs, no successful backup for 26 hours, source-sync age over eight days when sync is enabled, sale/rental periods older than 120 days even in read-only scope, delayed/permanently failed email work when sending is enabled, less than 512 MiB free database-volume space, and an unavailable configured privacy replica. These are initial operational thresholds, not promises about provider publication schedules or dataset completeness.

Issue transitions and alert intents persist in SQLite. Claims have two-minute leases, ten-item batches and at most five retries with backoff. Idempotency keys remain stable across retries. Exhausted work stays visible and the monitor reports partial success. Mock transport stays pending and never becomes accepted. Database/disk failure uses an independent emergency webhook path, throttled to once per fifteen minutes per process; receiver-side idempotency is needed across restarts. A dead process cannot monitor itself: an external uptime/host agent and named incident owner remain hosted requirements.

For a disk incident, stop imports and inspect the actual volume. Keep sending disabled if privacy persistence cannot be established. For provider failure, preserve the durable queue and correct the transport before retrying. For stale sources, inspect capture/sync history and source publication periods. For backup failure, verify the independent destination and key access before claiming recovery protection. Use the Phase 3 runbook for privacy-preserving restore.

## Repeat local qualification

1. Prepare a new market-only staging database using `server/scripts/prepare-staging-db.js`; never point profiling or test startup at the live database. The profiler refuses a missing staging marker.
2. Build the candidate and test images from the current Dockerfile and `audit/2026-10-06/Dockerfile.phase4-tests`. The test image includes the map decoder source; the release image contains the built frontend.
3. Run the server test suite from the `server` directory. Run the Linux test image with external networking disabled. Tests use isolated disk fixtures.
4. Run `server/scripts/profile-analytics.js --db=SANITIZED_PATH --prepared --output=REPORT_PATH`. Record both preparation cost and serving cost. Prepared serving is not an unprepared raw calculation.
5. Run `server/scripts/qualify-phase4-http.js --url=http://127.0.0.1:PORT --output=REPORT_PATH` against a fresh, resource-limited isolated container. Record image digest, server runtime, full table counts and memory high-water mark alongside its output. The client runtime in that JSON is not the container's server runtime.
6. Run `server/scripts/qualify-phase4-browser.cjs` with `--url`, `--playwright`, `--chrome` and `--output` paths. It uses a temporary headless browser profile, blocks external services and exercises real local analytics. Error/empty/loading responses are explicitly simulated. Map tile delivery itself remains unverified.
7. Restart between HTTP and browser suites to reset the real per-IP request limiter; do not disable it or count 429 responses as successful capacity. The recorded 140-request workload is short local characterization, not a sustained hosted soak test.
8. Observe actual scheduler timer slots separately, retain `job_history` and alert state, then stop the test scheduler. Fake transport acceptance must remain zero.

## Application and data rollback

Stop the scheduler and new requests, then drain the web process before any database replacement. Preserve a consistent encrypted pre-change database and independently current privacy ledger. Never copy a live SQLite main file while ignoring its WAL. Test the previous image on a disposable restored copy before switching versions; a newer schema is not automatically safe for an older image.

For a data rollback, use the Phase 3 restore command, checksum and integrity checks, current migrations and suppression replay. Promote only through the existing controlled swap/recovery-marker procedure. Clear derived analytics snapshots in a rebuild candidate and prepare new defaults on restart; do not copy obsolete snapshots back as operational state. Validate table counts, metric samples, readiness, contained routes and privacy before restoring traffic. Do not erase operational or privacy state merely to restore older market data.

Local crash/swap/restore tests are regression evidence. Actual proxy/TLS, a clean-host offsite restore, timed application/data rollback and operator receipt are still required on the intended infrastructure.
