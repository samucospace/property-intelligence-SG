# Private deployment status — 7 October 2026

**Status: password-protected staging analytics pilot is healthy over verified HTTPS. Public launch remains NO-GO.** Received operational email, broader cold-query performance and remaining release checks are open.

## Verified on the actual infrastructure

- DigitalOcean Singapore Basic Droplet: Ubuntu 24.04.5 LTS, x86-64, 2 shared vCPUs, 4 GB RAM and 80 GB disk. About 73 GB remains free after provisioning.
- Docker Engine 29.8.2 / Compose 5.6.0 installed from Docker's official Ubuntu repository. Unattended upgrades are active. Password and keyboard-interactive SSH authentication are disabled by the existing configuration. Root key access is retained; the separate `homeintel` deployment account's SSH/Docker access is verified. Docker group membership is privileged host access.
- Host firewall enabled with SSH preserved. Web TCP ports 80/443 permit the configured staging proxy; the application itself still publishes **only `127.0.0.1:3001`**. After the owner updated DigitalOcean cloud firewall rules, external HTTPS became reachable and Let's Encrypt issued a trusted staging certificate. Caddy's pinned deployment validates and runs with persistent certificate storage, a private password hash, stripped inbound administrator/authentication headers and a no-index header. Local HTTP redirects to staging HTTPS.
- External checks from the Windows computer passed at 14:11 Singapore time on 7 October: verified TLS, anonymous/wrong-password rejection, authenticated homepage and built assets, readiness, analytics-only flags, allowed/foreign origin handling, and blocked lead/admin/ingestion routes. A Windows input line-ending error in initial password hashing was corrected before handoff; successful login uses the existing private local password file. No credentials were printed or committed.
- The current app/scheduler image is `property-intelligence-sg:map-ux-20261007`, identity `sha256:5a6205393991b9e68ac1aa6c064faff040eff99bd5b81da3adc10bc7a9993e16`, built from committed source `58a031ebc552f13f68ba72240eb58540674bceee`, remotely CI-qualified and deployed with readiness checks. Prior operations/project-coverage images and the pre-update Compose configuration are retained for rollback. Images were transferred privately rather than published to a registry.
- Production configuration and startup smoke passed on the Droplet. The actual database passes readiness; private restart and persistent storage were checked.
- Dataset: 5,905 projects, 132,305 sales and 451,165 rentals, **zero contact records**. It was derived only from the existing sanitized market copy. The original local database and its privacy history were not migrated, uploaded or modified.
- Real server-side scope reports `analytics-readonly`, with lead capture, customer email, source sync and cleanup disabled. Lead submission and administrator lead login return 403.
- AES-256-GCM encrypted database and empty-history privacy backups uploaded to the independently owned Backblaze bucket and passed downloaded-copy verification. Plaintext snapshot files were removed by the backup operation.
- The scheduler backup path was executed with locking and persisted `cron-db-backup=success` on the actual host. The maintenance service is enabled for daily backups at 04:00 Singapore time; **the next actual timer-driven backup has not yet been observed**. Other gated jobs remain disabled, including operational email until configured.
- Independent restore succeeded in a fresh Docker environment on the separate Windows computer, using Backblaze downloads and the separately retained encryption key, with no Droplet/local live database mounted. Ciphertext/plaintext checksums, schema, SQLite integrity, foreign keys and complete market counts passed. Measured data-download/decrypt/restore time: approximately **84 seconds**. This excludes provisioning a replacement host and restoring public HTTPS, so it does not yet establish complete service RTO.

## Performance on the Droplet

Map UX improvements are deployed and desktop/mobile-qualified: amenity layers start hidden, cluster counts and property colors are explained, hover names identify pins, a fixed inspection panel preserves the search/viewport, explicit filtering is separate, and optional distance rings clear with inspection. See `MAP_UX_IMPROVEMENTS_2026-10-07.md` for evidence. No capacity gate is closed by these interface changes.

The five subsequent filter/search gaps are now repaired and verified on desktop/mobile protected staging. Regency Park's unrestricted five-year rental search includes 430 leases rather than the former 195, without inventing missing floor areas. Mode switching clears price bounds, location searches replace previous locations, full search links survive reload and tables have working pagination. See `FILTER_FIXES_2026-10-07.md` for evidence and limitations. This is not a new sustained capacity qualification.

### Project coverage defect found during owner testing

Binjai Crest exists in the deployed dataset (project 2288): 30 sales classified as `Strata Terrace` and 89 rental records classified as landed house types. The initial frontend omitted `propertyType` and exposed no corresponding selector; the hidden condo default excluded its transactions. This defect is now fixed on protected staging: selected projects include all property types, explicit restrictions are honoured, a visible selector and URL persistence are available, and the general nationwide condo default is retained. The current five-year window returns 28 sales and 88 rentals. Desktop/mobile project-search, link and filter qualification passed; see `PROJECT_COVERAGE_FIX_2026-10-07.md`. The market records themselves were not changed.

Post-backup measurement uses a fresh application process/cache after required startup preparation, server-local HTTP and ten callers. The short workload has 140 mixed requests; it is not a sustained soak or public-network latency test. The app has no explicit container CPU/memory cap on this 2-vCPU/4-GB host.

