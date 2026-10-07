# Filter coverage repairs — 7 October 2026

The five gaps identified in `FILTER_COVERAGE_REVIEW_2026-10-07.md` are repaired in source:

- Unrestricted rental searches include unknown-area leases in counts and monthly rent medians. An explicit size limit excludes records whose size cannot be evaluated. Missing per-area rates and yields stay unavailable, and the coverage note explains why. Clearing the maximum means no limit, including after refresh. Zero is respected as a deliberate bound.
- Switching sales/rental mode clears price bounds and resets the table page. The units and magnitudes no longer carry across modes.
- New project, street, district, planning-area and map-radius searches replace the previous location constraints. Non-location criteria remain available. Selecting a project sets All Property Types.
- Shared URLs preserve the active search: locations, property type, tenure, dates, bedrooms, size, price/rent, radius/coordinates and table page. Unsupported or malformed incoming values fall back safely. Old project links remain compatible.
- Previous/Next table controls reach later pages, and changes to search criteria reset to page one. Summaries/maps continue to cover the full matching result. Sales retain the server's newest-first order.

Validation: 274/274 regression tests pass on Windows and Linux Node 22.23.3, including unknown-area coverage/yield safeguards, zero caps, disjoint pages/full summaries, URL round-trips and location replacement. The production frontend image builds successfully.

Deployment and actual browser verification are pending at the initial source commit. Protected analytics-only scope and existing market storage remain in use. This change does not resolve the separately recorded cold-query capacity gate or incomplete alert/account setup.
