# Live operations setup checklist

Prepared 6 October 2026 for Singapore Home Intel (`homeintel.sg`).

Start with **analytics-only scope**. Lead collection, adviser introductions and outbound newsletters stay disabled. Account creation and DNS setup are preparation; public launch follows successful private deployment, recovery, monitoring and performance checks.

Complete steps 1–7 yourself, then provide the non-secret handoff at step 8. Steps 9–11 are engineering work we can complete together once the server is accessible. Step 12 prepares email/advisory features later.

## 1. Confirm the domain and organize account access

- [ ] Confirm that you own `homeintel.sg` and can edit its DNS. If you have not registered it, check availability with a registrar and register it before proceeding. Domain availability has not been verified here.
- [ ] Record the registrar and the company currently managing DNS; these may be different.
- [ ] Enable account recovery and multifactor authentication wherever offered. Save recovery codes in your password manager.
- [ ] Use accounts you control for hosting, backups, DNS and email. Review the dashboard's current charges before purchasing resources.

**Done when:** you can sign in and edit DNS, and you know where account recovery information is stored.

## 2. Create your DigitalOcean account and project

- [ ] Create a DigitalOcean account and configure billing.
- [ ] Enable multifactor authentication.
- [ ] Create a project named `HomeIntel`.
- [ ] Configure an account spending/billing alert if available.

