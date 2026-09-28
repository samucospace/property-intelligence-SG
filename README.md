# Property Intelligence SG (`property-intelligence-SG`)

An institutional-grade Singapore private residential valuation engine, rental yield tracker, and livability analytics portal powered by official **Urban Redevelopment Authority (URA) Data Service** transaction caveats, **Monetary Authority of Singapore (MAS)** SORA benchmark interest rates, and **SLA OneMap** spatial data.

The platform includes built-in programmatic SEO, a verified Council for Estate Agencies (CEA) partner lead-generation engine, an automated weekly investor newsletter via Resend, and single-command Docker/PM2 production deployment with automated HTTPS.

---

## 🚀 Key Features

- **100% Official Government Data Only**: Strictly operates on verified URA transaction caveats and rental agreements. Zero synthetic, fabricated, or mock data.
- **Pre-Populated Database**: Includes ~3,400+ condominium developments, >128,000 official sales transaction caveats, and >405,000 rental contract records.
- **Zero-Latency SVY21 Spatial Engine**: Pure mathematical conversion of Singapore Transverse Mercator (SVY21) coordinates to WGS84 (Lat/Lng) in 0ms without external geocoding API rate limits.
- **SORA Benchmark Yield Analytics**: Compares gross rental yields against 1M & 3M compounded Singapore Overnight Rate Average (SORA) interest benchmarks published by MAS to visualize the investor yield spread.
- **Interactive GIS Map & Livability Scoring**: Leaflet map featuring color-coded development markers (CCR, RCR, OCR), radius filtering, and walking distance density scoring to MRT stations, primary schools, supermarkets, and parks.
- **Verified CEA Agent Lead Referral**:
  - High-converting, native district specialist advisory banner and lead capture modal.
  - Mandatory Singapore Personal Data Protection Act 2012 (PDPA) consent checkbox and Do Not Call (DNC) authorization.
  - Persistent SQLite `leads` table and `/api/leads/submit` API.
- **Automated Weekly Investor Newsletter**:
  - Dynamic weekly dispatch script (`server/scripts/send-weekly-newsletter.js`) querying `property.db` for top gross yields and recent caveats.
  - Integration with **Resend API**.
  - Secure cryptographic 1-click Singapore PDPA unsubscribe route (`/api/leads/unsubscribe`).
  - Local preview generator (`--preview`).
- **Programmatic SEO & Social Previews**:
  - Dynamic XML sitemap (`/sitemap.xml`) indexing all 3,400+ Singapore condominium developments.
  - Search engine directives (`/robots.txt`).
  - OpenGraph and Twitter Cards for social sharing (WhatsApp & Telegram property discussion groups).
  - Schema.org JSON-LD structured data.
- **Production Hardening**:
  - Single-port Express serving (Express serves compiled React/Vite assets from `client/dist`).
  - Security headers via **`helmet`**, payload compression via **`compression`**, and anti-scraping rate limiting via **`express-rate-limit`**.
  - Protected `/api/ingest/*` endpoints guarded by `X-Admin-Key`.
  - Multi-stage `Dockerfile`, `docker-compose.yml`, and `Caddyfile` with automated Let's Encrypt SSL.

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
│  - 3,400+ Condominiums   │    │ - URA Data Service API   │
│  - 128k+ Sales Caveats   │    │ - MAS SORA Rates         │
│  - 405k+ Rental Leases   │    │ - Resend Email Gateway   │
│  - Amenities & Leads     │    │ - SLA OneMap / OSM       │
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
| `ADMIN_API_KEY` | **Yes (Prod)** | - | Secret key protecting `/api/ingest/*` and generating unsubscribe tokens. |
| `URA_ACCESS_KEY` | **Yes (Sync)** | - | Your official URA Data Service Access Key from developer.gov.sg. |
| `RESEND_API_KEY` | Optional | - | Resend API key for automated weekly newsletter dispatch. |
| `NEWSLETTER_FROM_EMAIL`| Optional | - | Sender email (e.g. `Property Intelligence SG <digest@yourdomain.sg>`). |
| `BASE_URL` | Optional | `http://localhost:3001`| Base domain used in sitemaps and email links (e.g. `https://yourdomain.com`). |

---

## 📡 API Endpoints Reference

