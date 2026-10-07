# Map interaction improvements — 7 October 2026

The old map mixed cluster-size colors with property-region/yield colors, hid marker names behind clicks, and silently filtered the dashboard when a property was inspected. That filter immediately refocused the map, while selection rings could remain after closing the popup.

## Resulting behavior

- All amenity layers start hidden, as requested. Users add MRTs, schools, hawker centres, supermarkets or parks with labelled pressed-state buttons.
- Numbered circles use a single neutral color and count grouped developments. The legend and hover label explain that clicking zooms into the group. Cluster coverage polygons are disabled. Property pins/clusters sit above amenities so overlapping amenity icons cannot intercept them.
- Sale pin colors have a named market-region legend; rental pin colors have explicit yield bands, including unavailable yield. Property and amenity hover labels identify names and types. Approximate district pins are explicitly marked.
- Inspecting a property opens a fixed panel inside the map. It does not issue an analytics request, change filters or reset the viewport. Its close control remains accessible without automatic panning. Filtering requires the explicit **Show only this development** action.
- Property distance rings are opt-in. The panel labels green 400 m and blue 800 m as straight-line distances, not walking routes. Closing details, inspecting a different property/amenity or starting another search clears them. Approximate district locations do not offer precise distance rings.
- Clicking an empty map spot creates a radius search in place. A dashed green circle and clear-search button explain and remove it. Radius changes do not refocus the map. Restored radius links receive an appropriate initial view; deliberate location searches focus only after their matching data arrives. Data/page/non-location-filter updates do not reset a user's map view.
- Map styling is bundled locally instead of depending on an external stylesheet download.

## Validation

282/282 Windows and Linux regression tests pass; the production image builds successfully. Real Leaflet pointer/touch interactions are qualified against a contact-free temporary fixture. Desktop/mobile checks cover hover names, unchanged requests/URL/viewport during inspection, optional-ring lifecycle, in-place radius searches and clearing, cluster navigation, approximate-ring withholding, explicit filtering, hidden amenities/toggles and page overflow. External tiles are replaced with blank test tiles; this qualifies interaction behavior rather than third-party tile availability.

Evidence: `audit/2026-10-07/map-ux-windows-results.json`, `map-ux-linux-results.json`, `map-ux-local-results.json`, and local screenshots. Source changes require commit/CI and staging qualification before rollout is marked complete.
