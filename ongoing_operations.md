# Singapore Home Intel: Ongoing Operations & Maintenance Runbook

**Current operating override, 2 October 2026:** the project is local and remains NO-GO. [The Phase 0 runbook](PHASE_0_OPERATIONS_RUNBOOK.md) supersedes any conflicting rebuild, cleanup, sync or email instructions below. Sam Fraser is release owner and operational contact. Hosted operations and off-host transfer are not yet verified.

**Application:** Singapore Home Intel (`property-intelligence-sg` / `homeintel.sg`)
**Target Environment:** Production Linux VPS (Ubuntu 24.04 LTS / Docker Compose; separate maintenance profile)
**Document Version:** 2.0.0 (Production Live)
**Date:** October 2026

---

## 1. Operational Model: Automated vs. Manual Responsibility Matrix

To keep the platform reliable, performant, and compliant with minimal overhead, Singapore Home Intel separates operations into an **autonomous core (~85% automated)** and **human operator oversight (~15% manual/reactive)**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   OPERATIONAL WORKLOAD BREAKDOWN                       │
├──────────────────────────────────────┬─────────────────────────────────┤
│ 🟢 Automated (Hands-Off) ~85%        │ 🔴 Manual & Reactive ~15%       │
├──────────────────────────────────────┼─────────────────────────────────┤
│ • Daily AES-256-GCM Backups & Prune  │ • Offsite Cloud S3 Replication  │
│ • Weekly URA Caveat & Rental Sync    │ • Annual URA Access Key Renewal │
│ • Weekly Median Benchmark Refresh    │ • DPO Mailbox Compliance        │
│ • Weekly Investor Newsletter Dispatch│ • Right-to-Erasure Requests     │
│ • Monthly PDPA Retention Purges      │ • Domain DNS & Deliverability   │
│ • Automatic TLS / SSL Renewals       │ • Advisory Lead Follow-up       │
│ • Process Self-Healing & Restarts    │ • Quarterly Restore Drills      │
└──────────────────────────────────────┴─────────────────────────────────┘
```

---

### Detailed Operational Division

#### Category A: Planned automated operations
These are planned schedules, not verified live operations. The opt-in Compose scheduler uses Asia/Singapore and durable slot claims; web deployment starts no maintenance. Keep disabled features contained and follow [the current Phase 1 runbook](PHASE_1_OPERATIONS_RUNBOOK.md).

| Operational Task | Cadence | Execution Mechanism | Automated Behavior |
| :--- | :--- | :--- | :--- |
| **Hot Database Backup** | **Daily** (04:00 SGT) | `cron-db-backup` (`backup-db.js`) | Executes non-blocking SQLite `VACUUM INTO`, verifies file health with `PRAGMA integrity_check`, encrypts with authenticated AES-256-GCM, and deletes local snapshots older than 30 days. |
| **Official URA Market Sync** | **Weekly** (Sun 02:00 SGT) | `cron-ura-sync` (`sync-ura.js`) | Exchanges token, fetches 4 sales batches + rental quarters, validates every requested scope before committing non-destructive additive imports, and recalculates 24-month rolling median benchmarks. |
| **Investor Newsletter** | **Weekly** (Mon 08:00 SGT) | `cron-weekly-newsletter` (`send-weekly-newsletter.js`) | Queries top yields, builds sanitized HTML, filters confirmed active subscribers, throttles dispatches (150ms delay) via Resend, and tracks send state to prevent duplicate emails. |
| **PDPA Retention Purge** | **Monthly** (1st at 03:00 SGT) | `cron-leads-cleanup` (`cleanup-leads.js`) | Purges unconfirmed signups > 30 days, purges unconverted advisory leads > 12 months, and replaces emails of unsubscribed users (> 90 days) with SHA-256 suppression hashes. |
| **SSL / HTTPS Certificates** | **Continuous** | Caddy Reverse Proxy | Obtains, configures, and auto-renews Let's Encrypt / ZeroSSL TLS certificates with zero downtime. |
| **Process Crash Recovery** | **Continuous** | Docker restart policy | Restarts terminated web/scheduler containers; no PM2 memory-limit guarantee is claimed. |
| **Sitemap Regeneration** | **On Demand** | Dynamic Route (`/sitemap.xml`) | Generates live XML sitemaps referencing 5,900+ developments with current `<lastmod>` timestamps directly from SQLite. |

---

#### 🟡 Category B: Reactive / Event-Triggered (Semi-Automated)
These workflows run automatically when an event occurs, requiring minimal human action:

| Event Trigger | Automated Component | Operator / Human Action Required |
| :--- | :--- | :--- |
| **Advisory Lead Submission** | System verifies SG phone regex, validates PDPA consent, traps bot honeypots, logs to SQLite, and sends instant lead alert via Resend. | Appointed CEA real estate salesperson receives email and follows up with the client. |
| **PDPA Right-to-Erasure Request** | Automated admin API endpoint `DELETE /api/admin/leads/:id` permanently scrubs the lead record. | Operator receives request at `dpo@homeintel.sg` and runs a single cURL deletion command (SOP 3). |
| **Upstream URA Outage** | Outbound requests retry 3 times with exponential backoff (`ING-01`). | If URA suffers a multi-day weekend gateway outage, operator executes manual sync (SOP 1) once URA restores service. |

---

#### 🔴 Category C: Strictly Manual Operator Responsibilities
These represent external infrastructure, third-party licensing, and governance tasks that cannot be performed inside the codebase:

| Responsibility | Recommended Frequency | Procedure & Action Required |
| :--- | :--- | :--- |
| **Offsite Cloud Backup Replication** | Daily or Weekly | Local snapshots in `./data/backups/*.enc` protect against app crashes, but not host VPS destruction. Operator sets up an external tool (`rclone`, AWS S3 CLI, or Cloudflare R2 bucket) to copy encrypted backups offsite. |
| **URA Developer API Key Renewal** | **Annual** | URA developer access keys require renewal on `developer.gov.sg`. Operator must verify key validity once a year. |
| **DPO Compliance Mailbox Monitoring** | **Ongoing** | Ensure incoming emails to `dpo@homeintel.sg` are monitored or forwarded to maintain compliance with Singapore PDPA regulations. |
| **Domain DNS & Email Deliverability** | **Initial Setup / As Needed** | Configure apex domain A records, and verify SPF (`include:resend.com`), DKIM, and DMARC on nameservers so newsletters land in user inboxes. |
| **Disaster Recovery Drill** | **Quarterly** | Test-decrypting a backup file on a local computer to verify that data can be restored in an emergency (SOP 5). |
| **Commercial CEA Partner Agreement** | **Ongoing** | Ensure commercial agreement with designated licensed partner (ERA Realty Network Pte Ltd / Lic: L3002382K) remains active. |

---

## 2. Routine Operational Schedules

All background schedules are configured in `ecosystem.config.cjs` using `TZ=Asia/Singapore` in fork mode.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     RECURRING OPERATIONAL SCHEDULE                       │
├──────────────┬──────────────────┬───────────────────┬────────────────────┤
│ Cadence      │ Time (SGT)       │ Target Process    │ Mode               │
├──────────────┼──────────────────┼───────────────────┼────────────────────┤
│ Daily        │ 04:00 SGT        │ cron-db-backup    │ 🟡 Planned │
│ Weekly (Sun) │ 02:00 SGT        │ cron-ura-sync     │ 🟡 Planned │
│ Weekly (Mon) │ 08:00 SGT        │ cron-weekly-news  │ 🟡 Planned │
│ Monthly (1st)│ 03:00 SGT        │ cron-leads-clean  │ 🟡 Planned │
│ Quarterly    │ Scheduled        │ Restore Drill     │ 🔴 Manual Operator │
└──────────────┴──────────────────┴───────────────────┴────────────────────┘
```

### Daily Operations [🟢 Automated]
- **04:00 SGT — Online SQLite Backup (`backup-db.js`):**
  - Executes non-blocking hot snapshot using SQLite `VACUUM INTO`.
  - Verifies snapshot integrity via `PRAGMA integrity_check`.
  - Automatically encrypts snapshot using authenticated **AES-256-GCM** if `BACKUP_ENCRYPTION_KEY` is configured.
  - Automatically prunes local snapshots older than 30 days (`BACKUP_RETENTION_DAYS`).
  - *Operator Check:* Ensure host disk utilization on `./data` does not exceed 80%.

### Weekly Operations [🟢 Automated]
- **Sunday 02:00 SGT — Official URA Data Ingestion (`sync-ura.js`):**
  - Obtains fresh 24-hour daily token from URA Data Service.
  - Fetches Batches 1 to 4 for private residential sales.
  - Fetches rental contract quarters from `21q1` through current quarter.
  - Applies atomic replace-by-period transactions and deduplication.
  - Automatically recalculates rolling 24-month medians in `project_benchmarks`.
  - *Operator Check:* Monitor logs to confirm URA returned HTTP 200 and sales/rental batches committed cleanly.

- **Monday 08:00 SGT — Investor Property Briefing Newsletter (`send-weekly-newsletter.js`):**
  - Extracts top 5 gross rental yield condominiums and latest caveat transactions.
  - Fetches confirmed, active subscribers (`confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`).
  - Filters out recipients who received an email in the prior 6 days.
  - Sanitizes dynamic strings with `escapeHtml` to prevent email injection.
  - Sends emails via Resend with 150ms throttling delay between recipients.
  - Attaches RFC 8058 1-click unsubscribe headers.
  - *Operator Check:* Check Resend dashboard for deliverability, bounces, and complaint rates.

### Monthly Operations [🟢 Automated]
- **1st of Every Month 03:00 SGT — PDPA Retention Cleanup (`cleanup-leads.js`):**
  - Purges unconverted agent advisory enquiries older than 12 months.
  - Purges unconfirmed newsletter subscriptions older than 30 days.
  - Anonymizes unsubscribed newsletter leads older than 90 days (wipes personal details and stores SHA-256 suppression hash `HASH:<hash>`).
  - *Operator Check:* Verify log outputs to confirm count of purged/anonymized records.

### Quarterly Maintenance [🔴 Manual Operator Tasks]
1. **Disaster Recovery Drill:** Perform a test restoration of an encrypted backup file to a staging instance or local machine (see SOP 5).
2. **Database Vacuuming & Optimization:** Run `PRAGMA optimize;` during scheduled maintenance to update SQLite query planner statistics.
3. **Dependency Vulnerability Scan:** Run `npm audit` across root, server, and client, upgrading dependencies as necessary.
4. **URA API Key Renewal:** Verify that the registered URA Data Service developer access key on `developer.gov.sg` has not expired.

---

## 3. Environment & Configuration Checklist

Ensure `server/.env` contains the required production parameters:

```ini
# Production Server Core
NODE_ENV=production
PORT=3001
TZ=Asia/Singapore
BASE_URL=https://homeintel.sg
ALLOWED_ORIGIN=https://homeintel.sg
DB_PATH=/app/data/property.db

# Security & Authentication (Required: Min 32 Characters)
ADMIN_API_KEY=your_secure_random_32_character_admin_key_here
UNSUBSCRIBE_SECRET=your_secure_random_32_character_unsub_secret_here
BACKUP_ENCRYPTION_KEY=your_secure_backup_encryption_passphrase_here

# Upstream Integrations
URA_ACCESS_KEY=your_official_ura_data_service_access_key
RESEND_API_KEY=re_your_live_resend_api_key_here
SENDER_EMAIL=Singapore Home Intel <digest@homeintel.sg>
AGENT_NOTIFICATION_EMAIL=leads@youragency.com.sg

# Backup Configuration
BACKUP_DIR=/app/data/backups
BACKUP_RETENTION_DAYS=30
```

> [!CAUTION]
> Never commit `server/.env` or production SQLite backup files to version control.

---

## 4. Monitoring, Health Checks & Process Management

### 1. Application Deep Health Check [🟢 Automated Monitoring Target]
The application exposes an automated health endpoint:
```bash
curl -i https://homeintel.sg/api/health
```
- **Healthy (HTTP 200):** `{"status":"ok","db":"connected","timestamp":"..."}`
- **Unhealthy (HTTP 503):** `{"status":"unhealthy","error":"Database check failed"}`
- *Action:* Configure an external monitoring service (e.g. Uptime Kuma, Pingdom, Better Uptime) to ping `/api/health` every 60 seconds and alert the engineering team on HTTP 503 or timeout.

### 2. Process management (Docker)
Use `docker compose ps`, `docker compose logs --tail=100 app`, `docker compose logs --tail=100 scheduler` and `docker stats`. Start maintenance only through the explicitly approved profile. PM2 ecosystem files are legacy references; PM2 is not installed in the release image.

### 3. Caddy Reverse Proxy Logs & TLS
```bash
# Check Caddy logs and automatic HTTPS certificate renewals
docker compose logs -f caddy
```

---

## 5. Standard Operating Procedures (SOPs)

### SOP 1: Manual URA Caveat Synchronization [🟡 Reactive / Operator Initiated]
Use this procedure if the automated Sunday sync failed or if URA released an ad-hoc data update.

1. **Verify URA API Access Key:**
   Ensure `URA_ACCESS_KEY` is present in `server/.env`.
2. **Execute Ingestion:**
   ```bash
   # On Docker:
   docker compose exec app node server/scripts/sync-ura.js

   # On bare VPS:
   node server/scripts/sync-ura.js
   ```
3. **Verify Output:**
   Confirm console reports `Real URA Data Import complete: X sales, Y rentals` and `[Benchmarks] Project benchmarks successfully updated`.

---

### SOP 2: Executing Clean Database Rebuild (Plan 2.7) [🔴 Manual Maintenance]
Use this procedure if database schema migrations require a clean-slate rebuild or if data corruption occurs.

> [!WARNING]
> This procedure performs a database file swap. The web server must be stopped before running to prevent SQLite file descriptor lockups (RES-01).

1. **Stop Application Web Server:**
   ```bash
   # On bare VPS:
   docker compose --profile maintenance stop scheduler app

   # On Docker:
   docker compose stop app
   ```
2. **Execute Clean Rebuild:**
   ```bash
   # Preserves existing leads, fetches fresh URA caveats, seeds amenities, and calculates medians:
   node server/scripts/rebuild-clean-db.js
   ```
3. **Restart Application Web Server:**
   ```bash
   # On bare VPS:
   docker compose up -d app

   # On Docker:
   docker compose start app
   ```
4. **Validate Live Health:**
   ```bash
   curl -i http://localhost:3001/api/health
   ```

---

### SOP 3: Handling PDPA Right-to-Erasure Requests [🟡 Reactive / On Demand]
Under Singapore PDPA Section 25 and GDPR Article 17, individuals may request permanent erasure of their personal data.

1. **Locate Lead ID:**
   ```bash
   # Log in as admin and retrieve lead ID via API:
   curl -s -H "X-Admin-Key: <ADMIN_API_KEY>" https://homeintel.sg/api/admin/leads | grep "user@example.com"
   ```
2. **Execute Permanent Deletion:**
   ```bash
   curl -X DELETE -H "X-Admin-Key: <ADMIN_API_KEY>" https://homeintel.sg/api/admin/leads/<LEAD_ID>
   ```
3. **Verify Deletion:**
   Response returns `{"status":"success","message":"Lead <ID> permanently erased."}`.

---

### SOP 4: Newsletter Preview & Safe Dispatch Verification [🟡 Pre-Dispatch Check]
Before sending a newsletter manually or testing email templates:

1. **Generate Local HTML Preview:**
   ```bash
   node server/scripts/send-weekly-newsletter.js --preview
   ```
2. **Inspect Template:**
   Open `server/scripts/newsletter-preview.html` in any web browser to verify formatting, SORA benchmark rates, top yield values, and unsubscribe links.
3. **Perform Live Dispatch:**
   ```bash
   node server/scripts/send-weekly-newsletter.js
   ```

---

### SOP 5: Database Backup & Restoration from Encrypted Snapshot [🔴 Operator Recovery]

#### Creating a Manual Encrypted Backup:
```bash
node server/scripts/backup-db.js
```
The script will output the snapshot path:
`✓ Created verified SQLite backup snapshot: server/backups/property-backup-YYYYMMDD-HHmmss.db`
If `BACKUP_ENCRYPTION_KEY` is set:
`✓ Authenticated AES-256-GCM encrypted backup created: server/backups/property-backup-YYYYMMDD-HHmmss.db.enc`

#### Restoring from an Encrypted Backup:
1. **Stop Application:**
   `docker compose --profile maintenance stop scheduler app`
2. **Decrypt Backup File:**
   Create a small script or use Node REPL:
   ```javascript
   import { decryptFile } from './server/scripts/backup-db.js';
   await decryptFile('server/backups/property-backup-20260930-203754.db.enc', 'server/restored.db', process.env.BACKUP_ENCRYPTION_KEY);
   ```
3. **Verify Integrity of Decrypted File:**
   ```bash
   sqlite3 server/restored.db "PRAGMA integrity_check;"
   # Expected output: ok
   ```
4. **Deploy Decrypted File:**
   ```bash
   mv server/property.db server/property.db.bak
   mv server/restored.db server/property.db
   docker compose up -d app
   ```

---

## 6. Incident Response & Troubleshooting Runbooks

### Incident 1: URA Data Service Sync Fails (HTTP 401 / 502 / 504)
- **Symptom:** `cron-ura-sync` logs error `Request failed with status code 401` or `ETIMEDOUT`.
- **Diagnosis:**
  - If 401: `URA_ACCESS_KEY` has expired or is invalid. Log in to `developer.gov.sg` to regenerate the key.
  - If 502/504: Government gateway downtime or maintenance. `fetchWithRetry` automatically retries 3 times with exponential backoff.
- **Recovery:** Once upstream service is restored, run manual sync (SOP 1).

### Incident 2: SQLite Database Locked (`SQLITE_BUSY`)
- **Symptom:** `/api/health` returns HTTP 503; API endpoints return `SqliteError: database is locked`.
- **Diagnosis:** A long-running write operation or stalled transaction has locked SQLite.
- **Recovery:**
  1. Inspect running queries: check container logs for unclosed transactions.
  2. The application configures `PRAGMA busy_timeout = 5000` and WAL mode, allowing concurrent reads alongside writes.
  3. If persistent, restart application: `docker compose restart app`.

### Incident 3: Resend Email Rate Limiting (HTTP 429) or Delivery Failure
- **Symptom:** `Failed to send to user@example.sg: Too Many Requests`.
- **Diagnosis:** Exceeded Resend account tier rate limits (standard tier: 2–10 req/sec).
- **Recovery:**
  - The script implements a 150ms delay per email (~6.6 req/sec) and send-state tracking.
  - Re-running `node server/scripts/send-weekly-newsletter.js` resumes safely, automatically skipping recipients who already received the email.

### Incident 4: High Event Loop Latency or Memory Spike
- **Symptom:** Response times exceed 1 second; container monitoring reports high memory use.
- **Diagnosis:**
  - Unbounded query filter parameter explosion bypassing cache.
  - Bounded LRU cache automatically evicts oldest entries at 50 items.
- **Recovery:**
  - Check active network queries for denial-of-service attempts.
  - Confirm Caddy / Cloudflare rate limiting is active at the edge.

---

## 7. Legal, Regulatory & Commercial Compliance

1. **Singapore Open Data Licence:**
   Ensure all user-facing footers and exported reports maintain accurate attribution:
   *Contains information from the Urban Redevelopment Authority (URA) Data Service and Singapore Land Authority (SLA) OneMap accessed under the terms of the Singapore Open Data Licence.*
2. **CEA Estate Agents Act Disclosures:**
   The application must never represent itself as a licensed estate agency. The advisory banner must state that advisory consultations are fulfilled by licensed salespersons (ERA Realty Network Pte Ltd / Lic: L3002382K).
3. **Singapore PDPA Affirmative Consent:**
   Lead submission checkboxes must remain **unticked by default**. Automated retention scripts (`cleanup-leads.js`) must run monthly to prevent illegal indefinite PII retention.
4. **Data Protection Officer (DPO):**
   Ensure email sent to `dpo@homeintel.sg` is forwarded to the designated compliance officer.