**Done when:** the project is ready to create a server. [DigitalOcean's creation guide](https://docs.digitalocean.com/products/droplets/how-to/create/).

## 3. Create an SSH key on this Windows computer

An SSH key lets this computer sign in to the server. Its **public** file can be uploaded to DigitalOcean; the private file stays on your computer.

Open PowerShell. Use a new filename; if `homeintel_ed25519` already exists, reuse the existing key or choose a different filename rather than overwriting it.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\homeintel_ed25519" -C "homeintel-server"
```

Choose a passphrase and store it in your password manager. Display the public key:

```powershell
Get-Content "$env:USERPROFILE\.ssh\homeintel_ed25519.pub"
```

- [ ] Add that public key to your DigitalOcean account and name it `HomeIntel Windows`.
- [ ] Keep a recoverable, encrypted copy of the private key separately from the server.

**Done when:** DigitalOcean lists the public key. Do not paste the private key or passphrase into this chat. [DigitalOcean SSH-key instructions](https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/).

## 4. Create the Droplet

In DigitalOcean choose **Create → Droplet** and use:

| Setting | Starting choice |
|---|---|
| Region | Singapore, if available |
| Operating system | Ubuntu 24.04 LTS, 64-bit |
| CPU architecture | x86-64 / AMD64 |
| Size | Approximately 2 vCPUs and 4 GB RAM |
| Disk | At least 60 GB; a larger bundled disk is fine |
| Authentication | Your `HomeIntel Windows` SSH key |
| Name | `homeintel-prod-01` |
| Monitoring | Enable DigitalOcean monitoring |

This size is my starting recommendation for private qualification, not a proven capacity guarantee. Shared CPU performance varies; we will measure on the actual server before deciding whether it needs resizing. Review the price shown in the dashboard. Provider snapshots/backups are an optional extra layer; the independent backup account in step 6 remains required.

- [ ] Create the Droplet and record its public IPv4 address.
- [ ] Attach it to the `HomeIntel` project.

**Done when:** the server exists and its IP address is recorded. [DigitalOcean creation options](https://docs.digitalocean.com/products/droplets/how-to/create/).

## 5. Protect server access and confirm you can connect

- [ ] Create a DigitalOcean Cloud Firewall named `homeintel-firewall` and attach it to the Droplet.
- [ ] Initially allow inbound **TCP 22 (SSH) only from your current public IP address**. Leave web ports closed until the protected deployment is configured.
- [ ] Retain the standard outbound rules initially so the server can obtain updates and contact backup/alert services.
- [ ] If your home/office public IP changes, update the SSH rule through the DigitalOcean dashboard.

Connect from PowerShell, replacing `SERVER_IP` with the actual address:

```powershell
ssh -i "$env:USERPROFILE\.ssh\homeintel_ed25519" root@SERVER_IP
```

For the first connection, check the host-key fingerprint through DigitalOcean's console before accepting it. Type `exit` to return to your computer after checking access.

Before deployment we will create a named administrator account, verify its access and configure updates and SSH restrictions. Ports **80 and 443** will be opened for the HTTPS proxy at that stage, with private access controls during testing. Application port **3001** stays internal; never open it to the internet.

**Done when:** you can connect and the firewall is attached. [DigitalOcean firewall rules](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/).

## 6. Set up independent backup storage

My suggested starting choice is **Backblaze B2 Cloud Storage**, using an account separate from DigitalOcean. The application already supports S3-compatible backup storage; another compatible provider is possible if you prefer it.

- [ ] Create the backup account, configure billing and enable multifactor authentication.
- [ ] Create a **private** bucket, for example `homeintel-backups-UNIQUE-SUFFIX`.
- [ ] Create a standard application key restricted to this bucket and the prefix `homeintel/`.
- [ ] Give that key the permissions needed to upload, download, list and delete objects under the prefix. Download is required for verification; deletion is used by the application's retention process.
- [ ] Save the key ID and secret in your password manager. Use a restricted standard key, rather than the account's master key.
- [ ] Record the bucket name, region and S3 endpoint shown by the provider.
- [ ] Keep recovery-account access separately recoverable if the Droplet is lost.

We will generate the separate backup encryption key during configuration and store a recovery copy outside the Droplet. The initial backup retention is 30 days. Provider version retention and lifecycle settings need review too; do not apply a shorter automatic deletion policy or assume deleting an object removes all historical versions.

**Done when:** the private bucket and restricted key exist. [B2 buckets](https://www.backblaze.com/docs/cloud-storage-buckets), [application keys](https://www.backblaze.com/docs/cloud-storage-application-keys).

## 7. Prepare DNS and an alert destination

At your existing DNS provider, prepare these records. Keep existing mail/verification records intact.

| Type | Name | Value |
|---|---|---|
| A | `@` / `homeintel.sg` | Droplet IPv4 address |
| A | `staging` | Droplet IPv4 address |
| CNAME, optional | `www` | `homeintel.sg` |

We will use `staging.homeintel.sg` for protected testing first, and configure the main domain/optional `www` deliberately at launch. DNS alone does not configure the application's hostname or redirects. Start with DNS-only routing if your provider offers a proxy switch, and check that conflicting A/AAAA records do not route users to another server. Avoid changing nameservers solely for this project if your existing DNS provider works.

- [ ] Record the DNS provider and completed records.
- [ ] Name the incident owner: initially you, plus a backup person if available.
- [ ] Choose an alert channel you check promptly.

For application alerts, the existing transport supports an HTTPS incoming webhook. If you already use Slack, create a private `homeintel-alerts` channel and an incoming webhook for it, then save the URL privately. We can select another compatible transport if you do not use Slack. A webhook URL is a secret. [Slack's setup instructions](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

**Selected approach (7 October):** The owner uses email, not Slack. Prepare UptimeRobot for independent website-availability emails. Internal backup/disk/job alerts use the separately configured Resend operational-email transport in the Phase 4 runbook. Resend setup is needed for those alerts even while customer email stays disabled. Keep any UptimeRobot heartbeat/notification URL separate from the application failure-message destination.

Also choose an external uptime monitor, hosted separately from the Droplet. We will configure it after protected HTTPS is ready. It must detect an unavailable server even when the server cannot send its own alert.

**Done when:** DNS records, incident owner and alert destination are identified. [DNS record instructions](https://docs.digitalocean.com/products/networking/dns/how-to/manage-records/).

## 8. Send me this setup handoff

Share the following **non-secret** information:

```text
Domain and DNS provider:
DigitalOcean Droplet name:
Droplet public IP:
Ubuntu version / CPU / RAM / disk:
SSH connection from this computer works: yes/no
SSH public-key name and local key-file path:
Backup provider / bucket name / region / S3 endpoint:
Restricted backup credentials saved privately: yes/no
Incident owner and chosen alert channel:
Alert webhook saved privately: yes/no
Initial launch scope: analytics only
```

Do not include passwords, private keys, API-key secrets, encryption keys, webhook URLs or recovery codes. We will put secrets into private runtime configuration during the next session, outside Git and the image.

**This is the first handoff point. You do not need to configure Docker or deploy the application unaided.**

## 9. Configure and deploy privately together

Once access works, the engineering setup will:

- [ ] Configure the administrator account, updates and Docker Engine/Compose. [Official Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/).
- [ ] Build from the current passing source commit and record the new image digest. Historical image evidence does not automatically qualify a rebuild.
- [ ] Configure persistent database, backup and privacy directories and the application user's permissions.
- [ ] Create private runtime secrets and configure the independent backup destination.
- [ ] Deploy a market-only database with no real contact records for initial analytics-only qualification. Preserve the original database and privacy history separately; do not blindly upload the existing live database or copy a running SQLite main file without its WAL.
- [ ] Initialize the required privacy ledger consistently for the deployment's data; existing contacts/suppression history require their real history, not an empty replacement.
- [ ] Keep collection, outbound email, cleanup and general source sync disabled initially.
- [ ] Configure HTTPS and a temporary private testing boundary before opening web ports. The current public Caddy configuration alone does not make staging private.

The deployed scope stays `analytics-readonly`. Backups and monitoring run in the explicit maintenance service after their configuration is verified. Private administrative access is configured separately when needed.

## 10. Prove operations work

- [ ] HTTPS, certificate renewal configuration, private access and internal backend-port restrictions pass.
- [ ] Database readiness and actual market periods are correct; restarts preserve data.
- [ ] An encrypted backup uploads to the independent account, downloads successfully and restores on a clean temporary server using separately held keys.
- [ ] Recovery meets the plan's maximum 24-hour data-loss window and under-30-minute recovery target.
- [ ] The operator receives deliberate failure alerts. A provider's accepted webhook response is not sufficient proof of receipt.
- [ ] External uptime monitoring detects loss of the server.
- [ ] Actual scheduled monitoring/backups run on the host; persisted results and overlap/restart behavior are checked.
- [ ] Performance and a sustained workload pass on this actual host; outstanding broad cold queries remain visible until resolved.
- [ ] Application and data rollback are rehearsed with privacy state preserved where applicable.

A daily backup bucket does not provide the synchronous independent privacy-event replica required by the current full-feature implementation. Before any real contacts are brought into service or consent/withdrawal features are enabled, we must configure and failure-test an independently durable replica that meets the application's append/fsync behavior. An ordinary second local folder or unverified object-storage mount does not establish that protection.

## 11. Approve the small initial launch

- [ ] Review the release checklist, current commit/image identity and open findings.
- [ ] Confirm the rollback owner, triggers and initial audience.
- [ ] Remove the temporary public-site restriction only after release approval; private administrator controls remain.
- [ ] Observe the small launch before expanding traffic.

Account setup and a green CI run do not complete this release review. The [Phase 3 closeout checklist](PHASE_3_RELEASE_CLOSEOUT_CHECKLIST.md) and [Phase 4 report](PHASE_4_QUALIFICATION_REPORT_2026-10-06.md) remain the gate records.

## 12. Prepare email and adviser features later

This can be deferred while launching analytics only.

- [ ] Create a Resend account and add the actual sending domain. Add the exact verification records shown in its dashboard and wait for verification. Review SPF/DKIM/DMARC with the chosen mailbox provider; preserve existing receiving-mail records. [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction).
- [ ] Create a domain-restricted sending API key and save it privately. [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction).
- [ ] Arrange working receiving mailboxes or forwarding for `contact@homeintel.sg` and `dpo@homeintel.sg`; send to them from another account and confirm someone receives the messages. Verifying a sending domain alone does not establish those inboxes.
- [ ] Choose an explicitly authorized test email address. We will configure delivery/bounce/complaint webhooks and test signup, confirmation, digest and unsubscribe before enabling live sends.
- [ ] Confirm the adviser's identity, registration, exact recipient and the arrangement for handling enquiries. Review the actual sharing/retention notice and approve it before introductions are enabled.
- [ ] Complete the independent privacy replica and the applicable owner approvals before real lead collection.

An informal adviser relationship does not prevent preparing these accounts. It remains an open approval/configuration gate for collecting and forwarding real enquiries.
