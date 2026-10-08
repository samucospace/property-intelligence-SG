# CI startup qualification repair — 6 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


The push of `0e05528` correctly triggered CI. [Run 37426786692](https://github.com/samucospace/property-intelligence-SG/actions/runs/37426786692) passed the regression suite, frontend build, dependency audits and Docker build, then failed **Qualify startup in the release image**. Its final production-packaging step was consequently skipped. The email's “all jobs failed” referred to the workflow's single combined Test & Build job, not every individual check.

## Cause and repair

`qualify-startup.js` starts its isolated server processes using `node --input-type=module -e ...`. The Phase 4 median worker inherited that process option. Node cannot use `--input-type` when launching the worker's JavaScript file, so it raised `ERR_INPUT_TYPE_NOT_ALLOWED` before startup completed. The earlier local suite and file-entry-point production smoke did not exercise this parent invocation; their passing evidence did not cover the failing startup qualification.

`medianQueries.js` now removes only the eval/stdin-specific input-type option from the file worker's inherited options, including both `--input-type=module` and `--input-type module`. Other runtime options are preserved. Two new child-process regression tests run a real SQLite aggregation and verify the exact median for both option forms. The failing qualification remains enabled and unchanged.

## Validation

- Windows regression suite: **256/256 passed**.
- Exact Linux Node 22.23.3 CI startup command, read-only filesystem and no network: **20 fresh starts, 5 existing-database starts and 5 concurrent starts passed**. Evidence: [ci-worker-startup-results.json](../../../audit/2026-10-06/ci-worker-startup-results.json).
- Production startup/packaging smoke passed on the repaired local image: non-root runtime, required data, no baked credentials/database and no external network.
- Repaired local image: `property-intelligence-sg:phase4-ci-fixed-20261006`, identity `sha256:653688d49b578ca21d819733cb37ed0d390617e82fc7e16a13bf855198c88967`.

The follow-up push triggers a new GitHub run, which must pass before remote CI is considered closed. Consult GitHub's run for the pushed commit for its authoritative outcome. Historical Phase 4 manifests retain their original image and test-count provenance; this repair supersedes the worker-launch behavior. Broader cold-query performance and hosted go-live gates remain unchanged.
