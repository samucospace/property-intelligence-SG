# Phase 3 Detailed Implementation Plan: Email, Consent, Access and Recovery Controls

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**6 October implementation update:** Local code gaps have been repaired and qualified; see the [corrected completion report](PHASE_3_COMPLETION_REPORT_2026-10-06.md). Original G3-1 through G3-9 gates remain governing. Hosted recovery/communications evidence and owner approval remain open.

**Document Date:** 5 October 2026  
**Governing Documents:**
- [`GO_LIVE_REMEDIATION_PLAN_2026-10-02.md`](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md) (Phase 3)
- [`GO_LIVE_READINESS_REPORT_2026-10-02.md`](GO_LIVE_READINESS_REPORT_2026-10-02.md) (Findings GL-09, GL-10, GL-11, GL-12, GL-13, GL-16)
- [`PHASE_0_SCOPE_AND_GOVERNANCE.md`](PHASE_0_SCOPE_AND_GOVERNANCE.md)
- [`PHASE_0_OPERATIONS_RUNBOOK.md`](PHASE_0_OPERATIONS_RUNBOOK.md)
- [`PHASE_1_COMPLETION_REPORT_2026-10-02.md`](PHASE_1_COMPLETION_REPORT_2026-10-02.md)
- [`PHASE_2_COMPLETION_REPORT_2026-10-05.md`](PHASE_2_COMPLETION_REPORT_2026-10-05.md)

**Assigned Ownership:** Backend & Operations Engineering Lead  
**Accountable Release Owner & Privacy Approver:** Sam Fraser  
**Engineering Estimate:** 4–7 engineering days  
**Target Release Decision:** NO-GO until all Phase 3 gates and hosted deployment prerequisites are evidenced.

---

## 1. Executive Summary & Objective

Phase 0 established local containment, isolated staging defaults, and durable AES-256-GCM local snapshot drills. Phase 1 resolved SQLite startup concurrency, process-level runtime alignment on Node 22 LTS, and persistent Singapore-timezone scheduler coordination. Phase 2 reconciled historical dataset identities, aligned metric definitions with the approved contract, eliminated sparse-sample distortions, and quarantined approximate-coordinate livability claims.

