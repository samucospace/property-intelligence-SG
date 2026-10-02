# Product & Technical Specification: Singapore Home Intel

**Application:** Singapore Home Intel (`property-intelligence-sg` / `homeintel.sg`)  
**Specification Version:** 2.0.0 (Production Verified)  
**Date:** October 2026  
**Status:** Current & Authoritative Specification  

---

## 1. Executive Summary & Product Objective

**Objective:** Singapore Home Intel is an institutional-grade intelligence portal and valuation engine for Singapore private residential property. It continuously ingests official caveat lodged transactions and rental agreements via the Urban Redevelopment Authority (URA) Data Service API, normalizes historical market data in a high-performance SQLite WAL database, and delivers real-time analytical dashboards for home buyers, property owners, and investors.

### Core Principles
1. **100% Official Caveat Integrity:** Strictly operates on verified government caveat data (URA Data Service) and Singapore Land Authority (SLA) OneMap spatial data under the Singapore Open Data Licence. All synthetic data fallbacks and speculative estimates have been purged.
2. **Transaction Price vs. Appraisal Distinction:** Algorithmic calculations report actual **transaction price medians** and **gross rental yields**, avoiding misleading claims of automated official appraisals.
3. **Sub-35ms Analytical Latency:** Replaces heavy request-time dataset scans with pre-computed 24-month rolling median benchmarks and cached livability indexes.
4. **Defensive Security & Privacy:** Incorporates fail-closed administration, timing-safe cryptographic comparisons, HMAC-SHA256 authenticated unsubscriptions, and strict compliance with the Singapore Personal Data Protection Act 2012 (PDPA).

---

## 2. System Architecture

```
[ Web Browsers / Mobile Clients / Search Crawlers ]
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│             Reverse Proxy & Edge: Caddy                │
│  - Automated TLS 1.3 / Let's Encrypt HTTPS             │
│  - Brotli / Gzip compression                           │
│  - Reverse proxy to internal port 3001                 │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP (localhost:3001)
┌──────────────────────────▼─────────────────────────────┐
│          Unified Application Server (Node.js 20)       │
│  - Process Management: PM2 (pm2-runtime)               │
│  - Express REST API & Dynamic SEO Meta Server          │
│  - Static Client Serving (Vite / React 18 dist)        │
│  - In-Memory LRU Analytics Cache (50 entries, 60s TTL) │
│  - Mathematical Coordinate Engine (SVY21 -> WGS84)     │
│  - Spatial Bounding-Box & Haversine Distance Filters   │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
  Weekly/Daily  │                        │ Read / Write (WAL Mode)
                ▼                        ▼
┌────────────────────────┐      ┌────────────────────────┐
│  External Services     │      │ Local SQLite Store     │
│  - URA API (Batches 1-4│      │ (property.db)          │
│    + Rental Quarters)  │      │ - 5,900+ Developments  │
│  - Resend Email API    │      │ - 133k+ Sales Caveats  │
│  - SLA OneMap API      │      │ - 450k+ Rental Leases  │
│  - OpenStreetMap POIs  │      │ - Benchmarks & Leads   │
└────────────────────────┘      └────────────────────────┘
```

---

## 3. Data Ingestion & API Pipeline

The data ingestion pipeline resides in `server/ingestion.js` and `server/scripts/sync-ura.js`, backed by `fetchWithRetry` (30-second timeout, 3x exponential backoff).

### A. URA API Token Exchange & Multi-Batch Ingestion

1. **Daily Token Exchange:**
   - **Endpoint:** `https://www.ura.gov.sg/uraHttp/insertToken.action`
   - **Method:** `GET`
   - **Headers:** `AccessKey: <URA_ACCESS_KEY>`, `User-Agent: SingaporeHomeIntel/1.0`
   - **Response:** `{ "result": "<DAILY_TOKEN>", "status": "1" }` (valid for 24 hours).

2. **Sales Caveat Ingestion (Batches 1 to 4):**
   - **Endpoint:** `https://www.ura.gov.sg/uraHttp/loadData.action?service=PMI_Resi_Transaction&batch={1|2|3|4}`
   - **Headers:** `AccessKey: <URA_ACCESS_KEY>`, `Token: <DAILY_TOKEN>`
   - **Payload Structure:** Array of developments, each containing an array of transaction caveats (`transaction: [...]`).

3. **Rental Contract Ingestion (Quarterly Sequences):**
   - **Endpoint:** `https://www.ura.gov.sg/uraHttp/loadData.action?service=PMI_Resi_Rental&refPeriod={YYqQ}`
   - **Sequence:** Dynamically generated from `21q1` through the current Singapore calendar quarter via `generateRentalQuarters()`.
   - **Payload Structure:** Array of rental developments with contract lease dates and rental price bands.

### B. Ingestion Data Transformation Rules

