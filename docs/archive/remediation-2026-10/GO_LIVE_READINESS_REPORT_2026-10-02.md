# Go-live readiness evaluation — 2 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**6 October Phase 4 update:** Compact complete-map contracts, bounded/coalesced queries, prepared default analytics, browser/accessibility and operational monitoring are implemented and locally qualified. The original default-response/payload/concurrent-delay targets pass; broad cold custom filters and full hosted qualification remain open. See [Phase 4 qualification](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md) and [operations runbook](PHASE_4_OPERATIONS_RUNBOOK.md). Public launch remains NO-GO.

**6 October Phase 3 update:** Implementation gaps identified by the independent review have been repaired; see the [corrected Phase 3 report](PHASE_3_COMPLETION_REPORT_2026-10-06.md). The findings below retain their original 2 October evidence. Hosted verification, owner privacy/communications approval and later release phases remain open; public release remains NO-GO.

**5 October update:** this evaluation records the original findings. Phase 2 is now complete locally, including all 35 identity approvals, source reconciliation, backed-up database promotion and final Linux qualification; see the [current completion report](PHASE_2_COMPLETION_REPORT_2026-10-05.md). Public launch remains NO-GO pending later-phase and hosted checks.

**Decision: NO-GO for the currently advertised product.** The hardening work has materially improved the application, but reproducible failures remain in startup, ingestion identity, analytics, and email delivery handling. The database rebuild procedure is unsafe. Deployment, recovery, and production email operation also lack sufficient evidence for release.

This assessment supersedes the readiness conclusions and inventory figures in `CANONICAL_HARDENING_AND_SECURITY_REPORT.md` for the working tree evaluated here. It does not invalidate the historical reports or imply that every earlier defect remains open. The implementation plan is in `GO_LIVE_REMEDIATION_PLAN_2026-10-02.md`.

## 1. Scope and evidence

Evaluated the six historical review/remediation documents, the canonical report, `ura_property_valuation_spec.md`, deployment/operations documentation, application source, migrations, ingestion, analytics, email and maintenance scripts, frontend flows, CI and container configuration, and the current local market database.

Baseline: Git HEAD `0794bc60098b126d70e5eac396d2e190e1727e3f`, plus the working-tree changes present at evaluation time. Existing modifications to `docker-compose.yml` and the specification, and the existing untracked canonical/deployment/operations documents, were preserved. This is an assessment of that working tree, not solely the commit.

Evidence labels used below:

- **Reproduced:** observed in an isolated fixture, subprocess, database audit, or local browser session.
- **Code-confirmed:** directly visible in implementation; the full production failure was not induced.
- **Unverified:** requires the deployment environment, external service, business decision, or operational rehearsal.

The source database was opened read-only and copied using SQLite's backup interface. Lead rows were removed from the disposable copy before application testing. Fixtures used synthetic identities and fake credentials. No real URA synchronization, newsletter, valuation email, rebuild/swap, deployment, or source-database repair was executed. Production application code was not changed.

Reusable probes and sanitized result files are in `audit/2026-10-02/`. Local fixture databases are ignored and are not deliverables to commit. This was a broad engineering evaluation, not an external penetration test, legal certification, or proof of the deployed infrastructure's security.

### Verification results

| Check | Result | Limit of the evidence |
|---|---|---|
| Existing server tests | **101 passed; 5 files** | Run with `DB_PATH=:memory:` and external-service keys cleared. Passing tests do not cover the failures below. |
| Frontend production build | **Passed** | Vite 6.4.3; main JS 919.00 kB, gzip 265.83 kB; large-chunk warning. |
| Database integrity / foreign keys | **Passed** | Structural integrity does not establish semantic correctness or source completeness. |
| Fresh disk database startup | **Failed in 5/5 trials** | Local Windows, Node v24.19.0; uncaught `SQLITE_BUSY` before HTTP readiness. Existing populated copy starts. |
| Targeted behavioral probes | **Multiple failures reproduced** | Identity collision, ineffective late DB path change, repeated price pages, stale valuation cache, malformed input 500s, false email success, old confirmation token. |
| Local browser smoke | **Sales and rental views load** | Built frontend served by production-mode server against sanitized copy; no captured console warnings/errors. Not a complete browser/device/accessibility test. |
| Dependency advisory lookup | **No advisories returned** | npm bulk advisory service queried against current client/server lockfile package versions, including development packages, on 2 October. This is not a full `npm audit` dependency-path analysis or a guarantee of safety. |
| Docker / Compose integration | **Not executed** | Docker daemon unavailable, including after an approved outside-sandbox check. Image startup, proxy/TLS and actual schedules remain unverified. |
| Live provider / production readiness | **Not executed** | URA credentials, Resend delivery/webhooks, DNS, TLS, remote backups, alerts and recovery need staging/production evidence. |