**Phase 3 objective:** Remediate the remaining release-blocking defects in **outbound email reliability (GL-09)**, **PDPA consent and retention lifecycles (GL-10)**, **fail-closed encrypted backup recoverability (GL-11)**, and **strict input validation / administrative access boundaries (GL-13)**.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       PHASE 3 WORKSTREAM TOPOLOGY                                      │
├────────────────────────────────┬───────────────────────────────────────────────────────────────────────┤
│ Track 1: Email Dispatch (GL-09)│ Durable outbox state machine, atomic claims, provider error handling  │
├────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Track 2: Consent & PII (GL-10) │ 24h expiring tokens, scanner-safe POST confirm, suppression ledger    │
├────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Track 3: Security / IAM (GL-13)│ Strict primitive validation (no 500s), operator sessions, CORS DELETE │
├────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Track 4: Recovery (GL-11)      │ Fail-closed production backups, off-host strategy, restore suppression│
├────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Track 5: Read-Only Alternative │ Hard server-side route guards and UI feature withholding              │
├────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Track 6: Testing & Gates(GL-16)│ Fake provider fault-injection (4xx/5xx/timeout), full journey suites  │
└────────────────────────────────┴───────────────────────────────────────────────────────────────────────┘
```

---

## 2. Workstream Details & Technical Specifications

### Track 1: Resilient Email Delivery & Provider Error Handling (GL-09)
**Goal:** Eliminate false delivery confirmations, isolate provider failures, implement durable atomic delivery claims, and prevent premature cooldown suppression.

#### Technical Diagnosis
1. **Unchecked Provider Result Objects:**
   - Resend Node SDK returns `{ data, error }` instead of throwing on HTTP 4xx/5xx responses.
   - `server/index.js` and `server/scripts/send-weekly-newsletter.js` historically did not unpack `error`, treating failed responses as HTTP 200 successes to the caller.
   - When a newsletter email is rejected, `last_newsletter_sent_at` was prematurely updated in the database, locking the user out of retries for 6 days.
2. **Missing Outbox & State Machine:**
   - Email dispatch currently executes as an uncoordinated in-memory loop. If a worker crashes or restarts mid-batch, send progress is partially lost or duplicated.
   - Provider acceptance (`data.id`) is treated as final delivery without handling bounces, complaints, or transient rate limits.
3. **Insecure Fallback in Production:**
   - When `RESEND_API_KEY` is missing in production, the application must not fall back to logging usable confirmation URLs in application logs or displaying false success messages to users.

#### Target Architecture & Implementation
1. **Migration 014: Email Outbox & Delivery State Ledger (`server/migrations/014_email_outbox_and_delivery_states.js`):**
   ```sql
   CREATE TABLE IF NOT EXISTS email_outbox (
     id TEXT PRIMARY KEY,
     recipient TEXT NOT NULL,
     subject TEXT NOT NULL,
     email_type TEXT NOT NULL CHECK(email_type IN ('newsletter_confirmation', 'newsletter_digest', 'agent_lead_notification')),
     payload_json TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'accepted', 'failed', 'suppressed', 'bounced')),
     idempotency_key TEXT UNIQUE NOT NULL,
     provider_message_id TEXT,
     attempts INTEGER DEFAULT 0,
     max_attempts INTEGER DEFAULT 3,
     next_retry_at DATETIME,
     claimed_by TEXT,
     claimed_at DATETIME,
     last_error TEXT,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );

   CREATE INDEX IF NOT EXISTS idx_email_outbox_dispatch 
     ON email_outbox(status, next_retry_at) 
     WHERE status IN ('pending', 'failed');
   ```

2. **Durable Atomic Dispatch Protocol (`server/utils/emailQueue.js`):**
   - **Enqueue:** Any request to send email inserts a row with `status = 'pending'`, calculating `idempotency_key = sha256(recipient + email_type + context_date_or_token)`.
   - **Atomic Lease Acquisition:**
     ```javascript
     // Acquire pending emails using SQLite transaction with exclusive worker lease
     await withTransaction(conn, async () => {
       const available = await conn.all(`
         SELECT id FROM email_outbox
         WHERE status IN ('pending', 'failed')
           AND attempts < max_attempts
           AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now'))
         LIMIT ?
       `, [batchSize]);
       
       for (const item of available) {
         await conn.run(`
           UPDATE email_outbox
           SET status = 'claimed',
               claimed_by = ?,
               claimed_at = datetime('now'),
               updated_at = datetime('now')
           WHERE id = ? AND status IN ('pending', 'failed')
         `, [workerId, item.id]);
       }
     });
     ```
   - **Result Handling & State Machine:**
     - **Success (Provider Accepted):** If `data?.id` is returned without error, transition to `status = 'accepted'`, record `provider_message_id = data.id`, and update `leads.last_newsletter_sent_at = CURRENT_TIMESTAMP` (ONLY upon verified provider acceptance).
     - **Transient Failure (429 Rate Limit, 500/502/503/504 Provider Outage):** Increment `attempts`, set `status = 'failed'`, compute exponential backoff (`next_retry_at = datetime('now', '+' || (2 ^ attempts) || ' minutes')`), record `last_error`.
     - **Permanent Failure (422 Unprocessable, Invalid Email, Rejected Domain):** Set `status = 'suppressed'`, log failure, do not retry.
3. **Fail-Closed Production Provider Guards (`server/utils/emailAdapter.js`):**
   - When `NODE_ENV === 'production'` and `RELEASE_SCOPE === 'full'`:
     - If `RESEND_API_KEY` or `SENDER_EMAIL` is missing/empty, immediately return `{ data: null, error: { statusCode: 503, message: 'Production email dispatch is disabled: RESEND_API_KEY is not configured.' } }`.
     - NEVER print raw confirmation URLs to `console.log` in production.
     - Return honest user-facing HTTP 503 error: `"Email verification service is temporarily unavailable. Please try again later."`

---

### Track 2: PDPA Consent Lifecycle, Expiring Tokens & Suppression Ledger (GL-10)
**Goal:** Prevent automated bot confirmations, enforce token expiration, maintain auditable consent provenance, quarantine unverified legacy subscribers, and ensure cross-restore suppression enforcement.

#### Technical Diagnosis
1. **Vulnerability to Automated Link Scanners:**
   - `GET /api/newsletter/confirm` immediately confirmed subscriptions upon HTTP GET. Automated corporate link checkers, email previewers, and antivirus crawlers (e.g., Microsoft SafeLinks, Google Web Risk) request all links in incoming emails, confirming subscriptions without user intention.
2. **Infinite Token Lifetime:**
   - Confirmation tokens have no expiration timestamp in the database (`confirmation_token` stored indefinitely). Tokens generated a year prior remain valid.
3. **Lack of Suppression Check on Re-registration:**
   - When a user unsubscribes or is anonymized to `HASH:<sha256>`, subsequent submissions to `/api/leads/submit` did not check whether the hash was present on the suppression ledger, allowing re-enrolment without consent re-affirmation.
4. **Restoration Regression Risk:**
   - Restoring a previous database backup would overwrite recent unsubscribes and erasures, causing opted-out users to receive emails again unless an external suppression ledger is consulted.
5. **Aged vs. Converted Lead Retention:**
   - The retention purge previously deleted all agent advisory leads older than 12 months without checking whether they had converted into active clients requiring statutory record preservation (e.g., 5 years under Singapore commercial requirements).

#### Target Architecture & Implementation
1. **Scanner-Safe, Expiring Confirmation Workflow:**
   - Add `confirmation_token_expires_at DATETIME` to `leads` table.
   - Set expiration window to **24 hours** from issuance (`datetime('now', '+24 hours')`).
   - Split confirmation into safe GET and mutative POST:
     - `GET /api/newsletter/confirm?email=...&token=...`:
       - Validates token presence and expiration (`datetime('now') <= confirmation_token_expires_at`).
       - Renders an interactive confirmation web page with a single **"Confirm Subscription"** button.
       - **Does NOT mutate database state or confirm subscription.** Link scanners crawling the URL will only inspect the HTML page.
     - `POST /api/newsletter/confirm`:
       - Body contains `{ email, token }`.
       - Validates token against database; if valid and unexpired, executes atomic confirmation:
         ```sql
         UPDATE leads
         SET confirmed_at = CURRENT_TIMESTAMP,
             unsubscribed_at = NULL,
             confirmation_token = NULL,
             confirmation_token_expires_at = NULL,
             consent_version = '2026-v1.0'
         WHERE email = ? AND confirmation_token = ? AND datetime('now') <= confirmation_token_expires_at;
         ```
       - Single-use guarantee: Token is cleared (`NULL`) upon first use; subsequent replays return HTTP 403.
2. **Dedicated Suppression Ledger (`server/migrations/015_suppression_ledger.js`):**
   ```sql
   CREATE TABLE IF NOT EXISTS email_suppression (
     email_hash TEXT PRIMARY KEY,
     masked_email TEXT NOT NULL,
     reason TEXT NOT NULL CHECK(reason IN ('unsubscribed', 'bounced', 'complaint', 'erased', 'manual')),
     suppressed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     source_version TEXT NOT NULL
   );
   ```
   - **Consulted at All Intake Boundaries:**
     - `validateLeadSubmission`: Checks `sha256(cleanEmail)` against `email_suppression`. If present, rejects submission with HTTP 409 Conflict: `"This email address has been unsubscribed or suppressed. To resubscribe, please contact support."`
     - URA or external data imports: Suppressed emails are strictly excluded.
     - Outbox dispatch worker: Pre-send filter skips any address matching `email_suppression`.
3. **Legacy Subscriber Quarantine Protocol:**
   - Identify legacy leads in `property.db` that were marked `confirmed_at` by Migration 007 without explicit audit records.
   - Add `is_quarantined INTEGER DEFAULT 0` and `quarantined_reason TEXT` to `leads`.
   - Quarantine contacts lacking verified double opt-in timestamps: they are excluded from weekly dispatches until they complete re-confirmation.
4. **Differentiated PDPA Retention Rules (`server/scripts/cleanup-leads.js`):**
   - Add `is_converted INTEGER DEFAULT 0` and `converted_at DATETIME` to `leads`.
   - **Retention Schedule:**
     - Unconfirmed newsletter leads > 30 days: **Purged permanently**.
     - Unconverted agent advisory leads (`is_converted = 0`) > 12 months: **Purged permanently**.
     - Converted agent advisory leads (`is_converted = 1`): **Retained up to 5 years** for commercial audit compliance, then anonymized.
     - Unsubscribed newsletter leads > 90 days: **PII erased**, email hash inserted into `email_suppression`.

---

### Track 3: Strict Input Validation Schemas & Admin Boundary Hardening (GL-13)
**Goal:** Prevent unhandled HTTP 500 crashes from malformed inputs, establish an attributable operator administrative boundary, and fix production cross-origin headers.

#### Technical Diagnosis
1. **Type Coercion & Crash on Non-String Inputs:**
   - Passing an object as `name` (e.g. `{"name": {}}`) bypassed `typeof name === 'string' && name.length > 100`, subsequent `.trim()` triggered `TypeError: name.trim is not a function`, producing HTTP 500.
   - Passing an array as `dateFrom` or a decimal/fractional `limit` (e.g. `1.5`) produced unhandled SQL/engine crashes.
2. **Indefinite Shared Admin Key Exposure:**
   - `requireAdmin` accepts the raw `X-Admin-Key` header on all administrative endpoints indefinitely. There is no operator attribution, rotation, or session revocation mechanism.
3. **Incomplete CORS Configuration:**
   - Production CORS specifies `methods: ['GET', 'POST']`. It does NOT permit `DELETE` (required for `/api/admin/leads/:id` right-to-erasure), and omits custom request headers (`X-Admin-Session`, `X-Admin-Key`), breaking preflight `OPTIONS` requests from separate admin origins.

#### Target Implementation
1. **Strict Input Validation Middleware (`server/utils/validation.js`):**
   - Implement primitive type assertion helpers:
     ```javascript
     function isNonEmptyString(val, maxLen) {
       return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
     }
     function isValidInteger(val, min, max) {
       const num = Number(val);
       return Number.isInteger(num) && num >= min && num <= max;
     }
     ```
   - **`validateLeadSubmission` Schema Enforcement:**
     - If `name` is present, it MUST be of type `string` and length <= 100. If `typeof name !== 'string'`, return HTTP 400 (`"Name must be a string."`).
     - `email` MUST be a primitive `string` and match `EMAIL_REGEX`.
     - `phone` MUST be a primitive `string` matching `SG_PHONE_REGEX` when required.
     - `pdpaConsent` MUST be strictly boolean `true` (`=== true`).
     - Any unrecognized object structure immediately returns HTTP 400 Bad Request, never HTTP 500.
   - **`validateFilters` Schema Enforcement:**
     - `dateFrom` and `dateTo`: MUST be primitive strings matching `YYYY-MM` or `YYYY-MM-DD`. Arrays and objects return 400.
     - `page`: MUST be a positive integer (`>= 1`).
     - `limit`: MUST be an integer between `1` and `100`. Fractional values (e.g. `1.5`) return HTTP 400.
2. **Attributable Admin Boundary & Session Management:**
   - Operator login for Sam Fraser:
     - `POST /api/admin/login` takes `ADMIN_API_KEY`, issues an HMAC-SHA256 session token with **2-hour expiry**.
     - Session payload format: `{ operator: 'sam.fraser', expiresAt: <epoch>, nonce: <uuid> }`.
     - Enforce `admin_audit_log` recording for every sensitive operation (CSV export, lead deletion, manual sync trigger):
       ```sql
       CREATE TABLE IF NOT EXISTS admin_audit_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         operator TEXT NOT NULL,
         action TEXT NOT NULL,
         target_id TEXT,
         ip_address TEXT,
         created_at DATETIME DEFAULT CURRENT_TIMESTAMP
       );
       ```
   - Session Revocation List (`admin_revoked_tokens` table) to support instantaneous token invalidation on secret rotation.
3. **CORS & Preflight Configuration (`server/index.js`):**
   ```javascript
   const allowedOrigins = process.env.ALLOWED_ORIGINS 
     ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) 
     : false;

   app.use(cors({
     origin: allowedOrigins,
     methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
     allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Admin-Session'],
     credentials: true
   }));
   ```

---

### Track 4: Authenticated Backups, Off-Host Strategy & Clean Recovery (GL-11)
**Goal:** Fail closed for unencrypted backups in production, establish separate key custody, define RPO/RTO parameters with the owner, and enforce suppression re-application upon restore.

#### Technical Diagnosis
1. **Optional Plaintext Fallback:**
   - `backup-db.js` previously wrote plaintext SQLite files if `BACKUP_ENCRYPTION_KEY` was missing. Production databases containing personal data must fail closed.
2. **Key Separation & Custody:**
   - Encryption keys must never reside in the backup volume or container image.
3. **Off-Host Replication Strategy:**
   - Backups stored only on the local droplet risk total loss if the droplet is destroyed. An automated off-host replication mechanism to a secondary provider (e.g. S3 / B2 / R2) is required for production.
4. **Restore Anomaly (Privacy Regression):**
   - Restoring a database from backup could inadvertently restore emails that were deleted or unsubscribed after the backup was taken.

#### Target Architecture & Implementation
1. **Fail-Closed Production Backup Rule (`server/scripts/backup-db.js`):**
   - In production, if neither `BACKUP_KEY_FILE` nor `BACKUP_ENCRYPTION_KEY` is present, `runBackup()` aborts immediately and logs an alert.
   - Encrypted format: AES-256-GCM `[12B IV][16B AuthTag][Ciphertext]`.
2. **Recovery Parameters (Agreed with Sam Fraser):**
   - **RPO (Recovery Point Objective):** 24 hours (daily backup captured at 04:00 SGT).
   - **RTO (Recovery Time Objective):** < 30 minutes from incident declaration to verified running service.
3. **Off-Host Replication Script (`server/scripts/replicate-backup-offsite.js`):**
   - Copies encrypted snapshot (`*.db.enc`) and SHA-256 manifest to an off-host cloud storage bucket or SSH target.
   - Encryption key is stored strictly on Sam Fraser's secure management system / secret manager, never on the off-host backup destination.
4. **Privacy Re-Synchronization Restore Hook (`server/scripts/restore-baseline.js`):**
   - When restoring a snapshot:
     1. Decrypt snapshot into an isolated target file.
     2. Verify SHA-256 hash against manifest.
     3. Verify `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
     4. **Re-apply Suppression & Erasure Ledger:** Query the external / replicated `email_suppression` table and ensure all hashes recorded after the backup date are applied to the restored database before it is swapped into service:
        ```sql
        UPDATE leads 
        SET unsubscribed_at = CURRENT_TIMESTAMP 
        WHERE email_hash IN (SELECT email_hash FROM restored_suppression);
        ```

