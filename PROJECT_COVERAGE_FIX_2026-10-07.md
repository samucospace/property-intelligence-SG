# Named project property-type coverage — 7 October 2026

## Problem and resulting behavior

Selecting Binjai Crest returned no sales or rentals even though the deployed market database contains 30 sales and 89 leases. The frontend did not expose or send a property-type filter, and the analytics default excluded strata landed properties.

Project selection now shows all property types within the selected project. This applies to search, project links and API requests without an explicit property restriction, covering landed and executive condominiums as well as apartments. A visible Property Type selector lets users narrow the results deliberately. The selected type persists in shared URLs; clearing all filters restores the condo/apartment overview. An explicitly supplied API property restriction is respected. Rental sale benchmarks use the same resolved property type as the rental query.

The general nationwide overview retains its approved condo default. Empty table messages direct users to property type, dates and other active filters. No market records, consent settings or customer-email controls are changed.

## Validation and deployment

- Four regression scenarios cover strata sales/rentals/map/yield arithmetic, executive condominiums, explicit restrictions and preserved nationwide defaults.
- Full local suite: 266/266 passed on Windows and Linux Node 22.23.3. Production frontend image build passed.
- Source fix commit: `dc37eba7a35f4ae12811a8937eea769c05cd15da`. [GitHub CI](https://github.com/samucospace/property-intelligence-SG/actions/runs/37581938359) passed tests, frontend build, dependency audit, image build and production startup/packaging checks.
- Deployed image: `property-intelligence-sg:project-coverage-20261007`, identity `sha256:34009c8f373be74a911888dd245814326abe9b7bee1650d6140da5de34bdc890`, labelled with source revision `dc37eba`. The app and scheduler use this image; the prior image and Compose configuration are retained for rollback. Market storage is reused without a data migration. Actual-host production smoke and readiness passed.
- Protected staging desktop/mobile browser checks passed project links, sales/rentals, deliberate condo exclusion, landed inclusion, URL persistence and search resetting the selected-project type to All Property Types. No page errors or horizontal page overflow were observed. External third-party assets were blocked in browser qualification; this is not a complete external map-provider qualification.
- The current five-year window displays 28 sales and 88 rentals for Binjai Crest. External HTTPS boundary checks passed again; lead capture, customer email, admin gateway and ingestion remain contained, and backend port 3001 stays bound to loopback.

Evidence: `audit/2026-10-07/project-fix-windows-results.json`, `project-fix-linux-results.json`, `project-browser-results.json`, `project-fix-https-results.json`, and the desktop/mobile Binjai screenshots in the same directory.

The protected staging scope remains analytics-only. Operations preparation and HTTPS deployment are documented separately in `PRIVATE_DEPLOYMENT_STATUS_2026-10-07.md`.
