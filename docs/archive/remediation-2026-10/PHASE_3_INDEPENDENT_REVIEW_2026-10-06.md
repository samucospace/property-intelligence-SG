# Phase 3 independent review — 6 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**Repair follow-up:** The findings below describe the reviewed pre-repair working tree. Subsequent fixes and current gate status are recorded in the [corrected completion report](PHASE_3_COMPLETION_REPORT_2026-10-06.md) and [operations runbook](PHASE_3_OPERATIONS_RUNBOOK.md).

**Assessment: Phase 3 is partially implemented, but its original exit gates are not yet satisfied. Public release remains NO-GO.** This review compares the current working tree with the readiness report, governing remediation plan, detailed Phase 3 plan and completion report. It does not change application code or approve deployment.

## Verification performed

- All **212 tests in 19 suites passed** independently. The available bundled runtime was **Node 24.19.0**, rather than the project's required Node 22.23.3. This confirms this local run, not target-runtime qualification.
- The client production build passed, with a **920.64 kB JavaScript bundle (266.30 kB gzip)** and a chunk-size warning. “Clean build” should acknowledge that warning.
- Additional direct Node and HTTP checks used disposable SQLite fixtures and mock email only. They reproduced the restore crash, acceptance of a confirmation token without an expiry, persistent quarantine after confirmation, misleading confirmation cooldown success after provider failure, and advisory success without notification configuration.
- Direct validator checks accepted `page: true`, `limit: [1]`, `radiusKm: [2]`, `priceMax: 'Infinity'` and `dateFrom: '2026-02-99'`.
- No production email, deployment, real offsite recovery or owner approval was exercised. Existing implementation files were left unchanged.

## Findings requiring correction before Phase 3 closure

### R3-01 — P1: The outbox is not connected to actual email flows

**Evidence:** `server/index.js:327` and `:376` still call `sendEmail` directly. `server/scripts/send-weekly-newsletter.js` also sends directly. References to `enqueueEmail` and `processOutboxBatch` are confined to the new utility and its tests; there is no running outbox worker in the scheduler.

**Effect:** Confirmation and advisory sends lack durable retries. Newsletter delivery still has a provider-acceptance/database-update crash window. Outbox deduplication and dispatch claims do not protect these paths. The completion report's statement that synchronous sends were replaced is incorrect.

**Required improvement:** Commit the lead and outbox intent atomically; enqueue all three email types; run a scheduled or continuously supervised worker; update cooldown/acceptance metadata from actual worker outcomes. Use stable keys for each confirmation request, advisory request and newsletter campaign. Carry that key through the provider boundary where supported. Keep provider acceptance distinct from delivery.

**Acceptance evidence:** Real HTTP signup/advisory and newsletter entry points produce durable outbox records, survive restart and retry without uncontrolled duplicate records or sends.

### R3-02 — P1: Claimed email work cannot recover after a crash

**Evidence:** `server/utils/emailQueue.js:66–79` only selects `pending`/`failed` rows, then sets `claimed_at`. Nothing expires or reclaims `claimed` rows. Provider calls have no explicit application timeout, and the outbox key is not passed through the adapter to the provider. Acceptance updates do not condition on the current lease owner.

**Effect:** A worker crash after claiming can strand mail forever. Reclaiming rows alone would introduce a duplicate-send risk if the provider accepted a message before the process died.

**Required improvement:** Add lease expiry and owner/fencing checks, bounded provider timeouts, recovery of stale claims and provider-side idempotency/reconciliation for ambiguous acceptance. Refuse to record mock dispatches as live acceptance. Track suppressed work separately from permanent provider failures.

**Acceptance evidence:** Concurrent workers on separate disk-backed connections; crash before send, after provider acceptance and before persistence; retry exhaustion; timeout/429/5xx behavior. The existing “two workers” test makes sequential calls on one connection and does not establish this evidence.

### R3-03 — P1: The restore privacy hook crashes in normal Node execution

**Evidence:** `server/scripts/restore-baseline.js:51` evaluates `const crypto = require ? null : null;` inside an ES module. A direct invocation reproduced `ReferenceError: require is not defined`, exiting the process. The Vitest test passed despite this production execution failure.

**Required improvement:** Remove the invalid reference; use normal module imports and awaited database operations with checked statement errors and guaranteed closure. Apply the reconciliation transactionally and abort restoration on any failure.

