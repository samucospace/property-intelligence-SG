# Complete Live Deployment & Email Setup Guide: Singapore Home Intel

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**Current state, 2 October 2026:** local-only project, not live. Sam requires every identified issue to be fixed and verified before public launch. The infrastructure/domain/provider details below are a proposed deployment guide, not verified live configuration. Phase 0 now defaults to read-only/no-mail containment; use [the current runbook](PHASE_0_OPERATIONS_RUNBOOK.md) and keep its guards enabled. Do not follow legacy rebuild/sync/email enablement steps until their governing remediation gates pass.

**Backup work deferred to private deployment:** enable daily DigitalOcean Droplet backups and automate encrypted SQLite copies to a separate cloud provider/account, with separate key custody. Validate whole-server and clean-environment database restores and backup-failure alerts before public launch. The local backup schedule below alone does not satisfy off-host recovery. Provider uptime commitments do not replace these checks. Configuration and hosted verification remain pending; see the [deployment-stage backup strategy](PHASE_0_OPERATIONS_RUNBOOK.md#deployment-stage-backup-strategy-deferred-not-live).

**Target Domain:** `homeintel.sg`  
**Host Platform:** DigitalOcean (Ubuntu 24.04 LTS Droplet in Singapore `SGP1`)  
**Domain Registrar & DNS:** Namecheap  
**Email Inbound:** Namecheap Free Email Forwarding  
**Email Outbound:** Resend (100% Free Plan)  
**Security & TLS:** Caddy (Automated Let's Encrypt SSL)  

---

## Overview & Master Pre-Flight Checklist

Before you begin, ensure you have:
- [ ] Your **Namecheap account** credentials (where `homeintel.sg` is registered).
- [ ] A **DigitalOcean account** ([digitalocean.com](https://www.digitalocean.com/)).
- [ ] A **Resend account** ([resend.com](https://resend.com/) — free, no credit card required).
- [ ] Your **URA Data Service Access Key** from [developer.gov.sg](https://developer.gov.sg).
- [ ] Your appointed CEA agent's email address (for receiving buyer/seller advisory leads).

---

## Phase 1: Free Inbound Email Forwarding (Namecheap)

*Purpose: Ensure `dpo@homeintel.sg`, `contact@homeintel.sg`, and `sponsor@homeintel.sg` forward directly to your personal email inbox (e.g. your Gmail) for free.*

1. Log into your [Namecheap Dashboard](https://www.namecheap.com/).
2. On the left sidebar, click **Domain List**.
3. Locate **`homeintel.sg`** and click the **Manage** button on the right.
4. On the main **Domain** tab, scroll down to the section titled **Redirect Email**.
5. Click **Add Forwarder** and configure the following rules:

| Alias | Forward to | Purpose |
| :--- | :--- | :--- |
| **`dpo`** | `yourpersonal@gmail.com` | **Legal PDPA Requirement** for privacy & data deletion requests |
| **`contact`** | `yourpersonal@gmail.com` | General user questions & partnership inquiries |
| **`sponsor`** | `yourpersonal@gmail.com` | Newsletter advertising & commercial inquiries |
| **`*`** *(Catch-all)* | `yourpersonal@gmail.com` | *(Optional)* Forwards any other `@homeintel.sg` email address |

6. Click the **green checkmark (✓)** or **Save Changes** button after each entry.
7. **Test it immediately:** From a different email account (like a secondary email or phone), send a test email to `dpo@homeintel.sg` and confirm it lands in your personal inbox.

---

## Phase 2: Free Outbound Email Sending (Resend)

*Purpose: Allows the Node server to send double opt-in confirmation links and automated weekly investor briefings without landing in spam.*

### 1. Sign Up & Add Domain
1. Go to [resend.com](https://resend.com/) and create a free account.
2. In the Resend dashboard, click **Domains** (left sidebar) ➔ **Add Domain**.
3. Enter: `homeintel.sg`.
4. Region: Choose **Singapore** (or the closest available region).
5. Click **Add**.

### 2. Add Resend Verification DNS Records to Namecheap
Resend will present 3 DNS records:
* **DKIM (TXT record):** Proves cryptographic authenticity.
* **SPF (MX or TXT record):** Authorizes Resend as an approved sender.
* **DMARC (TXT record):** Defines anti-spoofing policy.

In your **Namecheap Dashboard**:
1. Go to **Domain List** ➔ **Manage** (next to `homeintel.sg`) ➔ Click the **Advanced DNS** tab at the top.
2. In the **Host Records** section, click **Add New Record** for each of the 3 records from Resend:

| Record Type | Host | Value / Target | TTL |
| :--- | :--- | :--- | :--- |
| **TXT Record** | `resend._domainkey` | *(Paste the long DKIM string from Resend)* | Automatic |
| **TXT Record** *(or MX)* | `bounces` *(or `@` per Resend)* | `feedback-smtp.resend.com` *(or string given)* | Automatic |
| **TXT Record** | `_dmarc` | `v=DMARC1; p=none;` | Automatic |

3. Save each record in Namecheap.
4. Back in the Resend dashboard, click **Verify DNS Records**.
5. Once DNS propagates (usually 1 to 5 minutes), the domain status will show a green **Verified** badge.

### 3. Generate Resend API Key
1. In Resend, click **API Keys** on the left menu.
2. Click **Create API Key**.
3. Name it: `Singapore Home Intel Production`.
4. Permission: **Full access** (default).
5. Click **Add**.
6. **Copy the API key** (it starts with `re_...`) and save it securely—you will need it in Phase 6.

---

## Phase 3: Create DigitalOcean Droplet

1. Log into your [DigitalOcean Control Panel](https://cloud.digitalocean.com/).
2. In the top-right corner, click **Create** ➔ **Droplets**.
3. Configure the Droplet:
   - **Region:** **Singapore (`SGP1`)** *(Critical for single-digit millisecond latency to URA Data Service, OneMap, and local users)*.
   - **Datacenter:** Default (e.g. SGP1).
   - **OS Image:** **Ubuntu 24.04 (LTS) x64**.
   - **Droplet Type:** **Basic** ➔ **Regular CPU**.
   - **CPU & RAM:** **2 GB RAM / 1 vCPU / 50 GB NVMe SSD** ($12/month) or **2 GB / 2 vCPU** ($18/month).  
     *(Do not select 1 GB RAM, as compiling the React frontend in Docker requires ~1.2 GB memory)*.
   - **Authentication:** Select **SSH Key** (recommended) or choose **Password** and set a strong root password.
   - **Hostname:** `homeintel-prod` (or leave default).
4. Click **Create Droplet**.
5. Once created (takes ~45 seconds), copy the **IPv4 Address** of your new Droplet (e.g. `128.199.xxx.xxx`).

---

## Phase 4: Point Domain to DigitalOcean Droplet

1. Go back to your **Namecheap Dashboard**.
2. Go to **Domain List** ➔ **Manage** (for `homeintel.sg`) ➔ **Advanced DNS** tab.
3. In the **Host Records** table:
   - Find the existing **A Record** with Host `@` (currently pointing to Namecheap's parking IP `162.255.119.172`).
   - Change the **IP Address / Value** to your **DigitalOcean Droplet IP** (e.g. `128.199.xxx.xxx`).
   - Find or click **Add New Record** for the `www` subdomain:
     - **Type:** `A Record`
     - **Host:** `www`
     - **Value:** `<YOUR_DROPLET_IP>`
     - **TTL:** `Automatic` (or 5 min).
4. Click the green checkmark to save all changes.

---

## Phase 5: Server Hardening & Docker Installation

1. Open your terminal (PowerShell, Command Prompt, or Terminal) and SSH into your Droplet:
   ```bash
   ssh root@<YOUR_DROPLET_IP>
   ```

2. Update packages and install Docker and firewall tools:
   ```bash
   # 1. Update Ubuntu packages
   apt update && apt upgrade -y

   # 2. Install Docker, Docker Compose Plugin, and Git
   apt install -y docker.io docker-compose-plugin git ufw

   # 3. Configure Firewall (UFW)
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow 22/tcp    # SSH
   ufw allow 80/tcp    # HTTP (Let's Encrypt SSL challenges)
   ufw allow 443/tcp   # HTTPS
   ufw --force enable
   ```
   *(Port `3001` is deliberately not opened to the public—it is routed internally through Caddy over HTTPS).*

---

## Phase 6: Deploy Code & Transfer Verified Database

1. On the Droplet, clone the repository to `/opt/homeintel`:
   ```bash
   git clone https://github.com/samucospace/property-intelligence-SG.git /opt/homeintel
   cd /opt/homeintel

   # Create the host data directory for SQLite persistence
   mkdir -p data
   ```

2. **From your local Windows computer** (open a separate PowerShell window), copy your verified 582,000-record SQLite database to the Droplet:
   ```powershell
   scp c:\Dev\my-property-SG\server\property.db root@<YOUR_DROPLET_IP>:/opt/homeintel/data/property.db
   ```
   *(Transfer takes ~15–30 seconds for the ~148 MB file).*

3. On the Droplet, verify that the database arrived cleanly:
   ```bash
   ls -lh /opt/homeintel/data/property.db
   # Expected output: ~148M property.db
   ```

---

## Phase 7: Configure Production Environment (`.env`)

On the Droplet inside `/opt/homeintel`:
```bash
nano .env
```

Paste the following production configuration:

```ini
# Domain & Edge Reverse Proxy
DOMAIN=homeintel.sg
BASE_URL=https://homeintel.sg
ALLOWED_ORIGIN=https://homeintel.sg
NODE_ENV=production
PORT=3001
TZ=Asia/Singapore

# Security Secrets (Must be 32+ characters each)
# Run `openssl rand -hex 24` in terminal to generate unique keys
ADMIN_API_KEY=replace_with_a_secure_32_character_admin_key_here
UNSUBSCRIBE_SECRET=replace_with_a_secure_32_character_unsub_secret_here
BACKUP_ENCRYPTION_KEY=replace_with_a_secure_passphrase_for_backups_here

# Upstream Integrations
URA_ACCESS_KEY=your_official_ura_access_key_from_developer_gov_sg
RESEND_API_KEY=re_your_live_resend_api_key_from_phase_2
SENDER_EMAIL=Singapore Home Intel <digest@homeintel.sg>
NEWSLETTER_FROM_EMAIL=Singapore Home Intel <digest@homeintel.sg>
AGENT_NOTIFICATION_EMAIL=your_appointed_agent_email@agency.com.sg

# Persistent SQLite Storage Mount
DB_PATH=/app/data/property.db
BACKUP_DIR=/app/data/backups
BACKUP_RETENTION_DAYS=30
```

*To save in nano: Press `Ctrl+O`, press `Enter`, then press `Ctrl+X`.*

---

## Phase 8: Launch the Live Application Stack

On the Droplet inside `/opt/homeintel`:
```bash
docker compose up -d --build
```

### What happens automatically:
1. The locked multi-stage build compiles the frontend and creates a Node 22.23.3 runtime.
2. Docker runs one web process with init/restart supervision. No maintenance jobs start on web deployment.
3. Caddy provisions TLS for the configured domain and routes traffic to the web application.
4. The separate scheduler is opt-in through the maintenance profile, after its gates/configuration pass. See [Phase 1 operations](PHASE_1_OPERATIONS_RUNBOOK.md).

---

## Phase 9: Post-Launch Live Verification Checklist

Run these quick checks on the Droplet to confirm 100% production readiness:

### 1. Check Container Health
```bash
docker compose ps
```
*Result: Both `app` and `caddy` should display `Up (healthy)`.*

### 2. Verify maintenance separation
Use `docker compose ps` and `docker compose logs --tail=100 scheduler` after explicitly enabling the maintenance profile. Web-only deployment must not create a scheduler container or execute maintenance. Verify durable due-slot behavior with fake jobs before authorizing real provider operations.

### 3. Check Deep API Health Check
```bash
curl -i https://homeintel.sg/api/health
```
*Result:*
```json
HTTP/2 200
{"status":"ok","db":"connected","timestamp":"2026-..."}
```

### 4. Test Website in Browser
- Open **[https://homeintel.sg](https://homeintel.sg)** in your browser.
- Verify the green padlock (HTTPS active).
- Verify the Leaflet map clusters load and pan smoothly.
- Search for a condo (e.g. `The Sail`, `Reflections at Keppel Bay`) and confirm transaction prices and charts load instantly (< 35ms).

### 5. Test Live Email Dispatch (Dry Run)
Verify newsletter generation without sending emails:
```bash
docker compose exec app node server/scripts/send-weekly-newsletter.js --preview
```
*Result: Successfully generates `newsletter-preview.html` with top yields and MAS SORA rates.*

---

## Phase 10: Day-2 Operations & Useful Commands

| Action | Command to Run on Droplet |
| :--- | :--- |
| **View Live Web Traffic Logs** | `docker compose logs -f --tail=50 app` |
| **View Caddy SSL / Proxy Logs** | `docker compose logs -f caddy` |
| **Check Container Memory / CPU** | `docker stats` |
| **Run Immediate Manual Backup** | `docker compose exec -T scheduler node server/scheduler.js --now=cron-db-backup` |
| **Run Immediate URA Data Sync** | `docker compose exec -T scheduler node server/scheduler.js --now=cron-ura-sync` |
| **Update App After Git Push** | `git pull origin main && docker compose up -d --build` |
| **Restart Application Stack** | `docker compose restart` |
