# Product & Technical Specification: Singapore Home Intel (Fixed & Final)

## 1. Executive Summary
**Objective:** Build a web application that ingests Singapore private residential property transaction data via the URA Data Service API, stores and normalizes historical transactions in a local database (SQLite/PostgreSQL), and provides an interactive dashboard for property owners and investors to track transaction prices ($ total and $/sqft) across developments, streets, planning areas, postal districts, and custom geographical radii.

---

## 2. System Architecture

```text
┌────────────────────────────────────────────────────────┐
│                   Frontend (Client)                    │
│      Vite + React + Recharts + Leaflet (OpenStreetMap)  │
└───────────────────────────┬────────────────────────────┘
                            │ REST APIs
                            ▼
┌────────────────────────────────────────────────────────┐
│              Backend Server (Node.js / Express)        │
│  - Data Aggregator & Haversine Query Engine            │
│  - Ingestion Orchestrator (URA API Batch Fetcher)       │
│  - Zero-Latency SVY21 Mathematical Coordinate Engine   │
│  - Scheduled Background Sync Engine & Deduplication    │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
  Daily/Weekly  │                        │ Read / Write
                ▼                        ▼
┌────────────────────────┐      ┌────────────────────────┐
│  External APIs         │      │ Local Database         │
│  - URA API (Batches 1-4)      │ (SQLite / PostgreSQL)  │
│  - OneMap (Geocoding)  │      │ Cleaned history &      │
└────────────────────────┘      │ spatial index          │
                                └────────────────────────┘
```

---

## 3. Data Ingestion & API Pipeline

### A. URA API Token Exchange & Multi-Batch Workflow
URA requires exchanging a static `AccessKey` for a dynamic daily token, and retrieving transaction data across 4 distinct batches.

1. **Token Generation Endpoint:**
   * **URL:** `https://www.ura.gov.sg/uraHttp/insertToken.action`
   * **Headers:** `AccessKey: <YOUR_URA_ACCESS_KEY>`, `User-Agent: Mozilla/5.0`
   * **Response:** JSON `{ "result": "<DAILY_TOKEN>", "status": "1" }` valid for 24 hours.

2. **Transaction Data Fetch Endpoints (Batches 1 to 4):**
   * **URL:** `https://www.ura.gov.sg/uraHttp/loadData.action?service=PMI_Resi_Transaction&batch={1|2|3|4}`
   * **Headers:** `AccessKey: <YOUR_URA_ACCESS_KEY>`, `Token: <DAILY_TOKEN>`
   * **Response:** Array of project objects containing transaction lists.

3. **Data Transformation Rules:**
   * **Date Parsing:** URA returns dates as `MMYY` (e.g., `0524` = May 2024). Transformed to ISO date format `2024-05-01`.
   * **Unit Conversions:** `area_sqft = area_sqm * 10.7639`, `psft_sgd = price_sgd / area_sqft`. Metric units ($/sqm) are omitted in user-facing views in favor of Singapore market-standard $/sqft.

### B. OneMap Geocoding & Location Resolution
During project ingestion, the geocoder queries OneMap Search API (`https://www.onemap.gov.sg/api/common/elastic/search?searchVal={project_or_street}&returnGeom=Y&getAddrDetails=Y`) to resolve:
* Latitude & Longitude (WGS84 & SVY21)
* Postal Code & Building Name
* Planning Area (e.g. *Bedok, Marine Parade, Bukit Merah*)

---

## 4. Database Schema (SQLite / PostgreSQL)

