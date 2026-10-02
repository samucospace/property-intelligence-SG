# Operational & Environment Inventory — 2 October 2026

**Baseline Commit:** \`84a03b691b20ca372e3751e6eaeefdce03b38328\`  
**Baseline Git Tag:** \`baseline-phase-0-start\`  
**Context:** Phase 0 Inventory under \`GO_LIVE_REMEDIATION_PLAN_2026-10-02.md\` (Findings GL-03, GL-11).  
**Confidentiality Note:** Sensitive secret values are **not** stored in this inventory. Only presence, configuration scope, type, and source definitions are recorded.

---

## 1. Enabled Processes & Execution Mode

| Process Name | Entry Point | Target Runtime | Supervising Method | Phase 0 Status |
| :--- | :--- | :--- | :--- | :--- |
| **\`property-intelligence-sg\`** | \`server/index.js\` | Node v20 LTS / v24 local | PM2 (\`ecosystem.config.cjs\`) | **ACTIVE** (Isolated web service) |
| **\`cron-weekly-newsletter\`** | \`server/scripts/send-weekly-newsletter.js\` | Node v20 LTS / v24 local | Decoupled (\`ecosystem.maintenance.config.cjs\`) | **DECOUPLED / PAUSED** (Prevents deploy sends) |
| **\`cron-ura-sync\`** | \`server/scripts/sync-ura.js\` | Node v20 LTS / v24 local | Decoupled (\`ecosystem.maintenance.config.cjs\`) | **DECOUPLED / PAUSED** (Prevents deploy contention) |
| **\`cron-leads-cleanup\`** | \`server/scripts/cleanup-leads.js\` | Node v20 LTS / v24 local | Decoupled (\`ecosystem.maintenance.config.cjs\`) | **DECOUPLED / PAUSED** (Prevents deploy purge) |
| **\`cron-db-backup\`** | \`server/scripts/backup-db.js\` | Node v20 LTS / v24 local | Decoupled (\`ecosystem.maintenance.config.cjs\`) | **DECOUPLED / PAUSED** (Scheduled off-cycle) |
| **\`rebuild-clean-db\`** | \`server/scripts/rebuild-clean-db.js\` | Node v20 LTS / v24 local | Manual CLI | **QUARANTINED** (Hard abort on start) |

---

## 2. Recurring Operational Schedules

All background schedules are specified for Singapore Standard Time (\`TZ=Asia/Singapore\`):

| Job Name | Defined Cron Cadence | Intended Execution Time (SGT) | Operational Path |
| :--- | :--- | :--- | :--- |
| Weekly Market Digest | \`0 8 * * 1\` | Mondays at 08:00 SGT | \`ecosystem.maintenance.config.cjs\` |
| Weekly URA Caveat/Rental Sync | \`0 2 * * 0\` | Sundays at 02:00 SGT | \`ecosystem.maintenance.config.cjs\` |
| Monthly PDPA Lead Cleanup | \`0 3 1 * *\` | 1st of month at 03:00 SGT | \`ecosystem.maintenance.config.cjs\` |
| Daily SQLite Online Backup | \`0 4 * * *\` | Daily at 04:00 SGT | \`ecosystem.maintenance.config.cjs\` |

---

## 3. Environment Variables & Secret Configuration Audit

| Variable Name | Classification | Required? | Present Locally? | Target / Description |
| :--- | :--- | :--- | :--- | :--- |
| \`PORT\` | Infrastructure | Yes (Default 3001) | Yes (\`3001\`) | Express HTTP listen port |
| \`NODE_ENV\` | Runtime Config | Yes | Yes (\`development\` / \`production\`) | Node environment profile |
| \`DB_PATH\` | Storage Path | Yes | Yes (\`server/property.db\`) | SQLite database file location |
| \`TZ\` | Runtime Config | Recommended | Configured in PM2 (\`Asia/Singapore\`) | Timezone alignment for cron jobs |
| \`ADMIN_API_KEY\` | **Secret** | Yes | Configured in \`server/.env\` | Authorizes \`/api/admin/*\` and ingestion endpoints |
| \`UNSUBSCRIBE_SECRET\` | **Secret** | Yes | Configured in \`server/.env\` | HMAC-SHA256 signature key for lead unsubscribe links |
| \`LEGACY_UNSUB_UNTIL\` | Configuration | Optional | Configured in \`server/.env\` | Grace period cutoff for legacy SHA-256 tokens |
| \`URA_ACCESS_KEY\` | **Secret** | Required for sync | Configured in \`server/.env\` | URA Data Service developer API access token |
| \`URA_RENTAL_START\` | Configuration | Optional | Configured in \`server/.env\` (\`21q1\`) | Starting quarter for rental transaction ingestion |
| \`RESEND_API_KEY\` | **Secret** | Required for email | Configured in \`server/.env\` | Resend transactional email API key |
| \`NEWSLETTER_FROM_EMAIL\` | Email Config | Yes | Configured in \`server/.env\` | Outbound sender envelope address |
| \`SENDER_EMAIL\` | Email Config | Optional | Configured in compose | Notification sender address |
| \`AGENT_NOTIFICATION_EMAIL\` | Email Config | Optional | Configured in compose | Advisory lead recipient address |
| \`BASE_URL\` | Infrastructure | Yes | Configured in \`server/.env\` (\`https://homeintel.sg\`) | Public base URL for canonical links & double opt-in tokens |
| \`ALLOWED_ORIGIN\` | Security Policy | Optional | Optional in \`server/.env\` | Cross-origin resource sharing whitelist |
| \`BACKUP_ENCRYPTION_KEY\` | **Secret** | Required for secure backup | Configured in \`server/.env\` | 256-bit passphrase for AES-256-GCM backup encryption |
| \`ENABLE_STARTUP_LEAD_CLEANUP\` | Feature Guard | Optional | Default \`false\` | Prevents automatic lead deletion on web server startup |
| \`DOMAIN\` | Infrastructure | Yes (Caddy) | Injected via Docker Compose | Public domain for automated Caddy Let's Encrypt TLS |

---

## 4. Deployment Ports, Networking & Storage Architecture

### Networking & Routing
- **Public Entry Points:**
  - Port \`80\` (HTTP) ➔ Auto-redirected to HTTPS by Caddy reverse proxy.
  - Port \`443\` (HTTPS) ➔ Terminated by Caddy reverse proxy using TLS (Let's Encrypt / ZeroSSL).
- **Internal Service Routing:**
  - Port \`3001\` ➔ Bound by Express application server; proxied internally from Caddy via \`reverse_proxy app:3001\`.
  - Application sets \`trust proxy = 1\` to correctly extract client IP and protocols from Caddy.

### Storage & Persistence
- **Authoritative Database:**
  - Local path: \`server/property.db\` (183.58 MB uncompacted, 148.86 MB vacuumed).
  - Production Docker path: \`/app/data/property.db\` mapped via volume mount \`./data:/app/data\`.
  - Journal mode: \`WAL\` (Write-Ahead Logging) with \`PRAGMA busy_timeout = 5000\`.
- **Backup Storage:**
  - Local path: \`server/backups/\`.
  - Production Docker path: \`/app/data/backups/\`.
  - File format: \`property-backup-YYYYMMDD-HHmmss.db.enc\` (AES-256-GCM encrypted).

---

## 5. Domain, DNS & Email Architecture

### Inbound Email Setup (Namecheap Domain Forwarding)
- **Domain:** \`homeintel.sg\`
- **MX Records:** Handled by Namecheap Free Email Forwarding.
- **Aliases:**
  - \`dpo@homeintel.sg\` ➔ Forwards to personal DPO mailbox (PDPA compliance requirement).
  - \`contact@homeintel.sg\` ➔ Forwards to personal support mailbox.
  - \`sponsor@homeintel.sg\` ➔ Forwards to commercial inquiries.

### Outbound Email Setup (Resend)
- **Provider:** Resend API.
- **DKIM:** TXT record on \`resend._domainkey.homeintel.sg\`.
- **SPF:** TXT / MX record on \`bounces.homeintel.sg\` / \`feedback-smtp.resend.com\`.
- **DMARC:** TXT record on \`_dmarc.homeintel.sg\` (\`v=DMARC1; p=none;\`).
- **Sender Addresses:**
  - \`digest@homeintel.sg\` / \`Singapore Home Intel <digest@homeintel.sg>\` (Investor newsletters).
  - Transactional confirmation emails for double opt-in subscriber verification.
