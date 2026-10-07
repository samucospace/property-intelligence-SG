# Browser-tab branding — 7 October 2026

The browser tab now uses the same white Building2 symbol and green rounded background as the Singapore Home Intel header. A scalable local SVG avoids a generic placeholder and stays sharp at tab sizes. Its Lucide licence is retained in the asset. The tab title now uses the full brand name.

The icon URL includes a version to refresh cached icons. No application logic, database or release-scope settings change. Production build and protected staging asset verification are required for rollout.

Source commit: `c17bce4e4cb34cb1d2c8ff5f68bea18753cbc0d3`. Production build passed. The first CI attempt (run 37586511741) passed tests/build but one of five concurrent startup processes exited at the valuation preparation guard: `Market changed during valuation preparation; retry after sync`. This code is unchanged by the favicon update. The second attempt passed all CI checks; passing a retry does not repair this intermittent concurrent-startup issue, which remains a separate release-readiness finding.

Deployed image: `property-intelligence-sg:favicon-20261007`, identity `sha256:24dd8f6e015b5b51f29f498c8e21df0d127104a97937ca506abac5bc8e091599`, labelled with the source revision above. Staging readiness passed after rollout. Actual browser qualification confirmed the full tab title, versioned icon link, HTTP 200 SVG response and successful image decoding. Evidence: `audit/2026-10-07/favicon-results.json`. The prior image/configuration is retained for rollback; analytics-only scope and market storage are unchanged.