---

### Track 5: Read-Only Release Alternative Scope Enforcement
**Goal:** Provide an airtight server-side disabling mechanism if the product owner elects to launch the analytics MVP prior to live email operational readiness.

#### Technical Implementation
1. **Server-Side Enforcement (`server/utils/releasePolicy.js`):**
   - When `RELEASE_SCOPE=analytics-readonly`:
     - `POST /api/leads/submit` returns HTTP 403 Forbidden: `{ error: 'Lead submission is disabled for read-only release.' }`.
     - `GET /api/newsletter/confirm` and `POST /api/newsletter/confirm` return HTTP 403 Forbidden.
     - All `/api/admin/*` routes return HTTP 403 Forbidden.
     - Background scheduled newsletter (`cron-weekly-newsletter`) exits immediately with `skipped`.
     - Direct newsletter script (`send-weekly-newsletter.js`) aborts execution before database queries.
2. **Client-Side Enforcement:**
   - `/api/features` broadcasts `{ leadCapture: false, outboundEmail: false }`.
   - Frontend suppresses all lead capture forms, advisory buttons, and newsletter dialogs.
3. **Data Protection Under Read-Only Scope:**
   - Existing personal data in `leads` remains protected under SQLite file permissions, encryption at rest, and admin disabling. Existing unsubscribes via HMAC link remain active to allow opt-out even during read-only mode.

