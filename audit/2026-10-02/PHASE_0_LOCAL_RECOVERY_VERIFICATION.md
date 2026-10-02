# Phase 0 durable local recovery verification — 2 October 2026

**Result: PASSED for local capture and fresh-process recovery. Off-host transfer remains pending hosted deployment.**

Owner/operator: Sam Fraser. Source is the current local `server/property.db`, opened read-only. Historical baseline files were retained unchanged.

## Artifacts

The first corrected capture was `baseline-2026-10-02T09-20-17-210Z-32eb9b99`. A second independent capture reused the saved key, confirming recoverability after the first capture process ended:

- Capture: `baseline-2026-10-02T09-30-14-029Z-42621156`, 2 October 2026, **17:30 SGT**.
- Encrypted database: `server/backups/baseline-2026-10-02T09-30-14-029Z-42621156/database.db.enc`.
- Manifest and source/build snapshot: that capture directory's `manifest.json` and `working-tree/`.
- Separate retained key: `.recovery-keys/phase0.key`. **No key value is included in this report.**
- Fresh-process restored database: `audit/recovery-drill/baseline-2026-10-02T09-30-14-029Z-42621156/restored.db`.

Both captures used unique directories; neither overwrote the historical October 2 baseline. Keys and backups are excluded from Git and container build context. The key folder's Windows permissions were verified after restricting inheritance: Sam's Windows account, the Codex sandbox account/group, SYSTEM and Administrators retain access; general Users/Authenticated Users do not.

## Full-snapshot validation

Restoration runs `restore-baseline.js` in a new Node process with only the encrypted file, retained key path, new output path and expected hash. It requires AES-GCM authentication before writing restored content, refuses existing output, then checks the entire snapshot SHA256, integrity and foreign keys.

- Snapshot and restored SHA256: `033e2ec6e5662779835c3e4ec4e2754008163b02408c399ea4128a931413a067`.
- Encrypted artifact SHA256: `39dd4a3e9025a214ca48e5939065b6bc54fdac08d8a626c4f351a63cd6cc2f65`.
- `PRAGMA integrity_check`: **ok**.
- Foreign-key violations: **0**.
- Every table count matched the captured snapshot. The two independent captures have the same snapshot hash, further supporting that the source data remained unchanged during this work.

| Table | Snapshot/restored rows |
|---|---:|
| projects | 5,903 |
| property_transactions | 133,418 |
| rental_transactions | 450,722 |
| project_benchmarks | 3,223 |
| amenities | 399 |
| sora_rates | 69 |
| leads | 0 |
| schema_migrations | 10 |
| seed_versions | 1 |
| schema_lock / job_locks / job_history | 0 each |

Transaction total: **584,140**. The source/build snapshot contains file hashes, runtime and Git HEAD, reflecting the working tree at capture time. Later remediation edits remain in the active checkout; this is a recoverable baseline, not a frozen release artifact.

## Failure and nonempty-state fixtures

`server/tests/phase0-containment.test.js` verifies a separate disposable source containing a contact and confirmation token. A new-process restore preserves that source state. Wrong-key authentication and output overwrite attempts fail; failed restored output is removed. Key files inside backup/restore directories are refused.

The full isolated suite passes **142/142 tests in 12 files** on Windows / Node v24.19.0. Backup source snapshots are excluded from test discovery so archived copies do not inflate test counts. Production backups fail before snapshot creation when encryption configuration is missing.

## Remaining deployment evidence

The project is currently local-only. Sam's machine is the intended off-host destination when external hosting exists. No actual hosted-to-local copy, different failure-domain restore, target-image qualification, RPO/RTO rehearsal or operator alert test is claimed here. Complete those original gates before public deployment, and retain the key independently of the hosted system and backup media.