Local tests used Node v24.19.0. The deployed configuration targets Node 20, so local success does not establish deployment-runtime compatibility. npm was unavailable locally; the installed Vitest and Vite entry points were invoked directly.

## 2. Current data and performance baseline

| Item | Observed state |
|---|---|
| Projects | 5,938, including landed records; not 5,938 condominiums |
| Sales | 133,418; dates January 2021–September 2026 |
| Rentals | 450,722; dates September 2021–August 2026 |
| Total transactions | **584,140**, not 582,851 |
| Project benchmark rows | **3,291**, not 5,938; last update 30 September 2026 |
| District coverage | 5,894 valid; 44 missing (99.3% valid) |
| Coordinates | 5,679 tagged `svy21`; 200 `district_centre`; 59 missing |
| Livability precision | All 200 district-centre records have scores despite approximate location |
| Amenities | 399, all tagged `seed`: 95 MRT, 22 schools, 139 hawkers, 63 parks, 80 supermarkets |
| Planning areas | 3,428 populated / 136 distinct values; includes 3,076 `Central` and street names |
| Normalized duplicate candidates | 35 groups / 70 project rows; examples include Saint/Street substitutions |
| Incorrect landed classification | One project named as non-landed is still flagged landed |
| Latest stored SORA | September 2026; 1m 2.40%, 3m 2.44%; hardcoded ingestion values, not independently validated rates |
| Migration tracking | 001–008 recorded as applied |

The 2,647 projects without benchmarks are not automatically defective: some may have no eligible recent sales. Publish coverage and investigate unexpected gaps instead of fabricating estimates. Similarly, multiple streets for one project name and co-located coordinates are investigation signals, not sufficient evidence to merge records. The normalized duplicate groups require source-backed adjudication.

Single local query-engine samples against the database copy:

| Default query | Cold duration | Uncompressed JSON | Map/project rows |
|---|---:|---:|---:|
| Rental analytics | **8,327 ms** | **9,912,360 bytes** | 2,870 |
| Price analytics | **830 ms** | **8,074,218 bytes** | 2,379 |
| Project list | 95 ms | 1,871,151 bytes | 4,728 |

Repeated identical queries hit the application cache and rounded to 0 ms at the query-function boundary. This excludes HTTP serialization, compression, transfer and rendering. Two different district queries completed together in 1,552 ms; this is not a capacity or p95 load test. The old approximately 1.05 MB response claim and inferred approximately 50 MB cache bound should not be reused. A 50-entry cache is not a byte limit.

## 3. Release-blocking findings

P0 means an operation can damage or replace authoritative data and should be contained immediately. P1 means correct or provide an explicitly tested scope reduction before public launch. Conditional gates apply only when the associated feature is enabled.

### GL-01 — P0: Rebuild can ingest into the source database and swap in an incomplete target

**Reproduced mechanism; code-confirmed destructive consequences.** `server/db.js:9` captures the database path at module import. `server/scripts/rebuild-clean-db.js:104` changes `process.env.DB_PATH` after importing ingestion, so default connections still use the original database. An isolated probe confirmed the connection remained attached to the original fixture after changing the environment variable. The actual destructive rebuild was deliberately not run.

The script additionally accepts `partial_success`, logs target counts without requiring a complete populated dataset, does not preserve the migration-008 email timestamps in its lead copy, and uses an HTTP liveness check rather than an exclusive maintenance lock. Errors while reading leads can continue with an empty lead set; WAL/checkpoint/swap handling does not establish a tested rollback guarantee. Stopping the web process alone does not stop background writers.

**Required:** stop using this script until repaired. Inject the target connection through ingestion, benchmarks and amenity reads; acquire exclusive maintenance ownership; stop all writers; preserve the full lead/suppression schema; reject partial/empty rebuilds; validate provenance, counts and referential integrity; close/checkpoint all handles; prove swap and rollback through failure injection. Preserve and restore a verified backup before any real repair.

