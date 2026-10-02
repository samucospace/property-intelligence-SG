# Evaluation evidence — 2 October 2026

These files support the root go-live readiness report and phased remediation plan. They are diagnostic reproductions, not production fixes or an automatically passing regression suite.

| File | Purpose |
|---|---|
| `data-check.py` / `data-results.json` | Read-only source snapshot, removal of leads from the copy, structural checks and market inventory |
| `extra-data.mjs` / `extra-data-results.json` | Normalization candidates, planning-area/classification checks and uncapped radius population |
| `probes.mjs` / `probe-results.json` | Synthetic ingestion, path binding, pagination, cache and HTTP/email/token behavior |
| `startup-check.mjs` / `startup-results.json` | Five fresh-disk subprocess bootstrap attempts |
| `benchmark.mjs` / `benchmark-results.json` | Local cold/warm query-function timings and JSON sizes |
| `dependency-audit.mjs` / `dependency-results.json` | npm bulk advisory lookup for exact locked package versions |

Environment: Windows, Node v24.19.0. SQLite fixture/snapshot files are intentionally ignored; do not commit or distribute them. Re-running scripts creates local database files; read their setup first. The provider probe intercepts requests and uses synthetic credentials/contacts, and must remain isolated from real email delivery. The data snapshot script reads the configured local source and writes only the audit copy.

The provider rejection probe needed an awaited initial DB read before fixture migration to avoid the separately reproduced application bootstrap race. This harness workaround is not an application fix.

Additional checks performed in the evaluation:

- Server suite: from `server`, set `DB_PATH=:memory:`, `NODE_ENV=test`, clear `RESEND_API_KEY` and `URA_ACCESS_KEY`, then run `node node_modules/vitest/vitest.mjs run`. Result: 5 files / 101 tests passed.
- Client build: from `client`, run `node node_modules/vite/bin/vite.js build`. Passed; JS 919.00 kB / 265.83 kB gzip, large-chunk warning.
- Local production-mode server on port 4317 using sanitized snapshot: built sales and rental views loaded in the in-app browser, with no captured console warnings/errors. Temporary server and browser tab were stopped/closed afterward.
- Docker daemon was unavailable. No container integration, production load, actual email delivery or live URA sync was performed.

Advisory lookup is time-bound and not equivalent to full npm audit dependency-path analysis. Benchmark timings exclude HTTP/network/rendering; warm values round to zero at the query-function boundary. Findings based on static inspection and external-service/operational gaps are distinguished in the report.
