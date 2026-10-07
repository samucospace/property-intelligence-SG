# Filter coverage repairs — 7 October 2026

The five gaps identified in `FILTER_COVERAGE_REVIEW_2026-10-07.md` are repaired in source:

- Unrestricted rental searches include unknown-area leases in counts and monthly rent medians. An explicit size limit excludes records whose size cannot be evaluated. Missing per-area rates and yields stay unavailable, and the coverage note explains why. Clearing the maximum means no limit, including after refresh. Zero is respected as a deliberate bound.
- Switching sales/rental mode clears price bounds and resets the table page. The units and magnitudes no longer carry across modes.
- New project, street, district, planning-area and map-radius searches replace the previous location constraints. Non-location criteria remain available. Selecting a project sets All Property Types.
- Shared URLs preserve the active search: locations, property type, tenure, dates, bedrooms, size, price/rent, radius/coordinates and table page. Unsupported or malformed incoming values fall back safely. Old project links remain compatible.
- Previous/Next table controls reach later pages, and changes to search criteria reset to page one. Summaries/maps continue to cover the full matching result. Sales retain the server's newest-first order.

Validation: 274/274 regression tests pass on Windows and Linux Node 22.23.3, including unknown-area coverage/yield safeguards, zero caps, disjoint pages/full summaries, URL round-trips and location replacement. The production frontend image builds successfully.

Source fix `e16cd90169947d12dd9b4841ad0e946d96cf1a0f` is committed and pushed. [GitHub CI](https://github.com/samucospace/property-intelligence-SG/actions/runs/37585228530) passed tests, frontend build, dependency audit, release image build and startup/packaging checks.

Protected staging now runs `property-intelligence-sg:filter-repairs-20261007`, identity `sha256:c278607bd57fa2a2d076f6527b0377c3db231354eae2831970d9c7b26e25e94c`, labelled with the full source revision. Actual-host smoke/readiness passed; the prior image and Compose configuration are retained for rollback. Market storage was reused without changing source records. The private backend stays bound to `127.0.0.1:3001`.

Desktop/mobile browser checks passed all five fixes: Regency Park's current five-year unrestricted search shows 430 leases including 235 unknown-area leases, while an explicit 10,000-sqft cap shows 195. Next-page rows are disjoint, page links survive reload, criteria changes reset the page, tenure/dates/price bounds survive reload, both mode switches clear price bounds, street selection clears the previous project, and Clear Filters restores defaults. No page errors or horizontal overflow were observed. External third-party assets were blocked; this is not an external map-provider qualification. HTTPS/password and disabled lead/admin/ingestion checks passed again.

Evidence: `audit/2026-10-07/filter-fix-browser-results.json`, `filter-fix-https-results.json`, Windows/Linux regression reports and desktop/mobile screenshots in the same directory.

Protected analytics-only scope remains in use. This change does not resolve the separately recorded cold-query capacity gate or incomplete alert/account setup.
