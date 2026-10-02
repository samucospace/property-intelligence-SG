# Baseline Recovery Rehearsal Drill Report

**Executed:** 2026-10-02T05:40:32.878Z  
**Drill Objective:** Prove consistent baseline capture and complete isolated restoration from encrypted backup (GL-11).  
**Outcome:** **PASSED (100% Exact Match)**  

## 1. Artifact Verification

| Item | Path | Size | Integrity Check |
| :--- | :--- | :--- | :--- |
| **Live Source** | `C:\Dev\my-property-SG\server\property.db` | 183.58 MB | ok |
| **Snapshot Baseline** | `C:\Dev\my-property-SG\server\backups\baseline-authoritative-20261002.db` | 148.86 MB | ok |
| **Encrypted Snapshot** | `C:\Dev\my-property-SG\server\backups\baseline-authoritative-20261002.db.enc` | 148.86 MB | AES-256-GCM (AuthTag Verified) |
| **Restored Isolated Copy** | `C:\Dev\my-property-SG\audit\recovery-drill\restored-baseline.db` | 148.86 MB | ok |

## 2. Table Row Count Reconciliation

| Table Name | Live Count | Baseline Snapshot | Restored Count | Status |
| :--- | :--- | :--- | :--- | :--- |
| **`projects`** | 5938 | 5938 | 5938 | ✅ Verified Match |
| **`property_transactions`** | 133418 | 133418 | 133418 | ✅ Verified Match |
| **`rental_transactions`** | 450722 | 450722 | 450722 | ✅ Verified Match |
| **`project_benchmarks`** | 3291 | 3291 | 3291 | ✅ Verified Match |
| **`amenities`** | 399 | 399 | 399 | ✅ Verified Match |
| **`sora_rates`** | 69 | 69 | 69 | ✅ Verified Match |
| **`leads`** | 0 | 0 | 0 | ✅ Verified Match |
| **`schema_migrations`** | 8 | 8 | 8 | ✅ Verified Match |

## 3. Foreign Key and Structural Integrity
- **Integrity Check:** `ok`
- **Foreign Key Violations:** `0`

The baseline recovery procedure proves that an encrypted backup can be successfully decrypted and restored in an isolated environment with zero data loss or structural anomalies.
