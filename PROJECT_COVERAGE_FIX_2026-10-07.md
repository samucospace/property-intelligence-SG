# Named project property-type coverage — 7 October 2026

## Problem and resulting behavior

Selecting Binjai Crest returned no sales or rentals even though the deployed market database contains 30 sales and 89 leases. The frontend did not expose or send a property-type filter, and the analytics default excluded strata landed properties.

Project selection now shows all property types within the selected project. This applies to search, project links and API requests without an explicit property restriction, covering landed and executive condominiums as well as apartments. A visible Property Type selector lets users narrow the results deliberately. The selected type persists in shared URLs; clearing all filters restores the condo/apartment overview. An explicitly supplied API property restriction is respected. Rental sale benchmarks use the same resolved property type as the rental query.

The general nationwide overview retains its approved condo default. Empty table messages direct users to property type, dates and other active filters. No market records, consent settings or customer-email controls are changed.

## Validation and deployment

- Four regression scenarios cover strata sales/rentals/map/yield arithmetic, executive condominiums, explicit restrictions and preserved nationwide defaults.
- Full local suite: 266/266 passed on Windows and Linux Node 22.23.3. Production frontend image build passed.
- Staging rollout and browser verification are pending at the time of the initial fix commit. Record final evidence after deployment; source push alone does not deploy the server.

The protected staging scope remains analytics-only. Operations preparation and HTTPS deployment are documented separately in `PRIVATE_DEPLOYMENT_STATUS_2026-10-07.md`.
