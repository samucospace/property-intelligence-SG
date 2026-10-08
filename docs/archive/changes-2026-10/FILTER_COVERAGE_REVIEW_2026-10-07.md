# Search and filter coverage review — 7 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


Scope: targeted read-only review of the committed/deployed project-coverage fix and adjacent search, filter, URL and table paths. This is not an exhaustive application audit. No production records or application code were changed during this review.

**Follow-up: all five findings below are now repaired and verified on protected staging.** The findings remain as the historical review record; see `FILTER_FIXES_2026-10-07.md` for the source revision and deployment evidence.

## Confirmed findings

### P1 — Default floor-area cap hides leases with unknown area

The frontend always sends `unitSizeMax: 10000`. The rental query applies an area comparison for that value, so SQL excludes NULL areas even though the user has not deliberately narrowed the search. The deployed database contains 7,362 leases with unknown area. In the current five-year Regency Park window, a selected-project query without a size constraint returns 430 leases; the frontend's default cap returns 195. Thus 235 available leases disappear from counts, rental medians and tables for that example.

Fix direction: represent no size constraint explicitly; retain unknown-area leases for rent/count analytics while withholding per-area/yield calculations when necessary. Apply exclusion only when a user intentionally sets a size constraint, and explain coverage. Do not invent floor areas or change source records.

### P2 — Sales and rental modes share price bounds

Both modes reuse `priceMin`/`priceMax`. A $1,000,000 sales minimum becomes a $1,000,000 monthly rental minimum after switching modes. The deployed Binjai Crest rental query returns 88 leases without that bound and zero with it. The controls relabel the bound but retain its value.

Fix direction: retain separate sale-price and rent bounds, or clear the mode-specific bounds when switching, with regression coverage for both directions.

### P2 — Location selection can retain incompatible previous location filters

Project, street, district and planning-area selection callbacks spread the prior state and change only the selected field. For example, selecting Keppel Bay View after Binjai Crest retains both constraints and returns no transactions. These constraints are visible as separate pills, but choosing a new location does not behave like a fresh location search.

Fix direction: define replacement versus additive search clearly. Clear incompatible prior location/radius constraints for a replacement search; expose intentional intersections explicitly.

### P2 — Shared URLs and reloads do not preserve the whole search

URL synchronization preserves project/location, mode and property type, but not tenure, dates, size, bedroom or price/rent bounds. Reloading or sharing a narrowed search can therefore produce a different result. This limits reproducibility of displayed analytics.

Fix direction: serialize and validate the complete user-selected filter state, or clearly describe links as project/location links rather than snapshots of a filtered search.

### P2 — Later transaction pages cannot be reached from the UI

The server supports `page`, `limit` and `totalPages` and defaults to 100 rows. The frontend never requests later pages and provides no next/load-more controls. It labels rows as a subset of the total, but users cannot reach the remainder from the transaction log.

Fix direction: add accessible pagination or load-more for tables, preserving complete-market summaries/maps and explaining that the chart/table is a subset where applicable.

## Other limitations

The previously documented cold-query latency remains open. This review does not establish that all supported source property-type spellings, maps, neighbourhood metadata or external services have been exhaustively qualified. The final documentation CI for `77f83ac` passed; that does not substitute for tests of these newly identified gaps.

Original reproduction evidence: `audit/2026-10-07/filter-gap-data-results.jsonl` and `filter-gap-browser-results.json`. Browser reproduction helper: `audit/2026-10-07/review-filter-browser.cjs`. The five findings were open at initial review and have since been fixed and deployed as documented above.
