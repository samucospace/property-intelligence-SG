# Concurrent startup repair — 7 October 2026

## Cause and fix

The favicon CI run 37586511741 failed its first attempt because one of five processes saw the market generation change during valuation preparation. A retry passed, but did not repair the cause.

Amenity preparation checked `seed_versions` before acquiring SQLite's write lock. Two startup processes could both see an absent version, then seed sequentially. The completion marker was committed before dependent livability scoring, allowing another process to prepare valuations while those scores still changed the market generation. Repeated startup could also rewrite approximate locations whose intentionally unavailable scores remained NULL.

The seed function now rechecks the version after obtaining the write lock. Amenities, dependent project scores and the completion marker commit in one transaction; scoring failure rolls them all back. Missing-score startup preparation also rechecks under the write lock and excludes intentionally approximate/invalid locations. The valuation generation guard is unchanged and still rejects a genuine market write during calculation. No retry loop masks inconsistent data.

## Evidence

Before the fix, deterministic regressions reproduced 798 amenity inserts instead of 399, a completion marker surviving a scoring failure, and market generation increments on repeated approximate-location preparation. Those three regressions now pass. A separate real external-market-write regression confirms the existing valuation guard still fails closed.

- Full Windows and Linux suites: 278/278 passed.
- Production image build passed.
- Actual Linux release image, read-only container with no external network: 20 fresh starts, five existing starts, five rounds of five concurrent empty-database starts, and five rounds of five concurrent populated-database starts — **75/75 passed**. Populated starts also checked prepared-market readiness.
- CI qualification now exercises three rounds each of empty and populated concurrent startup, rather than one empty-database batch. Per-process timeouts and all-pass requirements remain enforced.

Evidence files: `audit/2026-10-07/startup-fix-windows-results.json`, `startup-fix-linux-results.json`, `startup-qualification-results.json`; test fixture sources are retained in `server/tests/startup-preparation.test.js`.

Remote CI and staging rollout are pending at the initial repair commit. Real ingestion concurrent with valuation preparation may still cause a safe refusal; that guard is intentionally preserved. This repair does not close unrelated public-launch gates.