---

### Track 6: Testing Harness, Fake-Provider Fault Injection & Exit Evidence (GL-16)
**Goal:** Deliver end-to-end regression test suites covering all Phase 3 failure modes on disposable databases with zero production side effects.

#### Test Suites to Implement
1. **`server/tests/phase3-email-resilience.test.js`:**
   - Provider simulation: Inject HTTP 422, 500, 504, and network timeout into fake transport.
   - Assert: the API returns truthful queued HTTP 202 only after durable intent is committed; invalid/unconfigured collection returns bounded 4xx/503. Provider errors set the worker outbox state to `failed`, schedule backoff and never advance provider-acceptance timestamps.
   - Concurrency: Two workers attempting to lease the same outbox item; assert exactly-one worker acquires the lock and dispatches.
2. **`server/tests/phase3-consent-lifecycle.test.js`:**
   - Expired token: Token created 25 hours ago returns 403 Expired.
   - Scanner test: HTTP GET to confirmation URL returns HTML page with button; database shows lead remains unconfirmed (`confirmed_at IS NULL`). Subsequent HTTP POST confirms lead.
   - Replay test: Subsequent POST with same token returns 403.
   - Suppression check: Submitting lead with email matching `email_suppression` returns 409 Conflict.
3. **`server/tests/phase3-security-boundary.test.js`:**
   - Fuzzing: Object-valued `name`, array `dateFrom`, fractional `limit = 1.5`, negative `page = -1` return 400 Bad Request; 0 unhandled 500 errors.
   - Admin authentication: Missing headers return 401; invalid session returns 401; unconfigured key returns 503; session expiration after 2 hours enforced; revoked session token rejected.
   - CORS: Preflight `OPTIONS` for `DELETE` method and `X-Admin-Session` header returns 204 with allowed headers.
