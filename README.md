# Singapore Home Intel (`homeintel.sg`)

**7 October private deployment update:** The actual Droplet now runs a server-local, contact-free analytics pilot. Independent encrypted backups and separate-computer data recovery pass. Public/protected HTTPS, received operator email and broad cold-filter capacity remain open; see [private deployment status](PRIVATE_DEPLOYMENT_STATUS_2026-10-07.md).

[Source handoff and remaining release gates](RELEASE_HANDOFF_2026-10-06.md) records the accumulated Phase 2–4 work, candidate provenance and deployment prerequisites.

**6 October Phase 4 update:** Compact complete-map contracts, bounded/coalesced queries, prepared default analytics, browser/accessibility and operational monitoring are implemented and locally qualified. The original default-response/payload/concurrent-delay targets pass; broad cold custom filters and full hosted qualification remain open. See [Phase 4 qualification](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md) and [operations runbook](PHASE_4_OPERATIONS_RUNBOOK.md). Public launch remains NO-GO.

**Phase 3 update (6 October):** Email/consent/access/recovery code repairs pass 238 tests on Windows and Node 22/Linux. The [corrected report](PHASE_3_COMPLETION_REPORT_2026-10-06.md) and [Phase 3 operations runbook](PHASE_3_OPERATIONS_RUNBOOK.md) govern these controls. Hosted evidence and owner approvals remain open; public launch remains NO-GO.

Phase 2 corrections and live-source evidence are recorded in the [5 October report](PHASE_2_COMPLETION_REPORT_2026-10-05.md). Sam Fraser approved the [metric definitions and exclusions](PHASE_2_METRIC_CONTRACT.md). No public launch is approved.

**Current status (2 October 2026): local development, NO-GO for public release.** The default release is read-only analytics; lead/admin/email features and unsafe sync/cleanup are contained. Operational rebuild is quarantined. Use the [Phase 0 runbook](PHASE_0_OPERATIONS_RUNBOOK.md) and [corrected Phase 0 report](PHASE_0_COMPLETION_REPORT_2026-10-02.md). The capability/deployment descriptions below are intended functionality and plans, not evidence of a hosted service.

Phase 1/2 corrections pass 189 tests on Windows and Linux with Node 22.23.3. Phase 2 is complete locally: all 35 identity approvals are applied and the reconciled database is promoted with verified backups. The release image passes repeated startup, production health/frontend and packaging checks ([Docker qualification](DOCKER_QUALIFICATION_REPORT_2026-10-05.md)). Use the [Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md) and [current operations runbook](PHASE_1_OPERATIONS_RUNBOOK.md); general rebuild enablement and hosted checks remain gated. Every identified issue must be fixed and verified before public launch.

An institutional-grade Singapore private residential transaction price intelligence engine, rental yield tracker, and livability analytics portal powered by official **Urban Redevelopment Authority (URA) Data Service** transaction caveats and **SLA OneMap** spatial data. Intended domain: `homeintel.sg`; external hosting is not yet established.

The read-only release scope exposes research analytics. Lead capture, outbound newsletters and maintenance imports remain disabled until their release gates pass. Partner identity and sender readiness are pending verification.

---

## 🚀 Key Features

- **Official Data Integrity & Transparent Geocoding**: Powered by official URA private residential caveats and rental contracts under the Singapore Open Data Licence, OneMap SVY21 coordinate geocoding, and OpenStreetMap amenities (ODbL, with attribution). Rental floor areas represent approximate contract ranges, and projects without exact coordinates are clearly designated at district centroids.
- **Reconciled Local Database**: Includes 5,905 project/estate catalog entries, 132,305 sales and 451,165 rentals. The captured URA source version matches exactly; 59 older sales remain active and original replaced rows are archived. This does not establish complete earlier provider history. See the Phase 2 completion report.
- **Transaction Price Focus**: Clear focus on actual transaction prices rather than automated appraisals.
- **Selected-period summaries**: Summary cards use the chosen period and filters. Rental yields use period-matched sale windows and minimum usable samples, as defined in the [approved metric contract](PHASE_2_METRIC_CONTRACT.md).
- **Per Square Feet (PSFT) Standard**: Uses per square feet ($/sqft) metrics throughout the app for intuitive market comparison.
- **Comprehensive Search Filters**:
  - Development, street, postal district, and planning area autocomplete.
  - Transaction date range (`Transaction date from` and `Transaction date to`).
  - Min and max price/rent filters.
  - Tenure filter (Freehold / 999-yr vs. Leasehold).
  - Unit floor area filter (Sqft).
  - Bedroom count filter (for rental analytics).
  - Geographic radius circle filter (0.5km to 5km).
