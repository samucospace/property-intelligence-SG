# Singapore Home Intel: Canonical Technical Hardening, Security & Remediation Report

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**Target Application:** Singapore Home Intel (`property-intelligence-sg` / `my-property-SG`)  
**Domain:** [homeintel.sg](https://homeintel.sg)  
**Document Status:** Canonical Single Source of Truth  
**Date of Compilation:** October 2026  
**Consolidating:**
1. `TECHNICAL_REVIEW.md` (Initial comprehensive codebase review, commit `31ccbd1`)
2. `REMEDIATION_PLAN.md` (Remediation roadmap v1.1.0, Phases 0 through 5)
3. `POST_REMEDIATION_REPORT.md` (First-pass remediation report)
4. `POST_REMEDIATION_REVIEW.md` (Senior technical audit of first-pass remediation)
5. `POST_REMEDIATION_VERIFICATION_REPORT.md` (Verification of P1 blockers, Plan 2.7 clean DB rebuild, P3 hardening)
6. `SECURITY_AND_RESILIENCE_REVIEW.md` (Deep-dive security, resilience & operational readiness audit)

---

## Executive Summary

Singapore Home Intel is an institutional-grade intelligence portal for Singapore private residential property transactions, gross rental yields, and walking-distance livability metrics.

Between September and October 2026, the application underwent multiple rigorous cycles of technical review, security auditing, and operational hardening. Initial assessments revealed severe blockers: 14-second event-loop blocking queries, 95% missing postal district metadata, synthetic data fallback defaults that contradicted product claims, unauthenticated admin routes, open unsubscribe endpoints vulnerable to reflected XSS, missing container background schedulers, live database file-swap concurrency hazards, and unhedged email bombing vectors.

Through a coordinated phased remediation program, all identified issues across the application, database, and infrastructure layers have been systematically resolved:
- **Core Analytics & Memory:** Query latencies dropped from ~13.8s to <35ms (warm) / ~6.5s (cold uncached) by pre-computing 24-month rolling median benchmarks and livability indexes, enforcing bounded SQL pagination, and implementing an LRU cache with deterministic filter key normalization.
- **Data Integrity & Provenance:** Replaced corrupted legacy records with an authoritative clean database rebuild of **582,851 verified transactions** (133,418 sales caveats, 450,722 rental contracts, and 5,938 developments), increasing postal district resolution from 4.8% to **99.3%** across official Singapore districts (`01`–`28`).
- **Security & Privacy:** Admin access is protected by fail-closed, timing-safe evaluation and session tokens; email unsubscriptions use HMAC-SHA256 signatures with RFC 8058 1-click headers; newsletter double opt-in and rate limits prevent abuse; PDPA consent is affirmative and audit-trailed with automated retention purging (PRIV-01); CSV exports are protected against formula injection (CWE-1236).
- **Operations & SRE:** The production Docker runtime standardises on `pm2-runtime` executing the unified Express web application and 4 background cron jobs (URA sync, newsletter, PDPA cleanup, and online backups); backup snapshots are hot-created via `VACUUM INTO`, integrity-verified, and encrypted with authenticated AES-256-GCM (ARCH-01).
- **Quality Assurance:** The automated test suite has expanded from 0 to **101 passing Vitest tests** (100% pass rate across 5 test suites), and both client and server report **0 vulnerabilities** under `npm audit`.

---

## Complete Audit & Hardening Timeline

```
2026-09-30: Initial Technical Review (Commit 31ccbd1)
│   └── 4 critical problem areas, 7 high-severity findings, multiple medium/low defects.
│
2026-09-30: Remediation Plan v1.1.0 Formulated
│   └── 6-phase remediation structure (Phases 0-5) with rollback safeguards and measurable targets.
│
2026-09-30: First-Pass Remediation (Commits 9cb88a8..36bc3fa) & Post-Remediation Report v1.0.0
│   └── Implemented core features, but audit revealed critical defects in implementation.
│
2026-09-30: Post-Remediation Review (Audit of Commits 31ccbd1..b625c67)
│   └── Flagged 8 deploy-blocking bugs (startup crash, cross-averaged medians, empty scatter chart,
│       migration 007 constant-default failure, hash mismatch, unconfirmed newsletter sends).
│
2026-09-30: Priority 1-3 Remediation & Full Clean Rebuild (Commits 31ef8d0..7101a86)
│   └── Resolved all 8 blockers, executed automated Plan 2.7 clean rebuild (582k records, 99.3% districts),
│       enforced CSV injection defense, LRU cache bounding, and Docker non-root user.
│
2026-10-01: Security & Technical Resilience Review
│   └── Identified 13 operational & resilience gaps (SRE-01 container cron omission, SEC-01 newsletter HTML
│       injection, SEC-02 Axios CVEs, ABU-02 email bombing, RES-01 live file lock, PRIV-01 retention, ARCH-01).
│
2026-10-01: Final Resilience Hardening & Verification
    └── 100% resolution of all 13 security/resilience findings, verified with 101 automated Vitest tests.
```

---

## Master Register of Issues Identified & Remediated

This section categorizes every issue identified across all assessments, documenting the root cause, remediation applied, and verification status.

### 1. Architectural, Performance & Query Engine

| ID | Originating Document | Severity | Issue Description & Root Cause | Fix Applied | Status |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **PERF-CORE-01** | `TECHNICAL_REVIEW.md` (Item 1) | **Critical** | `getRentalYieldAnalytics` took ~13.8s and returned 135.6 MB JSON, loading all 405k leases and 128k sales into Node memory, recalculating livability scores per request. Blocked single-threaded event loop. | Implemented SQL aggregations, bounded pagination (`page`, `limit`), pre-computed rolling 24m medians in `project_benchmarks` table, and cached livability indexes. Latency reduced to <35ms cached / ~6.5s cold uncached; payload trimmed to 1.05 MB. | **RESOLVED** |
| **PERF-CORE-02** | `POST_REMEDIATION_REVIEW.md` (Item 1.2) | **Critical** | Migration 005 and `refreshProjectBenchmarks` mixed row numbers for psft and price into a single CTE filter, cross-averaging disjoint rows. Medians for ~1,370 projects were distorted by up to +67%. | Separated calculation into two independent ranked CTEs (`rn_price` and `rn_psft`), calculating exact median price and median psft independently. | **RESOLVED** |
| **PERF-CORE-03** | `POST_REMEDIATION_REVIEW.md` (Item 1.3) | **High** | Sale-mode transaction table and scatter plot were empty (`scatter` returned while client looked for `scatterPoints`), and `livability` returned an unawaited pending Promise. | Returned both `scatter` and `scatterPoints` from `getPriceAnalytics`; derived livability synchronously from pre-computed database fields. | **RESOLVED** |
| **PERF-CORE-04** | `SECURITY_AND_RESILIENCE_REVIEW.md` (PERF-01) | **Low** | Synchronous `fs.readFileSync` executed inside `app.get('*')` catch-all SEO route on every `?project=` request, causing event-loop I/O contention. | Implemented in-memory caching of `index.html` template (`getIndexHtmlTemplate`) in production mode. | **RESOLVED** |
| **ABU-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (ABU-01) | **Medium** | Analytics cache key was vulnerable to cache thrashing via arbitrary query parameters (`_rand`), and radius queries generated thousands of SQL parameter bindings. | Created `normalizeAnalyticsCacheKey` whitelisting valid filter keys, implemented bounding-box SQL pre-filtering, and capped candidate project IDs to 200. | **RESOLVED** |
| **ABU-02** | `SECURITY_AND_RESILIENCE_REVIEW.md` (ABU-02) | **Medium** | No rate-limiting keyed to recipient email addresses on double opt-in newsletter confirmation dispatches, allowing malicious email bombing. | Added `last_confirmation_sent_at` column in migration 008, enforcing a 5-minute cooldown per target email address. | **RESOLVED** |
| **OPS-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (OPS-01) | **Low** | Newsletter dispatcher had no send-state tracking or rate-limiting; a mid-run failure caused duplicate emails upon rerun, and unthrottled sends risked Resend API 429 throttling. | Added `last_newsletter_sent_at` tracking in migration 008, 150ms delay between recipient dispatches, and filtered out subscribers sent to in the prior 6 days. | **RESOLVED** |
| **CACHE-01** | `POST_REMEDIATION_REVIEW.md` (Item 3) | **Medium** | Analytics query cache in `queryEngine.js` was unbounded, risking memory exhaustion under high filter variance. | Implemented LRU cache capped at 50 entries with 60-second TTL and automatic least-recently-used eviction. | **RESOLVED** |
| **PAGIN-01** | `POST_REMEDIATION_REVIEW.md` (Item 3) | **Medium** | Pagination accepted negative page parameters, price endpoint ignored page parameter, and client displayed raw unbounded totals. | Enforced sanitization (`Math.max(1, parseInt(page, 10) || 1)`), aligned rolling 24m volume calculations, and bound client views. | **RESOLVED** |

---

### 2. Security, Authentication & Personal Data Protection (PDPA)

| ID | Originating Document | Severity | Issue Description & Root Cause | Fix Applied | Status |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **SEC-AUTH-01** | `TECHNICAL_REVIEW.md` (Item 6) | **Critical** | Admin endpoints skipped authentication if `ADMIN_API_KEY` was unset; default Docker Compose key was insecure; key was accepted in URL query parameters. | Centralized config in `server/config.js`; enforced fail-closed `requireAdmin` rejecting keys < 32 chars or default placeholders; restricted keys to `X-Admin-Key` header; added timing-safe comparison (`safeEqual`). | **RESOLVED** |
| **SEC-AUTH-02** | `POST_REMEDIATION_REVIEW.md` (Item 1.7) | **High** | Placeholder secrets in `.env.example` (`change_this_to_a_secure_random_key_in_production`) passed minimum length checks and were accepted. | Updated `checkAdminKey` and `config.js` to explicitly reject any secrets containing `change_this`, `example`, or known default patterns. | **RESOLVED** |
| **IAM-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (IAM-01) | **Medium** | Static shared API keys for administrative access lacked session expiration and rate-limiting. | Implemented `/api/admin/login` issuing expiring HMAC-SHA256 session tokens with rate-limited login attempts (5 per 15 minutes) and Bearer token support in `requireAdmin`. | **RESOLVED** |
| **SEC-UNSUB-01**| `TECHNICAL_REVIEW.md` (Item 5) | **Critical** | Unsubscribe endpoint only validated token if provided, allowing arbitrary unsubscriptions by omitting the token; reflected recipient email without escaping (XSS hole). | Required valid HMAC-SHA256 token keyed to `UNSUBSCRIBE_SECRET`; HTML-escaped email output; added RFC 8058 1-click `List-Unsubscribe` GET and POST headers. | **RESOLVED** |
| **SEC-UNSUB-02**| `POST_REMEDIATION_REVIEW.md` (Item 3) | **Medium** | `legacyTokensAccepted()` accepted legacy SHA-256 tokens indefinitely when `LEGACY_UNSUB_UNTIL` was unset. | Updated `legacyTokensAccepted()` to fail closed (`return false`) when `LEGACY_UNSUB_UNTIL` is unset or expired. | **RESOLVED** |
| **SEC-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (SEC-01) | **High** | In `send-weekly-newsletter.js`, project and transaction values from database were concatenated directly into HTML body without escaping. | Wrapped all dynamic database strings (`project_name`, `postal_district`, `floor_range`, `type_of_sale`, `sora_3m`) in `escapeHtml()`. | **RESOLVED** |
| **SEC-02** | `SECURITY_AND_RESILIENCE_REVIEW.md` (SEC-02) | **High** | High-severity prototype pollution, ReDoS, and proxy bypass CVEs in Axios (v1.7.9). | Upgraded `axios` across client and server to patched releases (`^1.13.2+`); confirmed 0 high/critical vulnerabilities via `npm audit`. | **RESOLVED** |
| **SEC-03** | `SECURITY_AND_RESILIENCE_REVIEW.md` (SEC-03) | **Medium** | Permissive default CORS policy (`cors({})`) emitted `Access-Control-Allow-Origin: *` when `ALLOWED_ORIGIN` was unset. | Enforced fail-closed CORS in production: only allow explicit `ALLOWED_ORIGIN`, or restrict to same-origin. | **RESOLVED** |
| **SEC-CSV-01** | `POST_REMEDIATION_REVIEW.md` (Item 3) | **Medium** | Admin CSV export at `/api/admin/leads/export.csv` was vulnerable to CSV Formula Injection (CWE-1236) and accepted query-string auth. | Placed route under `requireAdmin` and sanitized all CSV cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` by prefixing with a single quote. | **RESOLVED** |
| **PRIV-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (PRIV-01) | **Medium** | Unsubscribed users and unconfirmed leads were retained indefinitely with no right-to-erasure mechanism under Singapore PDPA Section 25. | Implemented automated retention purge (`cleanup-leads.js`: purges unconfirmed > 30 days, anonymizes unsubscribed > 90 days with SHA-256 suppression hash) and added `DELETE /api/admin/leads/:id`. | **RESOLVED** |
| **PDPA-01** | `TECHNICAL_REVIEW.md` (Item 110) | **Medium** | PDPA consent checkbox was checked by default; server accepted leads with `pdpaConsent: false`; spam bot submissions allowed. | Set checkbox unticked by default; enforced server-side `pdpaConsent === true` check; added honeypot field (`website`), SG phone regex validation, and double opt-in. | **RESOLVED** |
| **SEC-CSP-01** | `TECHNICAL_REVIEW.md` (Item 62) | **Medium** | Content Security Policy was disabled in Helmet configuration. | Re-enabled Helmet CSP with comprehensive directives (OneMap tiles, Google Fonts, inline script protection) enforced in production (`reportOnly: false`). | **RESOLVED** |

---

### 3. Data Integrity, Geocoding & Provenance

| ID | Originating Document | Severity | Issue Description & Root Cause | Fix Applied | Status |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **DATA-DIST-01**| `TECHNICAL_REVIEW.md` (Item 2) | **Critical** | 95% of developments (3,263 of 3,428) had no real postal district, storing `CCR`, `RCR`, `OCR`, or `00`. URA reported district per transaction, but code read project-level fallback. | Ingestion parses district from individual transactions (`tx.district`) and 6-digit postal sector mappings (`POSTAL_SECTOR_TO_DISTRICT`). Plan 2.7 clean rebuild achieved **99.3% authoritative district coverage** (`01`–`28`). | **RESOLVED** |
| **DATA-GEO-01** | `TECHNICAL_REVIEW.md` (Item 3) | **High** | 2,932 landed transactions were grouped onto one Zehnder Road project; 27 condos on Pasir Panjang Road shared one coordinate due to street-level coordinate inheritance. | Project identity changed to composite `UNIQUE(project_name, street_name)`; removed street-level coordinate copying; implemented exact ellipsoidal SVY21-to-WGS84 math (`svy21ToWgs84`). | **RESOLVED** |
| **DATA-LAND-01**| `POST_REMEDIATION_REVIEW.md` (Item 2.7) | **Medium** | `LIKE '%LANDED HOUSING%'` filter inadvertently matched "NON-LANDED HOUSING DEVELOPMENT" (6,567 rentals). | Added explicit exclusion `AND UPPER(project_name) NOT LIKE '%NON-LANDED%'` in migration 002 and rebuild script; verified non-landed records preserved. | **RESOLVED** |
| **DATA-SYN-01** | `TECHNICAL_REVIEW.md` (Item 4) | **Medium** | Invented defaults contradicted zero-synthetic-data claim: missing contract dates defaulted to `'0124'`, missing tenure to `'Freehold'`, missing rental area to 1,000 sqft, and missing sale yields to hardcoded $2.4M CCR prices. | Completely removed all synthetic defaults from codebase. Missing values remain `NULL`; projects without qualifying sales show "N/A — no recent sales". | **RESOLVED** |
| **DATA-DEDUP-01**| `POST_REMEDIATION_REVIEW.md` (Item 1.5) | **High** | New de-duplication hashes included additional fields, so subsequent syncs would fail to match legacy records and duplicate ~533k rows. | Executed full Plan 2.7 clean database rebuild (`rebuild-clean-db.js`) ingesting fresh URA feeds with atomic replace-by-period and deterministic occurrence indexing. | **RESOLVED** |
| **DATA-SORA-01**| `TECHNICAL_REVIEW.md` (Item 53) | **Low** | Hard-coded SORA table included future speculative months (Oct–Dec 2026) presented as current MAS benchmarks. | Purged future speculative months; pinned benchmarks to verifiable historical MAS reference months; updated newsletter and UI to display reference month. | **RESOLVED** |
| **DATA-MIGR-01**| `POST_REMEDIATION_REVIEW.md` (Item 1.4) | **High** | Migration 007 used `ALTER TABLE leads ADD COLUMN consent_at DATETIME DEFAULT CURRENT_TIMESTAMP`, which SQLite rejects when table contains rows. | Added column without default and backfilled via `UPDATE`; deduplicated existing newsletter emails prior to creating unique partial index. | **RESOLVED** |
| **DATA-SEED-01**| `POST_REMEDIATION_REVIEW.md` (Item 1.1) | **Critical** | Server crashed on startup with `ReferenceError: AMENITIES_SEED_VERSION is not defined` in `livabilityEngine.js`. | Restored and exported `AMENITIES_SEED_VERSION = 1`; wrapped amenity seeding in atomic transaction with source preservation (`source = 'osm'`). | **RESOLVED** |

---

### 4. Technical Resilience, SRE & Container Deployment

| ID | Originating Document | Severity | Issue Description & Root Cause | Fix Applied | Status |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **SRE-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (SRE-01) | **Critical** | Production Docker container executed `node server/index.js`, dropping all 4 background cron jobs (backups, URA sync, PDPA purges, newsletters). | Installed PM2 in Dockerfile; changed runtime command to `CMD ["pm2-runtime", "ecosystem.config.cjs"]`; verified all 5 processes run under process supervision. | **RESOLVED** |
| **RES-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (RES-01) | **Medium** | `rebuild-clean-db.js` executed live synchronous file rename and unlink operations while server held open SQLite handles, risking crashes or descriptor corruption. | Added active server pre-check (`checkIsServerRunning`), instructed offline maintenance, and executed `PRAGMA wal_checkpoint(TRUNCATE)` prior to file movement. | **RESOLVED** |
| **ING-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (ING-01) | **Medium** | Outbound URA API calls lacked HTTP timeouts and retry/backoff, causing worker threads to hang during upstream outages. | Configured Axios client with 30-second timeout, User-Agent header, and 3x exponential backoff retry on HTTP 429/502/503/504 or network errors. | **RESOLVED** |
| **ARCH-01** | `SECURITY_AND_RESILIENCE_REVIEW.md` (ARCH-01) | **Medium** | Database backups stored unencrypted on disk, exposing lead personal data (names, emails, phones) upon host volume compromise. | Extended `backup-db.js` with authenticated AES-256-GCM encryption (`encryptFile`) using `BACKUP_ENCRYPTION_KEY`, verified with GCM auth tags. | **RESOLVED** |
| **DOCKER-01** | `TECHNICAL_REVIEW.md` (Item 7) | **High** | No `.dockerignore` caused local `node_modules` and `property.db` to leak into image; container ran as root; database mounted as single file rather than directory. | Added comprehensive `.dockerignore`; switched container user to `USER node`; mounted `./data:/app/data` directory; passed all required environment guards. | **RESOLVED** |
| **OPS-CRON-01** | `POST_REMEDIATION_REVIEW.md` (Item 3) | **Medium** | PM2 `cron_restart` apps executed immediately upon container startup, causing accidental newsletter sends on deploy. | Added `exec_mode: 'fork'` and `autorestart: false` to cron tasks in `ecosystem.config.cjs`, ensuring executions trigger only at scheduled cron times. | **RESOLVED** |
| **OPS-SHUT-01** | `REMEDIATION_PLAN.md` (Step 5.5) | **Low** | Unhandled process termination left database connections unfinalized and HTTP requests hanging. | Added graceful shutdown handlers (`SIGTERM`, `SIGINT`) closing HTTP server and SQLite database cleanly; `/api/health` returns 503 if database check fails. | **RESOLVED** |

---

## Plan 2.7 Clean Database Rebuild: Verification Metrics

The Plan 2.7 database rebuild was executed to eliminate legacy schema anomalies, unstack copied coordinates, resolve postal districts from transaction caveats, and populate true 24-month median benchmarks.

The table below contrasts the baseline database state against the verified production database:

| Metric / Attribute | Pre-Remediation Baseline | Post-Rebuild State | Improvement / Outcome |
| :--- | :---: | :---: | :--- |
| **Total Developments** | 3,428 | **5,938** | +2,510 developments discovered and indexed |
| **Authoritative Postal Districts (`01`–`28`)** | 165 (4.8%) | **5,894 (99.3%)** | Resolved; 95% missing district defect eliminated |
| **Missing / Unresolved Districts** | 3,263 (95.2%) | **44 (0.7%)** | Non-landed projects mapped to official postal sectors |
| **Missing Coordinates** | 457 | **59** | 87.1% reduction via SVY21 ellipsoidal conversion |
| **Total Sales Caveats** | 128,666 | **133,418** | Complete official caveat transaction history |
| **Total Rental Contracts** | 405,004 | **450,722** | Complete official rental agreement history |
| **Total Transactions Stored** | 533,670 | **582,851** | +49,181 official government records ingested |
| **Pre-Computed Project Benchmarks** | 0 (Computed per request) | **5,938** | Computed via independent CTEs (`rn_price`, `rn_psft`) |
| **Landed Property Handling** | 2,932 tx merged on 1 project | **Segregated** | Landed aggregates flagged (`is_landed_aggregate = 1`) |
| **Non-Landed Housing Segregation** | Misclassified as landed | **Preserved** | Non-landed housing developments preserved as standard |
| **Verified Point-in-Time Snapshot** | None verified | `property-backup-20260930-203754.db` (148.86 MB) | `PRAGMA integrity_check` verified: `ok` |

---

## Verification & Testing Evidence

The platform's technical hardening is backed by automated test suites and dependency audits:

### 1. Automated Vitest Test Suite Execution
- **Framework:** Vitest 3.x with Node.js 20
- **Isolation:** Tests execute against ephemeral in-memory SQLite instances (`:memory:`), ensuring zero dependency on disk files and zero mutation of production databases.
- **Results:** **101 tests passed across 5 test suites (100% pass rate, 0 failures, ~1.43s runtime)**

```text
✓ tests/security.test.js    (38 tests) - 93ms
✓ tests/ingestion.test.js   (25 tests) - 1062ms
✓ tests/queryEngine.test.js (12 tests) - 45ms
✓ tests/leads.test.js       (11 tests) - 152ms
✓ tests/migrations.test.js  (15 tests) - 78ms

Test Files:  5 passed (5)
Tests:       101 passed (101)
```

### 2. Supply Chain & Vulnerability Audit
- **Command:** `npm audit --omit=dev --audit-level=high`
- **Root / Server / Client:** **0 vulnerabilities found** (down from 11 server vulnerabilities including `tar` and `axios` CVEs).

---

## What is Outstanding & Operational Dependencies

While all code-level vulnerabilities, mathematical bugs, and architectural defects have been resolved, several external, operational, and infrastructure dependencies remain for ongoing vigilance:

### 1. External Infrastructure & DNS Configuration
* **Live DNS Records for `homeintel.sg`:** SPF (`v=spf1 include:resend.com ~all`), DKIM (configured via Resend DNS records), and DMARC (`v=DMARC1; p=reject; rua=mailto:dmarc@homeintel.sg`) must be verified on live public nameservers to guarantee inbox deliverability and prevent domain spoofing.
* **Caddy Reverse Proxy TLS Certificates:** Ensure port 80 and 443 are publicly reachable on the production VPS to allow automated Let's Encrypt / ZeroSSL ACME challenge resolution.

### 2. Offsite Cloud Backup Replication (ARCH-01 Phase 3 Extension)
* **Local vs. Remote Backups:** `server/scripts/backup-db.js` generates verified, AES-256-GCM encrypted database snapshots in `./server/backups` (or `./data/backups`).
* **Outstanding Step:** An external sync utility (e.g. AWS CLI, `rclone`, or a lightweight S3 streaming script) should be configured to mirror encrypted backup archives to an offsite S3-compatible bucket (AWS S3, Cloudflare R2, or Backblaze B2) to guard against total host VPS destruction.

### 3. Third-Party Commercial & Upstream Licensing
* **CEA Licensed Partner Agreement:** Advisory lead forms display accreditation for ERA Realty Network Pte Ltd (Licence: L3002382K). The commercial agreement with the designated licensed real estate salesperson must remain active.
* **URA Data Service Access Key:** URA developer access keys require periodic renewal on `developer.gov.sg`. The system operates cleanly if the key is valid, but an alert must be monitored if URA rotates key formats or endpoints.
* **Live MAS SORA Feed Automation:** SORA rates currently reflect verified MAS published benchmarks. If MAS introduces an automated public REST API for SORA in the future, the ingestion pipeline can be upgraded from the current static lookup table to a live weekly sync.

### 4. Production Host Security
* **Full-Disk Encryption (FDE):** The SQLite database resides on the host filesystem. In production, host-level disk encryption (LUKS on Linux VPS or BitLocker on Windows Server) should be enabled at the cloud provider layer.

---

## Conclusion & Production Readiness Declaration

With the completion of all remediation phases, the resolution of all blockers identified in `POST_REMEDIATION_REVIEW.md`, and the hardening measures implemented under `SECURITY_AND_RESILIENCE_REVIEW.md`, Singapore Home Intel (`property-intelligence-sg`) is declared **Production Ready**.

The system satisfies institutional criteria for:
1. **Mathematical Accuracy:** Independent CTE medians and exact SVY21 conversion.
2. **Defensive Security:** Fail-closed authentication, HMAC signatures, CSP, strict CORS, and sanitized CSV exports.
3. **Data Protection:** Singapore PDPA 2012 compliance with double opt-in, automated retention pruning, and Right-to-Erasure support.
4. **Operational Resilience:** Process supervision via PM2, atomic SQLite transactions in WAL mode, and encrypted backups.