### GL-02 — P1: Fresh startup and migration coordination are unreliable

**Reproduced.** Every fresh-disk startup trial failed with an uncaught SQLite lock error. `server/db.js:18` and `:59` open separate connections and issue WAL PRAGMAs before busy timeout has taken effect, without awaiting successful initialization. The default server startup creates competing connections. In-memory tests do not exercise this disk behavior.

`server/migrations/index.js:52` executes a migration and records it separately; the runner has no exclusive migration owner spanning concurrent processes. Starting the API and maintenance jobs together adds another race surface.

**Required:** one awaited connection initialization path with error handling; a serialized migration phase before API/jobs; crash-safe migration bookkeeping; disk-backed empty, upgrade, interrupted and concurrent-start tests on the target Linux image. Reproduce and resolve the Windows failure as well, or explicitly remove Windows from supported developer environments.

### GL-03 — P1: Scheduled one-shot jobs are not a proven production scheduler

**Code-confirmed configuration risk; runtime schedule unverified.** `ecosystem.config.cjs` declares four one-shot scripts with `autorestart: false` and `cron_restart`. Starting the ecosystem launches those scripts immediately; a deployment can therefore initiate sync, email, cleanup and backup together. The scripts then exit. PM2's documentation says the application must be running for `cron_restart` to work. This configuration is not adequate evidence that subsequent scheduled runs occur. [PM2 application declaration](https://pm2.keymetrics.io/docs/usage/application-declaration/).

**Required:** use a scheduler that explicitly supports one-shot jobs, or a persistent scheduler process. Separate deployment from job execution, set the intended timezone, gate jobs on completed migrations, prevent overlaps, and persist run status/last success. Prove scheduled execution, restart behavior and missed-run handling in staging; email must not send simply because the container was redeployed.

### GL-04 — P1: Ingestion can silently lose valid transactions

**Reproduced identity collision; code-confirmed replacement risks.** `server/ingestion.js:17` and `:23` hash project name and district but omit street/project identity. Two different streets with the same name, district and transaction attributes produced one stored sale for the first project and zero for the second. The global unique hash suppresses the second record. Composite project identity alone does not solve transaction identity.

Sales ingestion deletes all existing sales for an encountered project (`:134`); manual imports delete all sales/rentals for that project (`:397`, `:467`). That is safe only if the input is a validated complete replacement for that exact scope. Empty or incomplete provider payloads are not adequately distinguished from legitimate results. The median-rental request at `:341` also bypasses the bounded timeout/retry helper.

**Required:** define stable source/project/transaction identity including street and relevant distinctions; preserve legitimate identical occurrences; replace only validated source periods/scopes; validate complete payloads before deletion; make retries bounded for every provider request; report committed counts and partial failures accurately. Replay same-name/different-street, repeated occurrence, partial, empty, malformed, timeout and rollback fixtures. Reconcile historical data after fixing the writer.

### GL-05 — P1: Current stored data still contains legacy identity and classification defects

**Reproduced.** Normalization groups include `ST. MICHAEL'S ROAD` and `STREET. MICHAEL'S ROAD`, and `ST. THOMAS WALK` versus `STREET. THOMAS WALK`. The normalizer conflates Saint and Street. There are 35 candidate duplicate pairs, legacy planning-area placeholders/street names, and one non-landed project still marked landed. Migration 002's broad landed match and newer upsert behavior have not fully repaired stored classifications.

**Required:** approve canonical source identities and street aliases; repair or safely rebuild with before/after reconciliation; correct existing classifications; replace invalid planning areas with authoritative mappings or explicit unknowns. Resolve affected transaction ownership and regenerate dependent benchmarks/scores. Do not merge every same-name or same-coordinate record automatically.

### GL-06 — P1: Analytics can return stale or incomplete results

**Reproduced.** After another connection changed a stored benchmark from 929 to 7,777 psf, the API process's valuation helper continued returning 929. The background sync runs in a separate process; refreshing its in-memory cache does not refresh the API's cache. The HTTP invalidation path is improved, but does not solve cross-process freshness.