- **Time-Proportional Chronological Axis Scaling**: Chart timelines across sales transactions, price indices, and rental trends are scaled proportionally across time. Inactive months with zero transactions retain their calendar tick with 0 volume, ensuring transaction pauses and market hiatuses are accurately depicted rather than compressed.
- **Zero-Latency SVY21 Spatial Engine**: Pure mathematical conversion of Singapore Transverse Mercator (SVY21) coordinates to WGS84 (Lat/Lng) in 0ms without external geocoding API rate limits.
- **Interactive GIS Map & Livability Scoring (SLA OneMap)**:
  - Powered by official **Singapore Land Authority (SLA) OneMap** basemap tiles (compliant with commercial use under the Singapore Open Data Licence).
  - Built-in style switcher supporting **Default (Color)**, **Grey (Minimalist)**, **Night (Dark Mode)**, and **Original** basemaps.
  - Smooth marker clustering via `react-leaflet-cluster` for responsive rendering across thousands of developments.
  - Interactive radius circles (0.5km to 5km) and active straight-line distance rings (400m and 800m).
  - Amenity proximity estimates from an incomplete curated catalog across MRT stations, primary schools, hawker centres, supermarkets, and parks.
- **Comprehensive Singapore POI Amenities Dataset (399 POIs)**:
  - **139 Hawker Centres & Eating Houses**: Sourced from official National Environment Agency (NEA) records (`data.gov.sg`) with stall counts, addresses, and prominent neighborhood eating houses (e.g. Binjai Park, Beauty World Food Centre, Cheong Chin Nam, Greenwood, Sixth Ave).
  - **80 Supermarkets**: Islandwide coverage across FairPrice Finest, FairPrice Xtra, CS Fresh, Cold Storage, Sheng Siong, Don Don Donki, Meidi-Ya, and Giant (including newly opened stores like FairPrice Finest @ Dunearn Village).
  - **95 MRT Stations, 22 Top Primary Schools, and 63 Parks / Greenery Reserves**.
  - Interactive rich amenity popups displaying exact addresses, stall counts, and specialties.
- **Robust Geocoding & Spatial Fallback Engine**:
  - Automatically resolves project coordinates via SVY21 math, street-level spatial inheritance, and OneMap address geocoding.
  - Visual distinction for approximate district centroids.
- **Verified CEA Agent Lead Referral**:
  - High-converting, native district specialist advisory banner and lead capture modal.
  - Mandatory Singapore Personal Data Protection Act 2012 (PDPA) consent checkbox (unticked by default) and double opt-in confirmation.
  - Persistent SQLite `leads` table and `/api/leads/submit` API with bot honeypot protection and 12-month data retention policy.
- **Automated Weekly Investor Newsletter**:
  - Dynamic weekly dispatch script (`server/scripts/send-weekly-newsletter.js`) querying `property.db` for top gross yields and recent caveats.
  - Integration with **Resend API**.
  - Secure cryptographic 1-click Singapore PDPA unsubscribe route (`/api/leads/unsubscribe`).
  - Local preview generator (`--preview`).
- **Programmatic SEO & Social Previews**:
  - Dynamic XML sitemap (`/sitemap.xml`) indexing all 5,900+ Singapore condominium developments.
  - Search engine directives (`/robots.txt`).
  - OpenGraph and Twitter Cards for social sharing with high-resolution 1200×630 asset (`/og-image.png`).
  - Schema.org JSON-LD structured data.