### Public Analytics & Search
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check endpoint returning `{ status: 'ok', timestamp }`. |
| `GET` | `/api/search/suggestions?q=...` | Fast autocomplete matching project names, streets, and districts. |
| `POST` | `/api/analytics/price-trends` | Aggregates price trends ($/sqm, $/sqft), time series, and scatter points. |
| `POST` | `/api/analytics/rental-yields` | Aggregates rental contracts, gross rental yields, and SORA benchmarks. |
| `GET` | `/api/projects` | Overview list of all registered developments. |
| `GET` | `/api/projects/:id/livability` | Computes project livability index and nearby amenity walking breakdown. |
| `GET` | `/api/amenities` | Retrieves GIS map POIs (MRT stations, schools, supermarkets, parks). |

### Lead Capture & Singapore PDPA
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/leads/submit` | Records CEA advisory lead or newsletter subscription with PDPA consent. |
| `GET` | `/api/leads/unsubscribe` | 1-Click PDPA unsubscribe handler with cryptographic token validation. |

### Search Engine Optimization (SEO)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/sitemap.xml` | Dynamically generated XML sitemap indexing all ~3,400+ condominium URLs. |
| `GET` | `/robots.txt` | Crawler directives referencing `/sitemap.xml`. |

### Ingestion Pipeline (Protected by `X-Admin-Key`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/ingest/ura` | Body: `{ "accessKey": "..." }` — Triggers official URA live token exchange & batch download. |
| `POST` | `/api/ingest/import-data` | Body: `{ "jsonData": [...] }` — Ingests raw official URA JSON exports into SQLite. |

---

## 🛠️ Scheduled Automation Scripts

All scripts are located in `server/scripts/`:

### 1. Weekly URA Data Synchronization
Syncs official sales caveat batches 1–4 and quarterly rental contracts from URA:
```bash
node server/scripts/sync-ura.js
```
*(Requires `URA_ACCESS_KEY` in `server/.env`).*

### 2. Weekly Automated Property Digest (Newsletter)
Generates the HTML briefing and sends it to active subscribers via Resend:
```bash
# Preview HTML locally without sending:
node server/scripts/send-weekly-newsletter.js --preview

# Live dispatch:
node server/scripts/send-weekly-newsletter.js
```
*(Requires `RESEND_API_KEY` in `server/.env`).*

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
   - Uncomment the `caddy:` block in `docker-compose.yml`.
4. **Launch with automated HTTPS**:
   ```bash
   docker compose up -d --build
   ```

### Option B: Bare Linux VPS with PM2
```bash
# Build frontend
npm run build

# Install production dependencies
cd server && npm install --omit=dev

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
```

### Server Crontab Setup
Add the automated maintenance tasks using `crontab -e`:
```bash
# Sync official URA caveats every Sunday at 3:00 AM SGT
0 3 * * 0 docker compose -f /root/property-intelligence-SG/docker-compose.yml exec app node server/scripts/sync-ura.js >> /var/log/ura-sync.log 2>&1

# Dispatch weekly property digest every Saturday at 9:00 AM SGT
0 9 * * 6 docker compose -f /root/property-intelligence-SG/docker-compose.yml exec app node server/scripts/send-weekly-newsletter.js >> /var/log/newsletter.log 2>&1
```

---

## ⚖️ Legal & Regulatory Disclosures

- **Singapore Open Data Licence (SODL)**: Property transaction caveats and rental statistics are sourced from the Urban Redevelopment Authority (URA) Data Service, accessed under the terms of the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence).
- **Benchmark Interest Rates**: SORA benchmark data reflects published records from the Monetary Authority of Singapore (MAS).
- **Personal Data Protection Act 2012 (PDPA)**: All email collections and lead submissions require explicit affirmative consent and include 1-click opt-out rights.
- **Estate Agents Act & CEA Disclosures**: Property Intelligence SG is an independent technology platform and does not perform estate agency work. Advisory and transaction assistance are provided exclusively by licensed real estate salespersons registered with the Council for Estate Agencies (CEA).
- **Valuation Notice**: Automated valuation estimates and $/sqft trends are algorithmic computations for informational purposes only, and do not constitute formal appraisals under the Singapore Institute of Surveyors and Valuers (SISV).

---

## 📄 License

This repository is maintained privately by [samucospace](https://github.com/samucospace/property-intelligence-SG).
