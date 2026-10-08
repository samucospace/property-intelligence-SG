# Concurrent startup repair — 7 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


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

Source repair `7f9200c91a52f44fc19f7e33407326e9ba10a03c` is committed and pushed. [GitHub CI run 37589128774](https://github.com/samucospace/property-intelligence-SG/actions/runs/37589128774) passed on its first attempt, including the strengthened 55-startup qualification.

Deployed staging image: `property-intelligence-sg:startup-repair-20261007`, identity `sha256:71cd22954a376f06da82bb6b140e4e8e4f91e17f334837b885636494b78e625c`, labelled with the source revision. Readiness and protected HTTPS/lead/admin containment passed after rollout. The prior image and Compose configuration are retained for rollback.

An additional independent run on the actual DigitalOcean Droplet passed **55/55** startups: 20 fresh, five existing, 15 concurrent empty and 15 concurrent populated. It used temporary fixtures in a read-only container with no external networking or live database mounts. Evidence: `audit/2026-10-07/startup-qualification-droplet.json` and `startup-fix-https-results.json`.

The reproduced startup-preparation race is resolved. Real ingestion concurrent with valuation preparation may still cause a safe refusal; that guard is intentionally preserved. This repair does not close unrelated public-launch gates.