- **Production Hardening**:
  - Single-port Express serving (Express serves compiled React/Vite assets from `client/dist`).
  - Security headers via **`helmet`**, payload compression via **`compression`**, and anti-scraping rate limiting via **`express-rate-limit`**.
  - Protected `/api/ingest/*` and `/api/admin/*` endpoints guarded by timing-safe `requireAdmin`.
  - Multi-stage `Dockerfile` running as non-root `USER node`, `docker-compose.yml`, and `Caddyfile` with automated Let's Encrypt SSL.

---

## 🏗️ Architecture

```
[ Web Visitors / Mobile Users / Search Bots ]
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│              Reverse Proxy & SSL: Caddy                │  (Automated Let's Encrypt HTTPS, Gzip, Brotli)
└──────────────────────────┬─────────────────────────────┘
                           │ :3001
┌──────────────────────────▼─────────────────────────────┐
│          Unified Express Server (Node.js 20)           │
│  ├─ Static Client Serving (React 18 + Vite dist)       │
│  ├─ Rate Limiting, Helmet Security, Compression        │
│  ├─ Analytics, Livability & Autocomplete API Routes    │
│  ├─ Dynamic SEO Sitemap Generator (/sitemap.xml)       │
│  ├─ Lead Capture & 1-Click PDPA Unsubscribe Routes     │
│  └─ Ingestion Gatekeeper (Protected by Admin Key)      │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│  SQLite (property.db)    │    │ External Integrations    │
│  - 5,900+ Condominiums   │    │ - URA Data Service API   │
│  - 133k+ Sales Caveats   │    │ - Resend Email Gateway   │
│  - 450k+ Rental Leases   │    │ - SLA OneMap / OSM       │
│  - Amenities & Leads     │    │                          │
└──────────────────────────┘    └──────────────────────────┘
```

---

## 💻 Quick Start (Local Machine)

### Prerequisites
- **Node.js (v18 or higher)** and **npm** installed:
  ```bash
  node -v
  npm -v
  ```

### 1. Install Dependencies
From the repository root:
```bash
# Install root, backend, and frontend dependencies
npm --prefix server install
npm --prefix client install
```

