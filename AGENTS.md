# Working on Singapore Home Intel

This file, [the product specification](docs/PRODUCT_SPEC.md), and [the operations guide](docs/OPERATIONS.md) are the three canonical project documents. Updated 8 October 2026.

## Read first

1. Read this file for working rules.
2. Read `docs/PRODUCT_SPEC.md` for approved behavior, metric definitions and coverage limits.
3. Read `docs/OPERATIONS.md` for deployment state, release gates and recovery procedures.

`README.md` is an entry point. `docs/research/` contains research plans, not approved requirements or findings. `docs/archive/` contains superseded plans and historical reports; `audit/` contains dated evidence. Neither a historical completion claim nor a passing old test run establishes current readiness. Archived commands are not current operating instructions.

If these documents disagree with the code or observed host state, investigate and report the discrepancy. Preserve approved product rules; do not silently redefine them to match a defect. Distinguish implemented, locally tested, observed on the host and approved for release. Cite the observation date.

## Scope and authority

- Sam Fraser owns release, incident response and product/privacy approvals. Public launch remains NO-GO. The current deployment is protected staging with analytics-only scope.
- Keep `RELEASE_SCOPE=analytics-readonly`. Lead collection, adviser referrals, newsletters, outbound customer email, source sync and cleanup remain disabled. Server-side containment must remain effective even if the client is bypassed.
- The adviser relationship is informal. Do not enable collection/referral features or invent a partner agreement, recipient, consent, processor approval or legal notice approval.
- Routine reversible fixes and verification within the user's authorized task can proceed. Changing approved metrics or budgets, destructive identity/source decisions, real communications, enabling gated features or public release requires the relevant explicit owner authorization. Existing session authorization persists.

## Implementation and verification

- Supported release runtime is Node **22.23.3**, matching root/server/client engine requirements and Docker. Use existing lockfiles and scripts; inspect the current implementation before relying on old reports.
- Application code lives in `client/` and `server/`. SQLite migrations own schema evolution; app and maintenance scheduler are separate processes. Preserve migration history, operational state and privacy history.
- Use isolated disk fixtures or a newly prepared staging database for tests. Never run profiling, failure drills, migrations or startup qualification against the operational database. The staging preparation helper adds synthetic contacts; it is not a zero-contact deployment export.
- Verify changes with relevant regression tests and the client build when appropriate. For deployment changes, verify the exact image, runtime, readiness, proxy containment and recovery requirements. Documentation-only changes need link/reference checks, not an application redeployment.
- Optimization must preserve complete-market arithmetic, all applicable filters, stable pagination, null/coverage semantics and the approved gross-yield contract. Do not weaken thresholds to make measurements pass.
- Approximate locations must not acquire precise amenity claims or distance rings. Keep amenities hidden initially and preserve the distinction between inspecting a map feature and filtering analytics.
- Record source commit and image identity separately: documentation commits can follow the source commit built into the deployed image. Do not claim that remote CI, staging or a host is current without evidence.

## Data, secrets and recovery

- Never commit `.env`, credentials, keys, databases, privacy ledgers, raw provider captures or personal contact data. Keep existing ignore rules; do not force-add ignored internal reviews. Do not print secret values during diagnosis.
- `audit/**/*.json` are preserved byte-for-byte under `.gitattributes`. Keep dated evidence immutable; add new evidence rather than editing old results to suggest a pass.
- General rebuild and scheduled source replacement remain quarantined. The approved 5 October snapshot/35 identity decisions are specific historical approvals, not blanket authorization to merge/delete/import later data.
- Use consistent SQLite snapshots and authenticated encrypted backups, with recovery keys held separately. Do not copy a live main database without its WAL or remove recovery/maintenance journals to bypass safeguards.
- Before any database replacement, stop writes, drain traffic, preserve a verified backup and the latest independent privacy history, and test compatibility on an isolated restore. Never roll back withdrawals/deletions or discard operational state to restore market data.

## Documentation maintenance

Update these three documents in place when behavior, approved decisions or operating state changes. Keep `README.md` short. Do not create another root completion report for each fix. Put necessary dated verification artifacts under `audit/YYYY-MM-DD/`; use the commit description for routine change history. Add new historical material under `docs/archive/` with a superseded banner and date. Keep research plans separate and label proposals as proposals.

Use repository-relative links and repair links when moving files. Preserve historical documents and evidence; do not rewrite past findings as current guidance. Record remaining gates in `docs/OPERATIONS.md`, with an owner, next action and dated evidence rather than a new competing checklist.