**Acceptance evidence:** Execute the actual restore script as a separate Node process on the pinned runtime and final Linux image, rather than testing only the imported helper under Vitest.

### R3-04 — P1: Restoration can still reinstate suppressed or erased personal data

**Evidence:** `email_suppression` is a table in the same application database, not an independently persisted external ledger. `restoreBaseline` defaults to an empty suppression array, skips privacy reconciliation when it is empty, and its command-line interface has no ledger input. The hook only sets `unsubscribed_at`, even when the reason is `erased`.

**Effect:** Losing the host/database can lose post-backup preferences. The normal restore command bypasses the promised replay. An erased person's name, phone and details can return even when an injected suppression entry prevents email. Future queued notification payloads can retain that person's details after deleting the lead.

**Required improvement:** Persist and replicate suppression/deletion events independently, with freshness checks and an explicit restore input. Fail closed before serving/sending if reconciliation cannot be established. Apply erasure to personal fields and related queued payloads, not just subscription status. Cover older backup schemas, retain event precedence/history and report hashes before and after reconciliation accurately.

**Acceptance evidence:** Backup, unsubscribe and erase distinct contacts afterwards, simulate loss of the live database, then restore through the real command using only recovery materials. Verify both marketing suppression and removal of erased personal data before traffic resumes.

### R3-05 — P1: Offsite recovery is a local-copy scaffold, not a passed recovery gate

**Evidence:** `server/scripts/replicate-backup-offsite.js:30` defaults to a sibling `offsite-replica` directory and uses filesystem copying. It has no cloud/SSH transport, verified remote destination, scheduled integration or retention execution; `retentionPolicy: '30-days'` is metadata only. Its test copies random bytes named `.enc` to another local folder, rather than restoring an encrypted SQLite backup from another host/account. `metadataFile` is unused.

**Required improvement:** Require an explicitly configured independent destination in production, wire replication into successful backups, implement remote retention, preserve the recovery metadata needed by the restore command and monitor freshness/failure. Complete a clean-host restore using separately held keys and record measured RPO/RTO. A mounted remote filesystem could be suitable if its independence and recovery behavior are actually verified.

**Additional gap:** `backup-db.js:141` still permits `KEEP_UNENCRYPTED_BACKUPS=true` in production. Reject that override for production personal-data backups. Test missing/invalid keys, corruption and wrong-key rejection, not only encryption round trips.

### R3-06 — P1: Failed sends can still produce misleading success responses

**Evidence:** Confirmation signup writes `last_confirmation_sent_at` before calling the provider (`server/index.js:313–319`). Direct HTTP verification returned 503 for a simulated provider failure, then 200 with “Confirmation link already dispatched recently” on immediate retry. Advisory notification is skipped entirely if the provider key or agent address is missing (`:374`), yet the response still promises a salesperson will be in touch.

**Required improvement:** Separate request throttling from verified provider acceptance. Return truthful queued/failed status and allow safe recovery after send failure. For the enabled advisory workflow, fail configuration checks or explicitly expose a durable manual-review workflow; do not silently bypass delivery. Prevent duplicate advisory records on retries after notification failures.

**Acceptance evidence:** Endpoint tests for missing configuration, provider rejection, retry/cooldown behavior and repeated advisory submission.

### R3-07 — P1: The consent migration and re-confirmation lifecycle remain incomplete

**Evidence:** Both confirmation endpoints allow absent expiry values; POST explicitly includes `confirmation_token_expires_at IS NULL` (`server/index.js:515`). A disposable legacy token with no expiry returned 200. Successful confirmation does not clear `is_quarantined`; the same fixture remained quarantined after confirmation. Migration 016 identifies legacy contacts using timestamp equality and a null token rather than verified consent evidence. Existing consent fields are updated in place, and suppression uses `INSERT OR REPLACE`, losing previous preference events.

**Required improvement:** Reject or explicitly expire legacy tokens without expiry. Clear quarantine only after a valid new opt-in and preserve its evidence. Quarantine all contacts lacking sufficient provenance, including migration-preconfirmed rows with outstanding tokens. Keep append-only consent/preference history and consent-version changes. Use consistent UTC handling for SQLite timestamps in GET and POST.

**Acceptance evidence:** Run migrations against realistic legacy fixtures, then perform scanner GET, fresh POST, replay, expiry and re-confirmation over HTTP. Prove the re-confirmed subscriber becomes eligible and the unverified subscriber remains excluded.

### R3-08 — P1: Admin sessions do not establish the planned accountable access boundary