### 2. Build & Run Single-Port Production Mode (Recommended)
This compiles the Vite frontend and runs both the API and UI from a single process on port `3001` (exact same behavior as production webserver):
```bash
# Build the client bundle
npm run build

# Start the unified server
npm start
```
Open **[http://localhost:3001](http://localhost:3001)** in your browser.

### 3. Development Mode (With Hot Reloading)
If you are developing and modifying React components:
```bash
# Terminal 1: Start backend Express server (Port 3001)
npm run dev:server

# Terminal 2: Start Vite development server (Port 3000)
npm run dev:client
```
Open **[http://localhost:3000](http://localhost:3000)** (Vite proxies `/api` calls to port 3001).

### 4. Testing on Other Devices on the Same Wi-Fi (Laptop, Tablet, Mobile)
To test the site from another device on the same local Wi-Fi:
1. Find your host PC's local IP (e.g. `192.168.x.x` via `ipconfig`).
2. Both port `3001` (production server) and port `3000` (Vite dev server with `host: true`) accept connections over the local network:
   - **Production preview**: `http://<YOUR_LOCAL_IP>:3001`
   - **Vite dev server**: `http://<YOUR_LOCAL_IP>:3000`

---

## ⚙️ Environment Variables

Copy the template in `server/.env.example` to `server/.env`:
```bash
cp server/.env.example server/.env
```

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `PORT` | No | `3001` | The port Express listens on. |
| `NODE_ENV` | No | `development` | Set to `production` on live webservers. |
| `ALLOWED_ORIGIN` | **Yes (Prod)** | - | Strict allowed CORS origins (e.g. `https://homeintel.sg`). Rejects wildcard in prod. |
| `ADMIN_API_KEY` | **Yes (Prod)** | - | Secret key (min 32 chars) protecting `/api/ingest/*` and `/api/admin/*`. |
| `BACKUP_ENCRYPTION_KEY` | Optional | - | Passphrase for AES-256-GCM authenticated database snapshot encryption. |
| `UNSUBSCRIBE_SECRET`| **Yes (Prod)** | - | HMAC secret for verifying RFC 8058 1-click unsubscribe links. |
| `LEGACY_UNSUB_UNTIL`| Optional | - | Cut-off date (YYYY-MM-DD) for accepting legacy SHA-256 tokens. |
| `DB_PATH` | No | `./property.db`| File path to SQLite database. |
| `BACKUP_DIR` | No | `./backups` | Target directory for online SQLite database backups. |
| `BACKUP_RETENTION_DAYS` | No | `30` | Backup retention threshold in days. |
| `TZ` | No | `Asia/Singapore` | Application timezone for cron jobs and timestamp parsing. |
| `URA_ACCESS_KEY` | **Yes (Sync)** | - | Your official URA Data Service Access Key from developer.gov.sg. |
| `RESEND_API_KEY` | Optional | - | Resend API key for double opt-in confirmation and newsletter dispatch. |
| `SENDER_EMAIL` | Optional | `digest@homeintel.sg` | Sender email address for automated briefs. |
| `AGENT_NOTIFICATION_EMAIL` | Optional | - | Recipient mailbox for instant CEA advisory lead alerts. |
| `BASE_URL` | Optional | `http://localhost:3001`| Base domain used in sitemaps, confirmation links, and meta tags. |

---

## 📡 API Endpoints Reference

### Public Analytics & Search
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Deep health check querying database; returns `{ status: 'ok', db: 'connected', timestamp }` (HTTP 503 on database error). |
| `GET` | `/api/search/suggestions?q=...` | Fast autocomplete matching project names, streets, and districts. |
| `POST` | `/api/analytics/price-trends` | Aggregates price trends ($/sqft), time series, and scatter points (cached with key normalization). |
| `POST` | `/api/analytics/rental-yields` | Aggregates rental contracts and gross rental yields. |
| `GET` | `/api/projects` | Overview list of all registered developments. |
| `GET` | `/api/projects/:id/livability` | Computes project livability index and straight-line amenity proximity and coverage disclosures. |
| `GET` | `/api/amenities` | Retrieves GIS map POIs (MRT stations, schools, supermarkets, parks). |

### Lead Capture & Singapore PDPA
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/leads/submit` | Records CEA advisory lead or newsletter subscription with PDPA consent (5-minute cooldown on verification dispatches). |
| `GET` | `/api/newsletter/confirm` | Double opt-in email verification endpoint. |
| `GET` / `POST` | `/api/leads/unsubscribe` | 1-Click PDPA unsubscribe handler with cryptographic HMAC validation. |

### Search Engine Optimization (SEO)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/?project=...` | Server-rendered OpenGraph metadata with in-memory HTML template caching. |
| `GET` | `/sitemap.xml` | Dynamically generated XML sitemap with `<lastmod>` indexing all 5,900+ developments. |
| `GET` | `/robots.txt` | Crawler directives referencing `/sitemap.xml`. |

### Ingestion & Admin Pipeline (Guarded by `requireAdmin`)
*Supports `Authorization: Bearer <sessionToken>`, `X-Admin-Session: <sessionToken>`, or direct `X-Admin-Key` header.*

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/admin/login` | Body: `{ "adminKey": "..." }` — Issues expiring HMAC-SHA256 session token (rate-limited to 5 attempts / 15 min). |
| `GET` | `/api/admin/leads` | Lists recent leads and subscribers in JSON format. |
| `GET` | `/api/admin/leads/export.csv` | Downloads lead submissions as CSV (with CSV formula injection defense). |
| `DELETE` | `/api/admin/leads/:id` | Permanently deletes a lead record under PDPA Section 25 / GDPR Article 17 Right-to-Erasure. |
| `POST` | `/api/ingest/ura` | Body: `{ "accessKey": "..." }` — Triggers official URA live token exchange & batch download. |
| `POST` | `/api/ingest/import-data` | Body: `{ "jsonData": [...] }` — Ingests raw official URA JSON exports into SQLite. |

---

## 🛠️ Scheduled Automation Scripts

All scripts are located in `server/scripts/`:

### 1. Weekly URA Data Synchronization
Syncs official sales caveat batches 1–4 and quarterly rental contracts from URA (with 30-second timeouts and 3x exponential backoff):
```bash
node server/scripts/sync-ura.js
```
*(Requires `URA_ACCESS_KEY` in `server/.env`).*

### 2. Weekly Automated Property Digest (Newsletter)
Generates the HTML briefing, sanitizes all interpolated data against HTML/XSS injection, tracks send state idempotently to prevent duplicate emails upon interruption, and throttles dispatches by 150ms per recipient:
```bash
# Preview HTML locally without sending:
node server/scripts/send-weekly-newsletter.js --preview

# Live dispatch:
node server/scripts/send-weekly-newsletter.js
```
*(Requires `RESEND_API_KEY` in `server/.env`).*

### 3. Monthly PDPA Lead Retention Cleanup
Enforces automated data retention under Singapore PDPA Section 25 and GDPR:
- Purges unconfirmed newsletter signups older than 30 days.
- Anonymizes unsubscribed leads older than 90 days (wipes personal details and converts email to SHA-256 suppression hash).
- Purges unconverted agent advisory leads older than 12 months.
```bash
node server/scripts/cleanup-leads.js
```

### 4. Daily Online SQLite Database Backup
Performs an online, non-blocking snapshot using `VACUUM INTO`, verifies snapshot health with `PRAGMA integrity_check`, optionally encrypts the snapshot using AES-256-GCM (authenticated encryption), and purges backups older than 30 days:
```bash
node server/scripts/backup-db.js
```
*(Optionally configure `BACKUP_ENCRYPTION_KEY` in `server/.env`).*

### 5. Automated Clean Database Rebuild & Verification
The general clean-slate operational flow remains disabled pending authoritative future source coverage and hosted qualification. The reviewed Phase 2 snapshot has been promoted locally through its separate procedure. Use the current runbooks; no HTTP port check alone establishes database maintenance exclusivity:
```bash
npm run rebuild-db
# or directly:
node server/scripts/rebuild-clean-db.js
```
*(Requires `URA_ACCESS_KEY` in `server/.env`).*

---

## 🧪 Automated Testing Suite (Vitest)

The platform includes comprehensive unit and integration test suites:
```bash
# Run all test suites
npm test

# Run server Vitest suite directly
npm --prefix server test
```

### Test Coverage Matrix (101 Passing Tests Across 5 Suites)
* **`security.test.js`** (38 tests): Constant-time comparison (`safeEqual`), HTML escaping (`escapeHtml`), HMAC-SHA256 unsubscribe token validation (verifying malformed, forged, and non-ASCII tokens fail safely without 500 errors), legacy token cut-off grace periods, fail-closed admin key validation, admin session token lifecycle (`generateAdminSession`, `verifyAdminSession`, expiration, tamper rejection), `requireAdmin` middleware authorization guards (Bearer session, `X-Admin-Session`, and legacy `X-Admin-Key`), strict CORS origin evaluation, in-memory HTML SEO template caching, rebuild script active server port detection, and AES-256-GCM database backup encryption/decryption round-trip with GCM authentication tag tamper resistance.
* **`ingestion.test.js`** (25 tests): SVY21 projection origin and benchmark coordinate accuracy, Haversine distance, postal district normalization (`01`–`28`), 6-digit postal sector resolving, landed housing pattern matching, dynamic quarter generation, transaction deduplication and SHA-256 record hashing, SQLite transaction rollbacks (`withTransaction`), and `fetchWithRetry` resilience testing with exponential backoff on transient 503 errors.
* **`queryEngine.test.js`** (12 tests): Exact median math (odd, even, sparse), `LIKE` wildcard escaping, chronological month sequences, gross annual yield math, date boundary validation (2000–2100, 10-year span, project limit), tenure classification, and cache key normalization with SQL bounding-box pre-filtering and 200 project radius cap.
* **`leads.test.js`** (11 tests): Mandatory PDPA consent enforcement, honeypot spam bot trapping, name/email length bounds, Singapore phone validation regex, SQLite schema migrations + `ON CONFLICT` deduplication, 5-minute verification email cooldown, send-state newsletter tracking, automated retention purging and suppression hashing (PRIV-01), and permanent Right-to-Erasure lead deletion (PDPA Section 25).
* **`migrations.test.js`** (15 tests): Full migration lifecycle execution (001 through 008) from an empty SQLite database in CI, constant default safety, independent price/psft median benchmark calculations, and schema resilience columns.

---

## 🚢 Production Deployment Guide

The project is not live. Resolve and verify every identified issue before public release. Use Node 22.23.3 and locked installs. The [Phase 1 runbook](PHASE_1_OPERATIONS_RUNBOOK.md) is the current deployment/maintenance procedure; older PM2 and host-crontab instructions are superseded.

The proposed Docker deployment runs the web application and Caddy. Maintenance is a separate opt-in Compose profile and uses persistent job-slot claims. Configure the approved restored database under the mounted `data/property.db`, environment/secrets, TLS and the [deployment-stage backup strategy](PHASE_0_OPERATIONS_RUNBOOK.md#deployment-stage-backup-strategy-deferred-not-live) before private deployment. Test the release image and restores before public launch.

`docker compose up -d --build` does not start the scheduler. After the applicable gates pass, `docker compose --profile maintenance up -d scheduler` starts it explicitly. Keep sync, cleanup and email disabled until their governing gates pass. Do not install overlapping host cron schedules.

---

## ⚖️ Legal & Regulatory Disclosures

- **Singapore Open Data Licence (SODL)**: Property transaction caveats and rental statistics are sourced from the Urban Redevelopment Authority (URA) Data Service, accessed under the terms of the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence).
- **Personal Data Protection Act 2012 (PDPA)**: All email collections and lead submissions require explicit affirmative consent and include 1-click opt-out rights.
- **Estate Agents Act & CEA Disclosures**: Singapore Home Intel is an independent technology platform and does not perform estate agency work. Advisory and transaction assistance are provided exclusively by licensed real estate salespersons registered with the Council for Estate Agencies (CEA).
- **Transaction Price Notice**: Transaction price summaries and $/sqft trends are algorithmic computations for informational purposes only, and do not constitute formal appraisals under the Singapore Institute of Surveyors and Valuers (SISV).

---

## 📄 License

This repository is maintained privately by [samucospace](https://github.com/samucospace/property-intelligence-SG).

## Phase 4 API contracts and readiness

`POST /api/analytics/price-trends` and `POST /api/analytics/rental-yields` return `phase4-v1` summaries/chart data with explicitly paginated examples. They no longer repeat complete `mapProjects`. Fetch `POST /api/analytics/map` with `{mode: "sale" | "rental", filters: ...}` for all matching map projects. This and `GET /api/projects` return `phase4-map-v1` columnar data (`columns`, `rows`, nested `structures`, `totalProjects`); decode using `client/src/utils/mapContract.js`. These are coordinated client/server contract changes; older consumers expecting project object arrays must update. Full amenity detail remains at `GET /api/projects/:id/livability`.

`/api/health/live` checks the process; `/api/health/ready` checks required migrations, populated data and current prepared defaults. Legacy `/api/health` is only database connectivity. Docker prepares defaults before serving and sets `UV_THREADPOOL_SIZE=16`; outside Docker set that variable before launching Node. See the Phase 4 runbook for alert settings, freshness thresholds, temporary capacity errors and rollback.
