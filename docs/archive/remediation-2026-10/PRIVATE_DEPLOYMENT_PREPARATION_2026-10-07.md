# Private deployment preparation — 7 October 2026

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


**Subsequent execution:** SSH access, server-local deployment, independent encrypted backup and separate-computer recovery are now verified in [the private deployment status](PRIVATE_DEPLOYMENT_STATUS_2026-10-07.md). Preparation notes below retain the earlier access/configuration state; public HTTPS, operator email and cold-filter capacity remain open.

The owner has provisioned a Singapore DigitalOcean Droplet (2 vCPUs, 4 GB RAM, 80 GB disk), configured Namecheap DNS, prepared a private Backblaze backup bucket and chosen email alerts with UptimeRobot. No deployment or live-provider success is claimed yet. The server's Ubuntu version and installed software require SSH inspection.

## Current access and dependencies

- Owner's interactive SSH works. The agent's non-interactive connection has not authenticated; Windows SSH agent was found stopped/disabled. Load the encrypted private key locally after starting the agent. Never share its passphrase or private contents in chat.
- Backblaze credentials are in an owner-held text file. Its path is needed for private configuration; do not place it inside the repository. Verify exact bucket region/endpoint, least-privilege permissions and encrypted upload/download before enabling scheduled backup.
- The operator supplied an alert email privately. Keep the actual mailbox in private runtime configuration rather than source documentation.
- Resend is not set up. Internal email alerts therefore remain unconfigured; UptimeRobot's independent availability email does not replace backup/disk/job failure alerts.

## Local preparation

Operator-only email support is implemented in the operational alert boundary, with a separate API key, fixed sender/recipient, provider message-ID validation, stable idempotency keys and bounded request timeout. Customer/adviser/newsletter sending stays disabled in analytics-only scope. Existing webhook support remains available. The regression suite passes 262/262 on Windows; hosted tests, provider receipt and Linux/image qualification remain separate requirements.

`Caddyfile.staging.example` provides a password-protected pre-launch proxy and strips the administrative gateway header. It is a configuration template, not an active site. Runtime credentials and hashes must be generated privately; the standard public Caddyfile does not itself protect staging.

## Deployment order once access is available

1. Inspect OS, disk, packages, SSH and firewall state without changing existing services.
2. Configure a named operator account and Docker/Compose, confirming access before changing root/password policies.
3. Prepare persistent private directories, generated runtime secrets, independent encrypted backup credentials and a reconciled privacy ledger.
4. Build a fresh source candidate and qualify startup/production configuration in the actual runtime.
5. Upload only a market-only initial dataset; preserve the original database and privacy history. Real contact records are excluded from the analytics-only private pilot.
6. Configure protected staging HTTPS before opening web ports. Port 3001 remains internal. Verify public admin containment and private access.
7. Qualify readiness, restart, actual-host performance, independent backup/clean-host recovery and application/data rollback.
8. Configure Resend for fixed-recipient operator alerts, observe real scheduled runs and prove operator receipt. Configure authenticated external uptime probes without weakening staging access.

Public launch and real lead collection remain gated by the canonical release checklists. This preparation does not publish a service or change the live local database.