Price page 2 returned the same transaction as page 1 while reporting page 2 and limit 1. `server/queryEngine.js:534` still uses fixed `LIMIT 200` without the requested pagination. A 10 km radius had 4,481 eligible projects but the helper returned only 200 before downstream filtering. Rental handling also does not apply the advertised unit-size filter consistently.

**Required:** shared data-version invalidation or bounded reload of every dependent cache; actual SQL pagination and stable ordering; complete radius semantics or an explicit rejected/limited query mode; filter-contract tests across summary, map, table and export. A truncated set must not be presented as the complete market population.

### GL-07 — P1: Yield/valuation definitions do not form one consistent product contract

**Code-confirmed.** The rental headline uses median rental psf divided by the mean of project median sale psf (`server/queryEngine.js:860`, `:947`). That is not an average of project gross yields. Historical rental periods use current rolling sale benchmarks; map and detail views can use different psf versus whole-unit median ratios. Benchmark eligibility/sample-size and missing-value semantics are not sufficiently exposed to users.

**Required:** agree one documented definition for each metric, its comparison period, weighting, unit/property-type matching, sample minimum and treatment of unavailable values. Either implement historically matched benchmarks or clearly label a current-price comparison. Align headline, map, drawer and emails against hand-calculated fixtures. Show unavailable as unavailable, not zero or a favorable ranking. These are decision-support outputs, so labels and uncertainty are release correctness requirements.

### GL-08 — P1 for advertised livability/SORA: Precision and provenance are overstated

**Reproduced inventory; code-confirmed methods.** All 399 current amenities are seed records, including only 22 schools. All 200 district-centre projects receive location-sensitive scores. The engine measures straight-line distance, which does not establish walking distance. Default MRT/school weights differ from the specification. Accepting supplied coordinates tagged `onemap` does not establish an implemented live OneMap fallback; no current project is tagged OneMap.

SORA values are hardcoded in `server/ingestion.js`; its seed operation deletes rows later than September 2026 (`:655`). There is no demonstrated current source-validation pipeline. This audit does not assert that the stored rates are numerically wrong; their provenance and ongoing freshness are unproven.

**Required:** suppress precise scoring for approximate coordinates; document actual coverage, distance method and agreed weights; attach source/version/freshness metadata; validate or remove interest-rate comparisons. A narrower launch may hide these features and unsupported “verified” claims until source-backed coverage exists. Merely changing the canonical report does not correct user-facing claims.

### GL-09 — P1 for lead/email features: Provider rejection is recorded as success

**Reproduced for confirmation; code-confirmed in other send paths.** A mocked Resend HTTP 422 produced API HTTP 200, “Confirmation link sent,” and an active resend cooldown. The SDK returns an `error` value rather than necessarily throwing. `server/index.js:304`, `:357` and `server/scripts/send-weekly-newsletter.js:263` do not check that result. The newsletter updates its last-sent timestamp even after a provider rejection, suppressing retry for approximately six days. The provider's accepted response also does not prove inbox delivery. [Resend Node SDK usage](https://resend.com/nodejs).

There is no durable delivery/outbox claim that makes concurrent dispatch and crash recovery safe. Cooldown checks and updates are separate. With no Resend key, the server can fall back to logging a confirmation URL while presenting a successful subscription flow.

**Required:** explicit `{data,error}` handling; production feature/configuration guards; durable queued/accepted/failed states; atomic claims and provider idempotency; bounded retry; delivery/bounce/complaint handling and suppression; truthful user responses. Prove rejection, timeout, duplicate job and crash-after-send behavior with a fake provider before authorized staging delivery tests.

### GL-10 — P1 for lead/email features: Consent lifecycle and retention need repair

**Reproduced token weakness; code-confirmed lifecycle gaps.** A synthetic confirmation token issued 365 days earlier was accepted. Confirmation tokens have no expiry and are consumed through GET, so automated link scanning can confirm a subscription. Migration 007 marks legacy records confirmed without establishing evidence of double opt-in, and duplicate consolidation can discard earlier preference history. A stored suppression hash is not consulted by the signup flow.

Cleanup does not distinguish converted leads from other aged leads despite the specification's retention distinction. Deleting a live row does not establish removal from retained backups or prevent restoration from reintroducing an opted-out record. These are gaps against the intended product/privacy workflow, not a legal compliance determination.

