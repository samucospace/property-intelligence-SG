# Docker release-image qualification — 5 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**Passed locally on Docker Desktop, Linux/amd64, Node 22.23.3.** Final qualification includes the completed identity map and corrected backup-path reporting. This is working-tree evidence; no published commit, CI run, deployment or public launch is claimed.

Release image: `property-intelligence-sg:phase2-final-20261005`, ID `sha256:3e8c4f1755c5bab0c1f995fcef341528bf624c90ce4cb4129fb55b4762108c79`. Disposable test derivative: `property-intelligence-sg:phase2-final-tests-20261005`, ID `sha256:e49227c015d472882d58507b91fe0f68519de6a3d826e10c5bae77ec906e8d99`. [Final machine-readable evidence](../../../audit/2026-10-05/phase2-final-qualification.json) binds image identities, logs, database hashes and results. Earlier [qualification evidence](../../../audit/2026-10-05/docker-qualification.json) is historical.

| Check | Result |
|---|---|
| Release build and frontend compilation | Passed with pinned runtime and locked dependencies; existing bundle-size warning remains. |
| Repeated startup in the exact final release image | 20 fresh, five existing and five concurrent starts passed. |
| Production smoke and packaging | Passed as non-root node (UID 1000), read-only root, disposable database, generated temporary secrets, networking disabled. Health and compiled frontend return HTTP 200. Local environment/database absent; required fixture/map present. |
| Final Linux suite | 189/189 tests in 15 files passed in the disposable derivative. Recovery, interrupted/concurrent migrations, scheduling, operational preservation and nine reviewed-promotion tests pass. |
| Windows suite | 189/189 tests in 15 files passed on Node 22.23.3. |
| Promoted real-data HTTP check | Read-only database mount, disposable copy in tmpfs, no external network. All 35 approvals visible. Independent Python median arithmetic matches API: ST MICHAEL REGENCY, four matched sales/four usable rents, 3.02% median project gross yield. |
| Local promoted database | Hash verified against final candidate, integrity OK, no foreign-key violations; original rollback hash and fresh-process encrypted restore verified. |

Production/startup/data checks use read-only container roots. The test derivative has writable isolated caches and Git/development dependencies; these are absent from the release image. Its initial read-only-cache failure was corrected before the successful suite. All containers use `--rm`; no image was pushed and no services remain running from these checks.

The earlier packaging failure found that nested local environment files were not excluded. Docker ignore rules were corrected and final absence checks pass. The failed image was not published. No real credentials were mounted, no external provider calls/email were enabled, and the market file was mounted read-only solely to create a disposable validation copy.

The reviewed snapshot is now promoted **locally**, with all identity approvals applied. General rebuild and scheduled sync remain quarantined. Proxy/TLS, persistent-volume ownership/storage, service separation, scheduled timing, encrypted/off-host backup configuration and actual-host recovery remain private-deployment checks. Public launch remains NO-GO pending later phases; Phase 3 retains email, consent, access and recovery.
