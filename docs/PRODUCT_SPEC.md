# Singapore Home Intel product specification

Canonical product requirements, updated 8 October 2026. Owner: Sam Fraser. Read [agent guidance](../AGENTS.md) and [operations](OPERATIONS.md) alongside this specification. Historical reports are indexed in [the archive](archive/README.md).

## Purpose and current scope

Singapore Home Intel helps people explore Singapore private residential sale transactions, rental leases and development-level amenity proximity. It presents historical evidence and qualified estimates, not a valuation guarantee, investment recommendation or complete national property/amenity catalogue.

The implemented pilot is **analytics-only** and privately protected at `staging.homeintel.sg`. Public release is not approved. Adviser lead collection, newsletters, customer email and administrative lead access are disabled server-side and hidden through `/api/features`; a failed feature fetch keeps them hidden. Existing signed withdrawal handling is retained where existing contacts require protection. An informal adviser relationship does not authorize collecting or referring leads.

The reconciled snapshot observed on 7 October contains 5,905 project identities, 132,305 sales and 451,165 rentals. Those are dated inventory figures, not guaranteed permanent totals or 5,905 condominiums. Landed street groups and approximate/unknown locations are represented with their limits. HDB coverage is not part of this pilot. A generic **LANDED HOUSING DEVELOPMENT** means a private landed street grouping, not an HDB development or necessarily one named estate.

## Approved analytics contract

Sam approved the metric definitions and exclusions on **5 October 2026**, with explicit median labeling. This approval does not authorize new identity merges, source deletion, feature enablement or public launch. The [original contract](archive/remediation-2026-10/PHASE_2_METRIC_CONTRACT.md) is retained as history; the rules below govern current work.

### Transaction summaries and filters

Sales/rental summaries, tables, time series and maps use the selected period and applicable filters. Monthly rental dates include the entire selected month; sale dates supplied as month/year are stored on the first of the month. Pagination counts every filtered row and orders stably by date and record ID. Bulk sales remain in transaction tables but are excluded from single-unit summary/valuation estimates.

Missing estimates are `null` and display N/A; no matching transactions means a count of zero. Pending identity reviews retain records but exclude them from public analytics. Unknown planning areas stay unknown; postal-district descriptions are not authoritative planning areas.

Supported criteria include project/street, district, planning area, date, property type, tenure, size, sale/rent price, rental bedrooms and radius. Nationwide searches default to condo/apartment; a named development includes its recorded types, including strata landed and executive condominiums, unless the user explicitly chooses a type. Unbounded size filters retain leases with unknown area for rent/count summaries; their area/psf/yield stays unavailable. Deliberate size bounds exclude unknown sizes. A numeric zero must not become a default value.

Switching sale/rent clears incompatible price bounds and resets pagination. Selecting a location replaces previous project/street/district/planning-area/radius criteria while retaining applicable nonlocation criteria. URL state validates and restores all supported filters, including page/radius. Criteria changes reset the page to one. Summaries and map counts use the complete match, not the visible table page or a hidden result cap.

### Gross yield

For each eligible project:

`median monthly rental psf × 12 ÷ median single-unit sale psf × 100`

The headline **Median Project Gross Yield** is the median of eligible project yields, rounded to two decimals. Explain: **Median across eligible projects; each project counts once**. Do not substitute the mean, a ratio of market-wide medians or an individual lease's rent for the project median. Detail/map/newsletter estimates identify their median inputs; individual lease estimates are labeled separately.

Rental records follow the selected period. Sales use **24 calendar months ending on the selected end date**, starting on the first day of the month 23 months earlier. Disclose the potentially partial endpoint month through `metricContract.saleWindow` and each `saleBenchmark`. Historical filters use historical sales rather than today's materialized benchmark.

Each project needs **at least three positive usable rental psf values and three positive usable single-unit sales**. Invalid, missing and nonpositive psf values do not count. Sales match project, unit size, property type and tenure. Bedroom and rent-price filters apply only to rentals; sales have no bedroom field. Withhold bedroom-breakdown yields rather than combining unrelated rental/sale averages.

Rental psf uses the midpoint of finite area bands and is an estimate. Open-ended bands (`<`, `<=`, `>`, `>=`) have no defensible midpoint: retain leases but withhold area/psf/yield. Gross estimates exclude financing, taxes, maintenance and vacancy. Detail explains the actual psf formula, sale window and usable sample counts. Individual caveat estimates use the qualified project sale denominator; any later newsletter ranking must use disclosed project medians and its trailing comparison window.

### Spatial coverage and rates

Approximate district-centre points and unavailable coordinates have no precise scores or nearby-amenity claims, including the detail API. Labels describe amenity proximity, not proven walkability or car dependence.