**Required:** expiring, single-use confirmation with explicit user action; retain auditable consent provenance/version and preference history; quarantine legacy contacts without adequate evidence; enforce suppression across imports and restoration; define and implement retention, deletion and backup-restoration rules. Have the accountable business/privacy owner approve notices, processors and retention before enabling collection or marketing.

### GL-11 — P1: Backup encryption and recoverability are optional or unproven

**Code-confirmed; operational evidence missing.** `server/scripts/backup-db.js:127` encrypts only when a key is supplied and explicitly writes plaintext otherwise. Compose defaults the key to empty. Local backup creation does not establish encrypted off-host recovery, key separation, restore completeness or recoverable email/consent state.

**Required:** fail closed for production backups containing personal data unless an approved equivalent storage control is explicitly implemented; keep recovery keys separately; retain encrypted off-host copies; define RPO/RTO; restore into a clean environment and verify schema, market totals, leads, suppression and job state. Test corrupt/missing backups and rollback. Do not describe “encrypted backups” as an unconditional current guarantee.

### GL-12 — P1: Runtime and production deployment are not release-qualified

**Code-confirmed configuration; deployment unverified.** Dockerfile stages and CI select Node 20, which is end-of-life as of this assessment. PM2 is globally installed without a pinned version. Local verification used Node 24. [Node.js end-of-life status](https://nodejs.org/en/about/eol).

**Required:** choose a supported LTS, pin/test the runtime and process manager, and run clean installation, tests, image build and Compose startup on that runtime. Prove persistent volume ownership, process privileges, restart/shutdown behavior, reverse proxy/TLS, restricted exposed ports and secret provisioning on the actual target. The existing deployment guide is not execution evidence.

### GL-13 — P1: Request validation and administrative access need a production boundary

**Reproduced validation failures; code-confirmed access model.** Object-valued name, fractional rental limit and array-valued date each produced HTTP 500 rather than a controlled validation response. Coercive validators allow values that later fail in string operations or SQLite. Missing admin authentication correctly returned 401, and missing consent correctly returned 400.

The application offers an expiring admin token but continues to accept the long-lived shared admin key directly. This is not individually attributable, revocable operator access with MFA. A small single-operator launch can satisfy the practical need through an independently protected private/MFA access boundary rather than a large account-system rewrite. If using separate frontend/API origins, CORS must support the intended authorization headers and DELETE operations; the current allow-list is incomplete for that deployment.

**Required:** strict schemas for type, length, bounds, dates and mutually dependent filters; reject invalid payloads with 4xx; test every public/admin endpoint; decide and implement the admin exposure model, credentials, rotation and access logging. Production origin/configuration must be tested, not inferred from localhost success.

### GL-14 — P1: Cold-query cost and payload size exceed the claimed readiness baseline

**Reproduced local samples.** The default rental query took 8.3 seconds and generated 9.9 MB JSON; price generated 8.1 MB. Map results repeat amenity detail. Warm-cache speed does not protect against distinct-filter traffic, first requests after restarts or concurrent cache misses. Entry-count cache limits do not bound memory usage. Existing request rate limits do not establish sustainable query capacity.

**Required:** separate compact summary/map responses from lazily loaded property details, remove repeated amenity payloads, optimize expensive aggregations, bound cache bytes and coalesce concurrent misses. Test representative cold/warm queries and mixed traffic on target hardware with explicit p95/p99, error, memory and payload budgets. Either meet the earlier plan's latency/payload targets or approve documented replacements before sign-off; do not silently treat a warm function-cache hit as an end-to-end SLA.

### GL-15 — P1: Health, alerting and recovery signals are insufficient

**Code-confirmed; external operations unverified.** `/api/health` runs `SELECT 1`; it does not validate required tables, schema or market-data freshness. It shares the API rate-limit surface. Container health does not show that URA sync, newsletter, cleanup or offsite backup completed. No actual external alert receipt or recovery rehearsal was demonstrated.

**Required:** separate liveness/readiness; validate expected schema and database access; reserve monitoring capacity; monitor last successful jobs, source freshness, backup age, disk and error rates; alert an accountable operator; test the alerts and written restore/rollback runbook. Treat stale data as a visible service condition even if the web process is alive.

### GL-16 — P1: Test and release evidence does not yet cover the failure modes

**Code-confirmed coverage gaps; reproduced failures despite green suite.** Existing tests contain useful helper/SQL coverage but do not adequately exercise disk bootstrap, full endpoint behavior, provider error contracts, separate-process cache invalidation, real pagination, partial ingestion or job recovery. Importing application modules opens the default database unless environment isolation is established before import. The evaluation explicitly forced an isolated DB.

**Required:** enforce test isolation centrally and add meaningful regression tests for GL-01–15. Run migrations and ingestion on disposable disk databases; exercise routes through HTTP and emails through a fake provider; add browser journeys and a target-image staging rehearsal. Add the missing automated checks required by the agreed release process, including lint/static checks if retained in the specification. Preserve CI's currently strict audit behavior. A green suite is necessary, not sufficient, until these paths are covered.

## 4. What is already working

- The code includes parameterized database operations, dedicated ingestion connections, transaction boundaries, WAL/busy-timeout intent and migration tracking. Their presence is valuable even though startup/rebuild orchestration remains faulty.
- Admin requests fail closed without credentials; secure token/signature utilities and request/error controls are present. The targeted unauthenticated check passed.
- Explicit consent is required for lead submission; unique lead constraints and cooldown fields improve the previous state. Their full lifecycle still needs GL-09/10.
- SQL medians and persistent project benchmarks improve the original analytics design; the fixed 1,650 psf denominator has been removed. Consistency, sample matching and cache freshness remain open.
- Current data has 99.3% district coverage, structurally valid SQLite/FK checks, and recorded migrations through 008.
- The frontend builds and the main sales/rental views render. CI dependency audit commands no longer ignore failure, and current locked versions returned no npm bulk advisories during this audit.

## 5. Specification and canonical-report reconciliation

| Area | Correct current statement |
|---|---|
| “Remediation complete” / launch readiness | Improvements are real, but GL-01–16 prevent sign-off. |
| Dataset totals | 584,140 transactions; 3,291 benchmarks; distinguish all projects from condominiums. |
| Clean rebuild | Composite identity exists, but the rebuild target-path defect and legacy duplicates prevent asserting a clean, safe rebuild. |
| Exactly-once / complete ingestion | Replay support exists, but hashes collide across streets and replacement scope is unsafe for partial inputs. |
| Backups | Encryption is optional in code/configuration; off-host restoration is unproven. |
| Schedules | Cron expressions exist; successful recurring one-shot operation is not established. |
| Analytics/cache | SQL improvements exist; pagination, radius completeness, historical comparability and separate-process invalidation remain defective. |
| Livability / OneMap / amenities | Current records are seed-based; straight-line distances and approximate coordinates cannot support blanket walking-distance/verified-location claims. |
| Email and privacy | Consent and cooldown mechanisms exist; provider failures, token age, legacy confirmation and suppression/retention remain open. |
| Performance | Use the measured current 8–10 MB default analytics payloads and 8.3 s local cold rental sample, not historical payload claims. |
| Security status | No advisories returned for current locks; runtime EOL and application/operational defects still require action. |

Some specification differences can be explicit product decisions: weighting, historical yield comparisons, admin access architecture, planning-area availability and deferred amenity coverage. A decision must change the implementation or user-facing promise and be recorded with acceptance criteria. It cannot retrospectively turn an unverified guarantee into a verified fact.

## 6. Additional work and scope decisions

After the blockers are addressed, prioritize mobile and accessibility journeys, loading/error/empty states, lazy loading of the large frontend bundle, complete bedroom/property-type filter choices, consistent Singapore date semantics and stable project-ID deep links. Name-only project links/search are ambiguous where a name spans multiple streets.

Before public release, the business owner must also verify the actual agent/partner identity and licence claims, data redistribution/attribution permissions, contact/privacy notices and support ownership. No conclusion about those external facts was possible from this repository. Remove or qualify unsupported “verified” and protection badges rather than treating them as evidence.

A read-only analytics launch could defer GL-09/10 only if all collection, submission endpoints and outbound email jobs are actually disabled. Livability/SORA can be deferred by removing the associated outputs and claims. Neither reduction waives startup, ingestion/data correctness, analytics completeness, runtime support, recovery or capacity gates.

**Release approval requires evidence against the phased plan's gates. There is currently no defensible basis to declare the full advertised product production-ready.**