**Evidence:** `server/utils/security.js:127` signs only an expiry timestamp, with no operator identity or session nonce. `requireAdmin` hardcodes `sam.fraser` for sessions and still allows the unrestricted long-lived `X-Admin-Key` fallback on sensitive routes (`server/index.js:173`). Revocation database errors return “not revoked”, with another fail-open catch in the middleware. Audit errors are logged and swallowed. Manual ingestion actions do not call the new audit helper.

**Required improvement:** Choose and document the governing plan's private/MFA-gated boundary or operator-account model. Issue unique sessions bound to authenticated operators; scope service credentials separately; fail closed on revocation failures; define audit-failure behavior and record all sensitive actions. Exercise expiry, rotation, logout, unauthorized actions and deployed-origin preflight over HTTP.

**Acceptance evidence:** Include storage-failure cases and actual route authorization, not just successful helper verification/revocation. Record the deployment boundary used to protect the administrative interface.

### R3-09 — P2: Input validation remains coercive despite the strict-schema claim

**Evidence:** `server/utils/validation.js:55–63` uses `Number()` on pagination; numeric filters use `parseFloat()`. Direct checks accepted booleans/arrays, infinity and an impossible calendar date. Newsletter submissions skip type validation of several optional fields. The detailed plan says the maximum limit is 100 while the implementation permits 500.

**Required improvement:** Specify allowed primitive types per endpoint, reject non-finite values and arrays/objects, validate calendar dates and price ordering, and align documented bounds. Check actual HTTP contracts, including missing bodies, malformed JSON, primitives, arrays and nested filters. Accepted malformed values are demonstrated here; an HTTP 500 for each of these values is not claimed.

### R3-10 — P1: Retention and communications approval are not demonstrated

**Evidence:** Converted-lead columns exist, but no application path records conversion. Cleanup defaults unmarked advisory leads to unconverted and deletes converted leads by `created_at`, without using `converted_at`. The privacy notice describes the 12-month rule but does not explain the implemented converted-lead/backup lifecycle. Generic “verified”/“accredited” partner claims remain, without the actual approved recipient identity shown in this report. No bounce/complaint webhook processing or independent event history is implemented.

**Required improvement:** Establish an auditable conversion-marking workflow before enabling cleanup and approve the retention clock and deletion behavior. Align the actual notice with processors, recipients and backup/restore practices. Record owner approval of the actual notices, partner identity, retention and sender practices; exercise bounce/complaint suppression and the authorized staging journey. This is an implementation/governance gap, not a legal determination about any particular retention period.

## Corrections needed in the completion report

1. Change “complete/verified locally” to **partially implemented; original Phase 3 gates open** until the above behavior is fixed and tested.
2. Correct the claims that actual email dispatch uses the outbox, that the suppression ledger is external, and that local copies establish off-host recovery.
3. Preserve the original gate definitions. In the detailed plan, **G3-9 is owner notice/privacy approval**; the completion report replaces it with generalized CEA wording. Duplicate-worker prevention and owner approval must not disappear when the matrix is rewritten.
4. Distinguish helper/unit coverage from real HTTP journeys, separate-process execution, concurrent/crash tests and hosted evidence. The consent tests execute handwritten SQL rather than the actual confirmation routes. The email transient-failure test injects 500, despite its title also naming 504/timeout. The recovery test invokes the helper, not a complete privacy-aware encrypted restore.
5. Record the exact revision/image digest, runtime, configuration scope and evidence artifacts. The previous Node 22/Linux image qualification predates Phase 3 and must be repeated for the new candidate.
6. State that the frontend build succeeds with a bundle-size warning. Bundle splitting is a useful Phase 4 improvement; it does not close the Phase 3 privacy/email gaps.

## Recommended sequence

1. Correct the restore crash and require independently recoverable suppression/erasure replay.
2. Integrate the outbox into real flows, recover expired claims and fix misleading failure/cooldown behavior.
3. Finish legacy consent/re-confirmation, admin failure handling and operational conversion tracking.
4. Add meaningful HTTP, multi-process and crash-recovery regressions; repeat Node 22/Linux qualification.
5. Complete independent offsite restore, sender/domain and bounce/complaint evidence, and owner approval of actual notices and practices.

Existing containment, read-only defaults, provider-ID checks, scanner-safe GET design, schema additions and helper tests are useful progress. They should be retained while closing these integration and recovery gaps.