4. **`server/tests/phase3-recovery-privacy.test.js`:**
   - Full backup, encryption, decryption, and hash verification drill on disposable database.
   - Privacy re-application: Simulate lead opt-out after backup; restore backup; verify privacy hook suppresses opted-out lead before allowing traffic.

---

## 3. Step-by-Step Implementation Roadmap

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             6-DAY PHASE 3 EXECUTION ROADMAP                              │
├───────┬──────────────────────────────────────────────────────────────────────────────────┤
│ Day 1 │ Track 1: Create Migration 014 (email_outbox) & emailQueue.js state machine        │
│       │ Track 1: Refactor server/utils/emailAdapter.js with fail-closed production checks│
├───────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Day 2 │ Track 1: Refactor send-weekly-newsletter.js to use durable outbox and claims      │
│       │ Track 6: Implement phase3-email-resilience.test.js with fault-injection harness  │
├───────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Day 3 │ Track 2: Create Migration 015 (email_suppression & expiring tokens)              │
│       │ Track 2: Implement 2-step scanner-safe GET/POST confirmation in server/index.js   │
│       │ Track 2: Add suppression checks to validateLeadSubmission and cleanupLeads       │
├───────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Day 4 │ Track 3: Implement strict schema validators in validation.js (prevent 500s)       │
│       │ Track 3: Implement operator session tokens, audit logging & CORS DELETE support  │
│       │ Track 6: Implement phase3-consent-lifecycle.test.js and security tests           │
├───────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Day 5 │ Track 4: Enforce fail-closed production backups and off-host replication script   │
│       │ Track 4: Build privacy re-synchronization hook in restore-baseline.js            │
│       │ Track 5: Verify server-side read-only scope enforcement routes                   │
├───────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Day 6 │ Track 6: Execute full exit gate qualification suite on Node 22 Linux image       │
│       │ Track 6: Complete Phase 3 Completion Report & present sign-off checklist to Sam  │
└───────┴──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Phase 3 Exit Gate Verification Matrix