- **Date Normalization:** URA transaction dates (`MMYY`, e.g. `0524`) are parsed into ISO-8601 month format `YYYY-MM-01`. Missing dates are skipped and logged; never defaulted.
- **Unit Conversions:** `area_sqft = area_sqm * 10.7639`, `psft_sgd = price_sgd / area_sqft`. Per-square-meter figures are preserved in database but omitted in UI in favor of Singapore standard $/sqft.
- **Bulk Transactions:** Sales with `noOfUnits > 1` represent en-bloc or multiple-unit transactions. `no_of_units` is stored and bulk sales are excluded from individual psf benchmark calculations.
- **Bedroom Standardization:** Rental bedroom counts are normalized into `N-Bedder` (e.g. `1-Bedder`, `2-Bedder`, `3-Bedder`, `4-Bedder`, `5-Bedder`) or `Unspecified`.
- **Title Tenure Classification:** Classified into `freehold` (including 999-year and 9999-year leases) or `leasehold` (standard 99-year, 103-year, etc.).
- **Transaction Deduplication:** 
  - Sales caveats use `generateTxHash(projectName, streetName, contractDate, priceSgd, areaSqm, floorRange, occurrenceIndex, noOfUnits, propertyType, district)`.
  - Rental contracts use `generateRentHash(projectName, streetName, leaseDate, rentSgd, areaRange, bedroom, occurrenceIndex, propertyType, district)`.
  - Atomic replace-by-period ensures syncs do not duplicate historical records while preserving genuine identical transactions occurring in the same month.

### C. Geospatial Coordinate Engine & Address Resolution

Geocoding follows a strict tiered hierarchy:
1. **Zero-Latency SVY21 Ellipsoidal Transformation:**
   - Singapore Transverse Mercator (SVY21) coordinates (`x`, `y`) returned by URA are converted directly to WGS84 (`latitude`, `longitude`) in 0ms using the exact projection formulas in `server/utils/geo.js` (`svy21ToWgs84`).
   - Tagged as `geo_source = 'svy21'`.
2. **SLA OneMap Geocoding API:**
   - For developments lacking SVY21 coordinates, queries the OneMap Elastic Search API (`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=...&returnGeom=Y&getAddrDetails=Y`).
   - Tagged as `geo_source = 'onemap'`.
3. **District Centroid Fallback:**
   - Developments without resolvable coordinates fall back to the geographical centroid of their resolved postal district.
   - Tagged as `geo_source = 'district_centre'`. Displayed in the UI with distinct amber badges and excluded from radius proximity queries.
4. **Postal District Resolution:**
   - Resolved dynamically from transaction records (`tx.district`) and 6-digit postal sector mappings (`POSTAL_SECTOR_TO_DISTRICT`).
   - Validated against Singapore districts `01` through `28`. Stored strictly as 2-digit strings (e.g. `'09'`, `'15'`) or `NULL`.

---

## 4. Production Database Architecture (SQLite WAL)

The database (`server/property.db`) operates under **Write-Ahead Logging (`PRAGMA journal_mode = WAL`)**, a 5,000ms busy timeout (`PRAGMA busy_timeout = 5000`), and foreign key enforcement (`PRAGMA foreign_keys = ON`).

Schema migrations are sequentially tracked via `schema_migrations` (`001` through `008`).

