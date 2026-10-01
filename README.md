# Singapore Home Intel (`homeintel.sg`)

An institutional-grade Singapore private residential transaction price intelligence engine, rental yield tracker, and livability analytics portal powered by official **Urban Redevelopment Authority (URA) Data Service** transaction caveats and **SLA OneMap** spatial data. Available at [homeintel.sg](https://homeintel.sg).

The platform includes built-in programmatic SEO, a verified Council for Estate Agencies (CEA) partner lead-generation engine, an automated weekly investor newsletter via Resend, and single-command Docker/PM2 production deployment with automated HTTPS.

---

## 🚀 Key Features

- **Official Data Integrity & Transparent Geocoding**: Powered by official URA private residential caveats and rental contracts under the Singapore Open Data Licence, OneMap SVY21 coordinate geocoding, and OpenStreetMap amenities (ODbL, with attribution). Rental floor areas represent approximate contract ranges, and projects without exact coordinates are clearly designated at district centroids.
- **Pre-Populated Database**: Includes 5,900+ condominium developments, >133,000 official sales transaction caveats, and >450,000 rental contract records (582,000+ total transactions with 99.3% authoritative Singapore postal districts).
- **Transaction Price Focus**: Clear focus on actual transaction prices rather than automated appraisals.
- **Past 24-Month Headline Metric Cards**: Top summary cards specifically reflect current market conditions based on transactions recorded within the past 24 months.
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
  - Interactive radius circles (0.5km to 5km) and active property walking distance rings (400m / 5-min walk & 800m / 10-min walk).
  - Walking distance livability density scoring across MRT stations, primary schools, hawker centres, supermarkets, and parks.
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
| `GET` | `/api/projects/:id/livability` | Computes project livability index and nearby amenity walking breakdown. |
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
Performs an automated clean-slate ingest from official URA APIs, seeds amenities, calculates postal districts, segregates non-landed developments, pre-computes livability, and calculates true 24-month rolling median benchmarks. Includes an active-server concurrency guard and `PRAGMA wal_checkpoint(TRUNCATE)`:
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

### Option A: Docker Compose & Caddy (Recommended)
1. **Clone repository onto your Linux VPS (Ubuntu 24.04 LTS)**:
   ```bash
   git clone https://github.com/samucospace/property-intelligence-SG.git
   cd property-intelligence-SG
   ```
2. **Transfer your pre-populated database**:
   ```bash
   scp server/property.db root@<SERVER_IP>:/root/property-intelligence-SG/server/property.db
   ```
3. **Configure environment and domain**:
   - Fill in `server/.env`.
   - Update `Caddyfile` with your live domain name.
   - Set required variables: `ADMIN_API_KEY`, `UNSUBSCRIBE_SECRET`, `BASE_URL`, `URA_ACCESS_KEY`, `ALLOWED_ORIGIN`, `TZ=Asia/Singapore`.
4. **Launch with automated HTTPS**:
   ```bash
   docker compose up -d --build
   ```
   *The container runs `pm2-runtime ecosystem.config.cjs`, which starts both the unified Express web application and all 4 background cron jobs (database backups, URA sync, PDPA retention, and newsletters) under process supervision.*

### Option B: Bare Linux VPS with PM2
The provided `ecosystem.config.cjs` manages the unified web app alongside built-in scheduled background cron jobs respecting `TZ=Asia/Singapore` in fork mode:
```bash
# Build frontend
npm run build

# Install production dependencies
cd server && npm install --omit=dev

# Start application server and background cron jobs
pm2 start ecosystem.config.cjs
pm2 save
```

### Scheduled Maintenance Crontab (Docker Environments)
If running under Docker, add the scheduled maintenance tasks to host crontab (`crontab -e`) using the `-T` flag to prevent TTY allocation issues under cron:
```bash
# Daily SQLite online backup at 4:00 AM SGT
0 4 * * * docker compose -f /root/property-intelligence-SG/docker-compose.yml exec -T app node server/scripts/backup-db.js >> /var/log/db-backup.log 2>&1

# Sync official URA caveats every Sunday at 2:00 AM SGT
0 2 * * 0 docker compose -f /root/property-intelligence-SG/docker-compose.yml exec -T app node server/scripts/sync-ura.js >> /var/log/ura-sync.log 2>&1

# Dispatch weekly property digest every Monday at 8:00 AM SGT
0 8 * * 1 docker compose -f /root/property-intelligence-SG/docker-compose.yml exec -T app node server/scripts/send-weekly-newsletter.js >> /var/log/newsletter.log 2>&1

# Monthly PDPA lead retention cleanup on the 1st of every month at 3:00 AM SGT
0 3 1 * * docker compose -f /root/property-intelligence-SG/docker-compose.yml exec -T app node server/scripts/cleanup-leads.js >> /var/log/leads-cleanup.log 2>&1
```

---

## ⚖️ Legal & Regulatory Disclosures

- **Singapore Open Data Licence (SODL)**: Property transaction caveats and rental statistics are sourced from the Urban Redevelopment Authority (URA) Data Service, accessed under the terms of the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence).
- **Personal Data Protection Act 2012 (PDPA)**: All email collections and lead submissions require explicit affirmative consent and include 1-click opt-out rights.
- **Estate Agents Act & CEA Disclosures**: Singapore Home Intel is an independent technology platform and does not perform estate agency work. Advisory and transaction assistance are provided exclusively by licensed real estate salespersons registered with the Council for Estate Agencies (CEA).
- **Transaction Price Notice**: Transaction price summaries and $/sqft trends are algorithmic computations for informational purposes only, and do not constitute formal appraisals under the Singapore Institute of Surveyors and Valuers (SISV).

---

## 📄 License

This repository is maintained privately by [samucospace](https://github.com/samucospace/property-intelligence-SG).