| Gate ID | Governing Exit Criterion | Verification Method / Target Evidence | Success Threshold |
| :--- | :--- | :--- | :--- |
| **G3-1** | **Provider Error Handling** | Run fake-provider fault injection tests (422, 500, timeout) in `phase3-email-resilience.test.js` | 0 false successes; 0 premature cooldown updates; outbox records exponential backoff |
| **G3-2** | **Duplicate Worker Prevention** | 5 concurrent workers polling identical outbox queue in test harness | Exactly 1 dispatch per idempotency key; 0 duplicate sends |
| **G3-3** | **Expiring & Single-Use Tokens** | Verify 24h expired token and replayed token submissions | 100% rejection (HTTP 403); 0 unauthorized confirmations |
| **G3-4** | **Scanner-Safe Confirmation** | Execute HTTP GET request to confirmation endpoint | State remains `confirmed_at IS NULL`; POST required for confirmation |
| **G3-5** | **Suppression Enforcement** | Attempt lead submission with email present in `email_suppression` | HTTP 409 Conflict; lead submission blocked across signup and imports |
| **G3-6** | **Strict Validation Schemas** | Fuzz endpoint with object name, array date, fractional limit | 100% return bounded HTTP 400; **0 unhandled HTTP 500 errors** |
| **G3-7** | **Admin Boundary & Sessions** | Test missing credentials, expired session tokens, and CORS preflight | 401/403/503 enforced; preflight accepts DELETE & admin headers |
| **G3-8** | **Encrypted Recovery & Privacy** | Perform encrypted backup, decrypt into clean file, and run privacy reconciliation | SQLite integrity `ok`; FK check 0; post-backup opt-outs suppressed |
| **G3-9** | **Owner Notice & Privacy Approval** | Sam Fraser reviews actual privacy notices, CEA partner identity, and retention rules | Attributable written approval recorded in repository |