```sql
-- 1. Projects & Developments
CREATE TABLE projects (
    project_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    street_name TEXT NOT NULL,
    postal_district TEXT,                 -- Valid '01'..'28' or NULL
    market_segment TEXT NOT NULL,          -- CCR, RCR, OCR
    planning_area TEXT,                    -- Master Plan planning area
    latitude REAL,                         -- WGS84 Latitude
    longitude REAL,                        -- WGS84 Longitude
    geo_source TEXT,                       -- 'svy21' | 'onemap' | 'district_centre'
    is_landed_aggregate INTEGER DEFAULT 0, -- 1 for generic landed aggregations
    tenure_class TEXT,                     -- 'freehold' | 'leasehold' | NULL
    livability_score INTEGER,              -- Pre-computed 0-100 density score
    livability_data TEXT,                  -- JSON serialized sub-scores & POI counts
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_name, street_name)
);

-- 2. Sales Caveats
CREATE TABLE property_transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    area_sqm REAL NOT NULL,
    area_sqft REAL NOT NULL,
    price_sgd REAL NOT NULL,
    psqm_sgd REAL NOT NULL,
    psft_sgd REAL NOT NULL,
    contract_date TEXT NOT NULL,           -- Format: YYYY-MM-01
    floor_range TEXT,                      -- e.g. "06 to 10"
    tenure TEXT,                           -- Raw tenure string
    type_of_sale TEXT,                     -- "Resale", "New Sale", "Sub Sale"
    property_type TEXT,                    -- "Condominium", "Apartment", "Executive Condominium"
    no_of_units INTEGER DEFAULT 1,         -- Multi-unit purchase indicator
    raw_hash TEXT UNIQUE,                  -- Deterministic deduplication hash
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- 3. Rental Contracts
CREATE TABLE rental_transactions (
    rental_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    street_name TEXT,
    postal_district TEXT,
    lease_date TEXT NOT NULL,              -- Format: YYYY-MM
    property_type TEXT,
    no_of_bedroom TEXT,                    -- Raw string (e.g. "3")
    bedroom_count TEXT,                    -- Canonical "3-Bedder"
    monthly_rent_sgd REAL NOT NULL,
    floor_area_sqm_band TEXT,              -- URA area range
    floor_area_sqft_band TEXT,
    rent_psm_sgd REAL,                     -- Derived midpoint (NULL if omitted)
    rent_psft_sgd REAL,                    -- Derived midpoint (NULL if omitted)
    raw_hash TEXT UNIQUE,                  -- Deterministic deduplication hash
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- 4. Pre-Computed 24-Month Rolling Median Benchmarks
CREATE TABLE project_benchmarks (
    project_id INTEGER PRIMARY KEY,
    rolling_24m_median_price REAL,         -- Exact median price across last 24m
    rolling_24m_median_psft REAL,          -- Exact median psft across last 24m
    sale_count_24m INTEGER DEFAULT 0,
    last_sale_date TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- 5. Personal Data & Lead Submissions (PDPA Compliant)
CREATE TABLE leads (
    lead_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    lead_type TEXT NOT NULL,               -- 'agent_advisory' | 'newsletter'
    enquiry_type TEXT,
    project_interest TEXT,
    pdpa_consent INTEGER NOT NULL,         -- 1 for affirmative consent
    consent_version TEXT,
    consent_at DATETIME,
    confirmation_token TEXT,               -- Random token for double opt-in
    confirmed_at DATETIME,                 -- Timestamp of email confirmation
    unsubscribed_at DATETIME,              -- Timestamp of 1-click unsubscribe
    last_confirmation_sent_at DATETIME,    -- Cooldown timestamp (5-min rate limit)
    last_newsletter_sent_at DATETIME,      -- Send tracking timestamp (idempotency)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    details TEXT
);
```

---

## 5. Valuation Mathematics & Statistical Algorithms

### A. Independent Ranked CTE Medians
To avoid distortion caused by cross-averaging disjoint records, median transaction price and median price per square foot ($/sqft) are computed using two independent ranked Common Table Expressions (CTEs):

```sql
WITH ranked_price AS (
  SELECT project_id, price_sgd,
         ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY price_sgd) AS rn_p,
         COUNT(*) OVER (PARTITION BY project_id) AS cnt_p
  FROM property_transactions
  WHERE contract_date >= date('now', '-24 months') AND no_of_units = 1
),
ranked_psft AS (
  SELECT project_id, psft_sgd,
         ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY psft_sgd) AS rn_ps,
         COUNT(*) OVER (PARTITION BY project_id) AS cnt_ps
  FROM property_transactions
  WHERE contract_date >= date('now', '-24 months') AND no_of_units = 1
)
SELECT p.project_id,
       (SELECT AVG(price_sgd) FROM ranked_price WHERE project_id = p.project_id AND rn_p IN ((cnt_p + 1)/2, (cnt_p + 2)/2)) AS median_price,
       (SELECT AVG(psft_sgd) FROM ranked_psft WHERE project_id = p.project_id AND rn_ps IN ((cnt_ps + 1)/2, (cnt_ps + 2)/2)) AS median_psft
FROM projects p;
```

### B. Gross Rental Yield Formula
Gross annual rental yield is computed strictly against time-matched 24-month median sales:
$$\text{Gross Annual Yield (\%)} = \left( \frac{\text{Monthly Rent (SGD)} \times 12}{\text{Rolling 24-Month Median Sale Price (SGD)}} \right) \times 100$$
Where a project lacks recent sales within 24 months, gross yield returns `null` with UI designation "N/A — no recent sales", eliminating arbitrary fallback valuations.

### C. Walking Distance Livability Index (0–100)
Projects are evaluated against 399 verified Point-of-Interest (POI) amenities across five weighted categories:
- **Mass Rapid Transit (MRT):** Weight 35% (Walking threshold: 800m)
- **Primary Schools:** Weight 20% (Threshold: 1,000m)
- **Hawker Centres & Eating Houses:** Weight 20% (Threshold: 800m)
- **Supermarkets:** Weight 15% (Threshold: 600m)
- **Parks & Green Reserves:** Weight 10% (Threshold: 800m)

---

## 6. REST API Endpoints Reference

All endpoints implement JSON responses with request tracing (`X-Request-ID`), rate limiting, and generic error sanitization.

