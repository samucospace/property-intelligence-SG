# Phase 0 Scope, Governance & Ownership Charter

**Document Date:** 2 October 2026  
**Governing Plan:** \`GO_LIVE_REMEDIATION_PLAN_2026-10-02.md\` (Phase 0, Task 5)  
**Status:** **APPROVED & BASELINED**  

---

## 1. Product Release Scope Decision

The project steering committee evaluated two release scope models:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RELEASE SCOPE DECISION MATRIX                        │
├────────────────────────────────────┬────────────────────────────────────┤
│ Option A: Full Product Release     │ Option B: Phased Read-Only MVP     │
├────────────────────────────────────┼────────────────────────────────────┤
│ • Lead submission & Agent alerts   │ • Interactive condo map & search   │
│ • Double opt-in newsletter system  │ • 584k URA sales & rental explorer │
│ • PDPA consent & retention storage │ • Median yield & valuation engines │
│ • Full Resend email delivery engine│ • Zero lead capture / Zero PII     │
│ ⚠️ Scope: 20–35 engineering days   │ 🟢 Scope: Fast-track release       │
└────────────────────────────────────┴────────────────────────────────────┘
```

### Adopted Decision: **Option B (Phased Read-Only Analytics MVP First, Phase 3 Email Fast-Follow)**
1. **Initial Public Target:** Deliver the core real estate transaction engine, interactive map, price benchmarks, and rental yields as a secure, high-performance read-only analytics platform.
2. **Personal Data Safeguard:** By decoupling lead capture and newsletter dispatching during the initial launch, the system eliminates immediate PDPA/spam-deliverability risk while dataset reconciliation (Phase 2) and startup concurrency (Phase 1) are executed.
3. **Phase 3 Evolution:** Full double opt-in newsletter and agent advisory lead pipelines will be enabled only after completing the strict Resend `{data, error}` handling and consent lifecycle verification defined in Phase 3.

---

## 2. Feature Provenance & Disclosure Scope (Livability & SORA)

Per Findings **GL-07** and **GL-08**:

### A. Livability Scoring Engine
* **Current State:** 399 amenities are tagged `seed`; 200 projects rely on approximate district-centre coordinates.
* **Scope Decision:** 
  * Retain livability calculations in the analytics engine, but **quarantine approximate coordinates** from receiving precise scores (flagged as *"Location approximate — score withheld"*).
  * Update UI copy to clearly state *"Estimated straight-line proximity (Seed dataset)"* rather than claiming *"Verified walking distances"*.

### B. SORA Interest Rate & Mortgage Modeling
* **Current State:** SORA rates (1-month 2.40%, 3-month 2.44%) are hardcoded benchmark rates up to September 2026.
* **Scope Decision:**
  * Retain SORA rate display for net rental yield calculations with explicit labeling: *"Benchmark: MAS SORA (September 2026 Reference)"*.
  * Remove destructive hardcoded truncation in `server/ingestion.js` during Phase 1.

---

## 3. Accountable Governance & RACI Roles

To ensure every phase gate is strictly enforced without ambiguity, the following roles are established:

| Role Title | Accountable Owner | Focus Areas & Deliverables | Sign-Off Responsibilities |
| :--- | :--- | :--- | :--- |
| **Release Owner** | Engineering / Product Lead | Overall release readiness, schedule, budget, gate approvals | Final Production Go-Live Decision |
| **Platform & Concurrency Lead** | Backend / DevOps Engineer | Phase 1 (Startup, SQLite lock contention, scheduler) & Phase 4 (Load tests, Docker) | Phase 1 & Phase 4 Exit Gates |
| **Data & Analytics Engineer** | Data Engineer | Phase 2 (Saint/Street normalization, 35 duplicate groups, yield harmonization) | Phase 2 Dataset Reconciliation Gate |
| **Security & Operations Contact** | Operations / DPO Lead | Phase 0 (Baseline, quarantine) & Phase 3 (AES backups, PDPA compliance mailbox) | Phase 0 & Phase 3 Exit Gates |

---

## 4. Phase 0 Exit Gate Sign-Off Record

All Phase 0 containment and baseline gates have been executed:

- [x] **G0-1: Rebuild script quarantined:** `server/scripts/rebuild-clean-db.js` hard-aborts with code 1.
- [x] **G0-2: PM2 deployment decoupled:** Cron jobs isolated into `ecosystem.maintenance.config.cjs`.
- [x] **G0-3: Startup lead purge gated:** `ENABLE_STARTUP_LEAD_CLEANUP` defaults to false.
- [x] **G0-4: Baseline recovery verified:** VACUUM snapshot encrypted with AES-256-GCM; isolated restore drill passed with 100% row match (584,140 transactions).
- [x] **G0-5: Git baseline tagged:** Git tag `baseline-phase-0-start` created.
- [x] **G0-6: Staging environment isolated:** `staging-property.db` created; `emailAdapter.js` mock transport implemented.
- [x] **G0-7: Operational inventory published:** `OPERATIONAL_INVENTORY_2026-10-02.md` compiled without plaintext secrets.
- [x] **G0-8: Scope & Governance approved:** Phased Read-Only MVP chosen with assigned RACI owners.