### 1. Projects Table (`projects`)
```sql
CREATE TABLE IF NOT EXISTS projects (
    project_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL UNIQUE,
    street_name TEXT NOT NULL,
    postal_district TEXT NOT NULL,       -- e.g. "09", "15"
    market_segment TEXT NOT NULL,        -- CCR, RCR, OCR
    planning_area TEXT,                  -- Derived from OneMap (e.g. "Bedok")
    latitude REAL,                       -- WGS84 Lat
    longitude REAL,                      -- WGS84 Lng
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Property Transactions Table (`property_transactions`)
*Note: To resolve duplicate detection without wrongly rejecting identical real-world transactions in the same month, we generate a deterministic transaction hash based on batch index or composite key with transaction sequence.*

```sql
CREATE TABLE IF NOT EXISTS property_transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    area_sqm REAL NOT NULL,
    area_sqft REAL NOT NULL,
    price_sgd REAL NOT NULL,
    psqm_sgd REAL NOT NULL,
    psft_sgd REAL NOT NULL,
    contract_date TEXT NOT NULL,         -- Format: YYYY-MM-01
    floor_range TEXT,                    -- e.g. "06 to 10"
    tenure TEXT,                         -- e.g. "Freehold", "99 yrs lease commence 2015"
    type_of_sale TEXT,                   -- "Resale", "New Sale", "Sub Sale"
    property_type TEXT,                  -- "Condominium", "Apartment", "Executive Condominium", "Detached"
    raw_hash TEXT UNIQUE,                -- Unique MD5 hash of raw transaction payload to prevent duplicate ingest
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON property_transactions(contract_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_project ON property_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(postal_district);
CREATE INDEX IF NOT EXISTS idx_projects_street ON projects(street_name);
CREATE INDEX IF NOT EXISTS idx_projects_planning_area ON projects(planning_area);
```

---

## 5. Backend Query & Spatial Logic

### A. Haversine Radius Query Engine
For radius calculations without requiring complex PostGIS extensions in SQLite/Postgres:
```sql
-- Distance (km) = 6371 * acos(cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1)) + sin(radians(lat1)) * sin(radians(lat2)))
```
The Query Engine filters developments within bounding box `[lat_min, lat_max, lng_min, lng_max]` first, then applies exact Haversine distance filtering.

### B. API Endpoints

1. `GET /api/search/suggestions?q=Keppel`
   Returns categorised results:
   ```json
   {
     "projects": [{ "id": 1, "name": "Reflections at Keppel Bay", "district": "04" }],
     "streets": ["Keppel Bay View"],
     "districts": ["04"],
     "planning_areas": ["Bukit Merah"]
   }
   ```

2. `POST /api/analytics/price-trends`
   Aggregates transaction metrics by Month or Quarter based on selected filters (projects, street, planning area, district, radius, floor area range in sqft, `priceMin`, `priceMax`, `tenure` ['all' | 'freehold' | 'leasehold'], and transaction dates).
   * Headline summary metrics are computed strictly over the **past 24 months** relative to the latest available dataset record.

3. `POST /api/analytics/rental-yields`
   Returns rental yield metrics and rental contract history filtered by project, area, date range, rent price bounds, and property tenure.

4. `POST /api/ingest/ura` (Guarded by `X-Admin-Key`)
   Triggers official URA live token exchange & multi-batch transaction download.

5. `POST /api/ingest/import-data` (Guarded by `X-Admin-Key`)
   Ingests raw official URA JSON exports into SQLite.

---

## 6. Target User Interface Capabilities

1. **Unified Search & Dynamic Filter Header:**
   * Multi-select autocomplete bar for developments, streets, districts, and planning areas.
   * Transaction date range filters ("Transaction date from", "Transaction date to").
   * Price filters: Min Price and Max Price (or Min Rent / Max Rent in rental mode).
   * Tenure filter: `All Tenures`, `Freehold / 999-yr`, and `Leasehold`.
   * Unit size filter strictly in Sqft (Sqm removed).
   * Map click / radius slider (100m – 5km).

2. **Key Metric Summary Cards (Strictly Past 24 Months):**
   * Median Transaction Price (past 24 months).
   * Median Rate ($/sqft).
   * Transaction Volume (Past 24M) & Average Transaction Price.

3. **Analytics & Trend Charts:**
   * Property Transaction Price Analytics: Price Trend Line Chart (Median $/sqft over time) paired with Sales Volume Bar Chart.
   * Floor Level Scatter Plot (Transaction Price vs. Floor Range tier).
   * Rental Yield Analysis (Gross yield % by development).
   * Note: Interest rates and MAS SORA overlays are completely purged from the application.

4. **Interactive GIS Property Map:**
   * Leaflet map displaying project markers color-coded by market segment (CCR, RCR, OCR).
   * Interactive popup showing development summary with median $/sqft and quick filter button.

5. **100% Official Data Integrity & Terminology Policy:**
   * Strictly refers to numbers as **"transaction price"** rather than "valuation".
   * Strictly operates on official URA transaction caveats and rental agreements. All synthetic and mock data generators have been permanently purged from the system.