---

## 5. Risk Assessment & Mitigation Playbook

| Risk Event | Severity | Probability | Mitigation Strategy | Rollback Action |
| :--- | :--- | :--- | :--- | :--- |
| **Email deliverability degradation / IP block** | High | Low | Enforce strict double opt-in, 1-click RFC 8058 unsubscribe header, and Resend domain verification before live dispatches. | Pause outbound email (`ENABLE_OUTBOUND_EMAIL=false`) and revert to read-only scope. |
| **Link scanner false confirmations** | High | Medium | Implement two-step flow: GET serves confirmation page, user must click button to issue POST. | De-confirm any lead confirmed solely via GET without session fingerprint. |
| **Accidental live email during staging** | High | Low | `sendEmail` adapter strictly requires `NODE_ENV=production` AND explicit `ENABLE_OUTBOUND_EMAIL=true`; mock adapter active in all other environments. | Hardcoded circuit-breaker in adapter prevents outbound socket connections in non-production environments. |
| **Restoration overwrites recent opt-outs** | Critical | Low | Restore script incorporates privacy re-synchronization hook applying external suppression ledger before service startup. | Run emergency suppression audit script across all leads. |

---

## 6. Document Approvals & Governance

- **Prepared By:** Backend & Platform Engineering Lead  
- **Accountable Reviewer:** Sam Fraser (Release Owner & Operational Contact)  
- **Current Status:** **Locally implemented; hosted evidence and owner approval pending**