Distances are straight-line haversine estimates against an incomplete curated catalogue. Optional time estimates divide by 80 metres/minute; they are not pedestrian routes, crossing-aware journeys or school-admission boundaries. Detail discloses catalogue/school counts. Seed amenities are not a verified national catalogue.

SORA comparisons remain disabled. Legacy rates are retained only as a versioned unverified fixture with unknown source URL/observation date. They must not overwrite independently observed rates or be presented as MAS benchmarks.

### Freshness and source preservation

Committed market changes must invalidate cached analytics on the next request; errors must not silently fall back to stale data. The current implementation uses database market-generation tracking and Singapore calendar date, with generation checks on in-flight calculations. Market writes invalidate prepared defaults; lead/job writes do not. A changed generation rejects a calculation rather than publishing a mixed result. This evolves the original connection/data-version mechanism without weakening its freshness requirement. There is no guarantee of one snapshot across all parallel dashboard requests. Writers refresh derived benchmarks; current overview valuations remain date-filtered from transactions.

The URA feed is rolling and mutable, not a complete historical archive. Reconciliation compares normalized identity, period, multiplicity and amount totals; counts alone do not prove parity. Retain original captures/hashes locally without keys/tokens. The reviewed 5 October source snapshot and 35 identity approvals were applied with preservation/recovery checks. Future completeness is not established: general rebuild and scheduled source replacement remain quarantined. New merges require attributable reviewer/date, complete evidence and exact preconditions; unknown coordinates/districts are not positive identity proof.

## Map interaction

- **Amenities start hidden.** Users opt into MRT, school, hawker, supermarket and park layers. The map provides a visible legend and names on hover.
- Numbered neutral clusters represent grouped developments; clicking zooms into the group. They do not represent amenities or distances.
- Sales development colors show regions: CCR green, RCR terracotta, OCR teal. Rental development colors show project gross yield: at least 4.25% green, at least 3.25% amber, lower terracotta, unavailable gray. Approximate points use an amber dashed treatment and disclose district-level placement.
- Clicking a development inspects it in a fixed panel without changing analytics filters, recentering the viewport or issuing a new analytics query. **Show only this development** explicitly applies a filter and closes inspection.
- Optional green 400m and blue 800m straight-line rings belong to the inspected exact location. Closing/replacing inspection or starting a new search removes them. Approximate points have no precise rings.
- Clicking empty map space establishes the user's radius search in place, with a clear control. Map inspection and search radius are distinct states. Table pagination/nonlocation data refreshes preserve the viewport; restored radius links focus their location initially.

Loading, empty, error and missing/approximate evidence states must remain understandable. Preserve keyboard/mobile access, truthful labels and uncapped aggregate correctness during UX changes. External OneMap tile delivery is a separate integration from locally bundled map styles.

## Implementation and visual direction

React 18/Vite client, Express server, SQLite WAL/migrations and a separate maintenance scheduler run in the Node 22.23.3 release image. Express serves the built frontend; protected Caddy terminates staging HTTPS. Database state remains outside the image. Readiness requires the schema, populated market and prepared default analytics, not just a running HTTP process.

Brand direction: Habitat green `#4F7942`, terracotta `#CB6D51`, teal `#00B080`, warm background `#FFFAF0`, sand `#F0E6D2`; Montserrat headings and Open Sans body text. Use the existing header building icon consistently, including the browser favicon. Current components/styles are the implementation reference; proposed designs are not evidence of shipped behavior.

## Deferred capabilities and approval boundaries

Full-product code includes explicit confirmation, durable email outbox/idempotency, signed provider events, suppression, retention review, private operator sessions and privacy-aware recovery. These are gated capabilities, not live services. Provider acceptance must never be called inbox delivery; a GET/link scanner cannot grant marketing confirmation; expired/replayed tokens cannot confirm consent. Mock dispatch cannot become live acceptance.

Before collecting real contacts, verify the actual notice, recipient/registration, processors, retention and sender practices with the owner; independently durable privacy-event replication and recovery are mandatory. Implemented retention defaults are 12 months from creation for reviewed unconverted enquiries and five years from recorded conversion for converted enquiries; unreviewed legacy records or conversions without dates are held for review. These implementation defaults do not establish approval of an actual rendered notice or permission to enable cleanup.

Research plans in [the usability pack](research/USER_TESTING_PLAN.md) describe proposed participants/tasks, not findings or approved new scope. Broader amenity coverage, richer analytics, cold-query improvement and any public/full-product launch need the evidence and decisions tracked in [operations](OPERATIONS.md).