| Approved original target | Actual-host result |
|---|---|
| Default sales under 300 ms / 500 KB | 129.6 ms / 27,926 bytes — pass |
| Default rental under 300 ms / 500 KB | 116.7 ms / 119,006 bytes — pass |
| Projects under 1.5 MB | 1,019,558 bytes — pass; request took 564.5 ms |
| Concurrent request adds under 100 ms | 4.0 ms — pass |

**Broad uncached performance is materially worse on the shared-CPU host:** the broad rental miss took 10.65 seconds; mixed p95/p99 were 6.52/6.56 seconds. An earlier measurement overlapping backup also recorded slow cold filters. Do not substitute the default passes for a full capacity pass. Cold-query work and sustained workload qualification remain open, and hardware choice alone has not resolved them.

The first raw report carried a hardcoded historical local-hardware description. It is retained as `droplet-http-during-backup.raw.json`; the corrected contextual report states the actual host and backup overlap. The harness now accepts `--hardware` and defaults to unspecified instead of asserting hardware it cannot know.

## Alerts and local source changes

Operator email support uses separate Resend credentials and a fixed operator recipient; it does not enable customer/newsletter sending in read-only scope. Provider message-ID validation, timeouts, idempotency and fake-transport isolation are covered. The suite now passes **282/282 on Windows and Linux Node 22.23.3**, including project/search coverage regressions. Operations preparation is committed as `429c283`; the current combined source through `58a031e` passed GitHub CI.

The actual email recipient is kept in private runtime configuration. Resend account/sender verification/API key are not ready, so **operational monitoring delivery remains disabled and no real operator email was sent**. UptimeRobot's independently delivered availability emails will remain separate. Its supplied monitor/webhook details have not been connected to the application transport.

## Remaining before protected/public use

The favicon update's initial concurrent-startup failure has been reproduced and repaired: amenity seeding and dependent scores now complete atomically, with locked rechecks preventing duplicate startup writes. The data-change guard remains intact. The repaired release passed 75 local-image startups, the strengthened CI on its first attempt, and 55 isolated startup checks on the actual Droplet. Staging is healthy after deployment; see `STARTUP_RACE_REPAIR_2026-10-07.md`. This finding is resolved.

1. DNS publication verified on 7 October after the owner selected Namecheap BasicDNS: direct queries from the Droplet to both `dns1.registrar-servers.com` and `dns2.registrar-servers.com`, and separately to Cloudflare `1.1.1.1`, now return A `159.223.40.68` for both `homeintel.sg` and `staging.homeintel.sg`, and CNAME `homeintel.sg.` for `www.homeintel.sg`. The earlier parking-record discrepancy is resolved for these checked servers; other resolvers may retain cached records until expiry. This does not establish HTTPS availability or approve public launch.
2. Protected staging HTTPS is verified at `https://staging.homeintel.sg`. Use the private local staging password and username `sam`; retain these in the owner's password manager. No main-domain site has been enabled. Certificate persistence is configured; a real future automatic renewal has not yet been observed. External uptime monitoring still needs authenticated access to the protected readiness route, or a separately reviewed minimal probe.
3. Create/verify Resend for operator alerts, privately install a restricted operational key, enable monitoring and prove receipt of deliberate failure/resolution messages. Customer email remains disabled. Configure external uptime monitoring against an accessible, appropriately protected readiness probe.
4. Observe the next real scheduled backup and verify provider lifecycle/version-retention settings and the cloud firewall's SSH restriction. Retain a password-manager/recovery-vault copy of the backup encryption key outside both the server and repository.
5. Address cold custom-query latency, qualify a sustained workload, rehearse application/data rollback on the host, and finish the release review. Do not proceed to public Phase 5 launch merely because readiness is healthy.
6. Before deploying any real contacts or enabling consent/withdrawal features, replace the local empty-history replica placeholder with a failure-tested independent durable privacy-event replica and finish the owner-approved recipient/processor/retention gates. No such continuous replica has been qualified for this contact-free pilot.

## Operator locations

Server Compose file: `/opt/homeintel/release/compose.private-local.yml`; deployment project: `homeintel-private`. Runtime secrets are in `/opt/homeintel/config/runtime.env`, owned privately by the deployment operator. Encryption material is mounted read-only from `/opt/homeintel/backup-keys`. Do not print or commit those files.

Separate recovery copies are retained under the ignored, access-restricted local `.recovery-keys/homeintel-host` directory. This folder is excluded from Git and image build context; cloning the repository does not recover its keys. Move a recoverable copy of the encryption key into the owner's vault before relying on it for a launch.

Evidence: [protected HTTPS checks](audit/2026-10-07/staging-https-results.json), [idle workload](audit/2026-10-07/droplet-http-idle.json), [backup-overlap workload](audit/2026-10-07/droplet-http-during-backup.json), [independent recovery](audit/2026-10-07/independent-recovery-results.json), [Linux regressions](audit/2026-10-07/operations-linux-results.json). The general [Phase 3 closeout](PHASE_3_RELEASE_CLOSEOUT_CHECKLIST.md) and [Phase 4 report](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md) remain the release gate records.
