# Phase 2 metric and provenance contract

Approved by **Sam Fraser on 5 October 2026 in this chat**. This approves the definitions and exclusions below; it does not approve individual identity mappings, source deletions, deployment or public launch.

## Transaction summaries

Sales and rental summaries, tables, time series and maps use the selected period and applicable filters. Rental dates are monthly: a selected day includes its entire month. Sales dates supplied as month/year are stored as the first of that month. Pagination counts all filtered rows, with stable date and record-ID ordering. Bulk sales remain visible in the transaction table but are excluded from single-unit sale summary/valuation estimates.

Missing estimates are null and display N/A. Counts of no matching transactions are zero. Pending project identity reviews are excluded from public analytics, not deleted. Unknown planning areas remain unknown; postal-district descriptions are labelled as district descriptions and are not authoritative planning-area assignments.

## Gross yield

For each eligible project: **median monthly rental psf × 12 ÷ median sale psf × 100**. The headline is the median of eligible project yields, rounded to two decimals. It is not an average yield or the ratio of market-wide medians.

Sam reconfirmed this definition on 5 October subject to clear median labeling. The headline is labelled **Median Project Gross Yield**, with the explanation **Median across eligible projects; each project counts once**. Project detail/map/newsletter estimates identify their median inputs. Individual-lease estimates are labelled separately, since an individual lease's rent is not a project median.

Rental records follow the selected window. Sales use 24 calendar months ending on the selected end date, starting on the first day of the month 23 months earlier. This includes a partial endpoint month and is explicitly returned in `metricContract.saleWindow` and each `saleBenchmark`. Historical filters use historical sales, not today's precomputed benchmark.

Each project requires at least **three positive usable rental psf values and three positive usable single-unit sales**. Invalid/non-positive/missing psf values do not count toward thresholds. Sales match the same project, unit-size, property type and tenure filters. Sales have no bedroom field: bedroom and rent-price filters apply only to rentals. Bedroom breakdown yields are withheld rather than dividing a bedroom rental average by an unrelated market sale average.

Rental psf uses the midpoint of finite area bands and is an estimate. Open-ended bands (`<`, `<=`, `>`, `>=`) have no defensible midpoint: their leases remain, but area/psf/yield estimates are withheld. Gross estimates exclude financing, taxes, maintenance and vacancy. The drawer shows the psf formula actually used, its sales window and usable sample counts. Individual caveat yields use the same qualified project sale denominator; the newsletter ranks project medians over its disclosed trailing comparison window.

## Spatial coverage and rates

Approximate district-centre coordinates and unavailable locations have no precise scores or nearby-amenity claims, including the detail API. Grade names describe amenity proximity; they do not promise walkability or car dependence.

Distances are straight-line haversine estimates against an incomplete curated catalog. An optional time estimate divides distance by 80 metres/minute; it is not a pedestrian route, crossing-aware journey, or school-admission boundary. The detail response discloses catalog and school counts. Seed amenities are not a verified national catalog.

SORA comparisons are disabled. Legacy rates are retained as a versioned, explicitly unverified fixture with unknown source URL/observation date; they must not overwrite independently observed rates or be marketed as MAS benchmarks.

## Freshness and source scope

Before serving cached analytics, the API checks SQLite `data_version`, the local connection write revision, connection identity and date. A committed external change is observed on the next request (no restart or 60-second wait). An in-flight response may reflect its earlier reads; no claim of snapshot consistency across all parallel dashboard queries is made. Database/recovery errors propagate instead of silently serving cached responses. Materialized benchmarks must be refreshed by writers; current overview valuations are independently date-filtered from transactions.

The [URA API reference](https://eservice.ura.gov.sg/maps/api/) describes a rolling five-year feed whose records may change. A complete current feed is not a complete historical archive. Source comparison checks full normalized identity, period, multiplicity and amount totals; counts alone cannot establish parity. Original provider responses and hashes are retained locally without keys/tokens. The reviewed 5 October snapshot was promoted locally after source parity, preservation, encrypted restore and Linux qualification. General rebuild and scheduled replacement remain quarantined; this one-time snapshot does not prove future provider completeness.