### A. Public Analytics & Search
- `GET /api/health`: Database deep health check. Executes `SELECT 1` and returns HTTP 200 `{ status: 'ok', db: 'connected' }` or HTTP 503 on database lock/failure.
- `GET /api/search/suggestions?q=...`: Auto-suggest matching developments, streets, postal districts, and planning areas. Escapes `LIKE` wildcards and returns `lat`/`lng` coordinates to support map auto-centering.
- `POST /api/analytics/price-trends`: Aggregates historical sale trends, monthly median $/sqft series, and floor-level scatter points. Supports bounded pagination (`page`, `limit`), tenure filters, and date bounds. Cached via LRU.
- `POST /api/analytics/rental-yields`: Returns rental contracts and gross yield calculations.
- `GET /api/projects`: Paginated listing of registered developments with 24-month median benchmarks.
- `GET /api/projects/:id/livability`: Returns detailed walking distance breakdown to nearby amenities.
- `GET /api/amenities`: GeoJSON/JSON list of all 399 Singapore POI amenities.

### B. Lead Capture & Singapore PDPA 2012
- `POST /api/leads/submit`: Enforces affirmative PDPA consent (`pdpaConsent === true`), traps bot submissions via invisible honeypot field, validates 8-digit Singapore phone numbers, enforces a 5-minute cooldown on verification dispatches (ABU-02), and dispatches instant advisory notifications to appointed CEA salespersons via Resend.
- `GET /api/newsletter/confirm?email=...&token=...`: Validates double opt-in email confirmation tokens.
- `GET /api/leads/unsubscribe?email=...&token=...`: RFC 8058 1-click unsubscribe endpoint authenticated via HMAC-SHA256 signatures. Supports both `GET` and `POST` methods.

### C. Search Engine Optimization (SEO) & Social Cards
- `GET /?project=...`: Server-rendered OpenGraph metadata (`og:title`, `og:description`, `og:image`, `canonical`) with in-memory HTML template caching (PERF-01).
- `GET /sitemap.xml`: Dynamically generated XML sitemap indexing all 5,900+ condominium developments with `<lastmod>` timestamps.
- `GET /robots.txt`: Search crawler instructions referencing the dynamic sitemap.

### D. Administrative & Ingestion (Guarded by `requireAdmin`)
*Authentication: Supported via `Authorization: Bearer <sessionToken>`, `X-Admin-Session: <sessionToken>`, or direct `X-Admin-Key` header.*
- `POST /api/admin/login`: Issues expiring HMAC session tokens; rate-limited to 5 attempts per 15 minutes.
- `GET /api/admin/leads`: Lists recent advisory leads and subscribers in JSON format.
- `GET /api/admin/leads/export.csv`: Exports leads in CSV format with formula injection defenses (CWE-1236).
- `DELETE /api/admin/leads/:id`: Permanently deletes lead records under PDPA Section 25 / GDPR Article 17 Right-to-Erasure.
- `POST /api/ingest/ura`: Triggers live official URA data fetch and batch sync.
- `POST /api/ingest/import-data`: Ingests raw official URA JSON exports into SQLite.

---

## 7. Background Jobs & Scheduled Automation

Managed in production via PM2 (`ecosystem.config.cjs`) under `TZ=Asia/Singapore` in fork mode:

| Job / Script | Schedule | Frequency | Function |
| :--- | :--- | :--- | :--- |
| **`sync-ura.js`** | `0 2 * * 0` | Every Sunday 02:00 SGT | Fetches URA sales batches 1–4 and quarterly rentals; refreshes `project_benchmarks`. |
| **`send-weekly-newsletter.js`** | `0 8 * * 1` | Every Monday 08:00 SGT | Queries top yields; dispatches briefing to confirmed subscribers via Resend with 150ms throttle. |
| **`cleanup-leads.js`** | `0 3 1 * *` | 1st of month 03:00 SGT | Purges unconfirmed signups (>30d) and advisory leads (>12m); anonymizes unsubscribed leads (>90d). |
| **`backup-db.js`** | `0 4 * * *` | Daily 04:00 SGT | Non-blocking `VACUUM INTO` backup; integrity check; authenticated AES-256-GCM encryption. |

---

## 8. Frontend & UI Capabilities

- **Leaflet GIS Map:** SLA OneMap tiles with style switcher (Default, Minimalist Grey, Night, Original). Smooth marker clustering via `react-leaflet-cluster`.
- **Search Header:** Autocomplete with direct map panning and synchronized URL query parameters (`?project=`, `?q=`, `?enquire=1`).
- **Responsive Analytics:** Recharts time-proportional trend graphs, volume bars, and floor-level scatter plots.
- **Affirmative PDPA Dialogs:** Unticked consent checkboxes, accessible Terms & About modals, and user-facing error retry mechanisms.
