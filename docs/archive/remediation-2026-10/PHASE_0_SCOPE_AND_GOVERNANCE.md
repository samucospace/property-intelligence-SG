# Phase 0 scope, governance and ownership

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


Updated 2 October 2026 following independent validation and the owner's instruction to repair Phase 0. Governing documents: [readiness report](GO_LIVE_READINESS_REPORT_2026-10-02.md), [remediation plan](GO_LIVE_REMEDIATION_PLAN_2026-10-02.md), and [independent review](PHASE_0_TO_2_INDEPENDENT_VALIDATION_2026-10-02.md).

## Accountable owner and deployment context

**Sam Fraser is the release owner and operational contact**, confirmed directly in this chat on 2 October 2026. Sam approves release scope, retention/privacy decisions, recovery arrangements and any eventual production launch. Engineering implements and supplies evidence; implementation reports do not constitute Sam's approval.

The project currently runs locally on Sam's machine and is not live. Sam confirmed that it will not go live until every identified issue is fixed and verified. Hosted backup setup is deferred until private deployment, with evidence required before public release. The planned strategy is daily DigitalOcean Droplet backups plus automated encrypted database copies to a separate cloud provider/account; Sam's machine may hold an additional copy. The cloud destination is not yet selected or configured. See the [deployment-stage backup strategy](PHASE_0_OPERATIONS_RUNBOOK.md#deployment-stage-backup-strategy-deferred-not-live). Local capture/restore is verified; hosted/off-host recovery remains unverified.

## Initial release scope and enforcement

Continue with the existing **read-only analytics MVP** scope. `RELEASE_SCOPE` defaults to `analytics-readonly` and invalid values reject startup.

- `/api/features` supplies runtime scope to the client. Lead/advisory/newsletter UI stays hidden until enabled by the server; feature-fetch failure keeps it hidden.
- Lead submission, newsletter confirmation and all admin routes reject requests server-side in the read-only release, including valid admin credentials.
- Existing signed unsubscribe handling remains available to support withdrawal by existing contacts. Read-only scope does not make existing personal data unprotected or disposable.
- All outbound email is disabled under this scope. Full-scope fixture testing in staging/test uses the shared fake adapter and cannot reach Resend.
- Live email additionally requires explicit production enablement. This is containment, not completion of Phase 3 delivery/consent controls.
- Data-sync APIs and the sync script default to disabled via `ENABLE_DATA_SYNC=false`; scheduler sync is disabled too. Phase 1 local write-safety corrections are verified, but target-image qualification and Phase 2 source reconciliation remain required before operational reenablement.
- Lead cleanup defaults to disabled; startup and scheduled cleanup require explicit policy enablement under full scope. Do not enable until retention/preservation rules are approved and tested.
- Operational rebuild remains quarantined regardless of `--force`. Only explicitly injected, isolated test fixtures can use its implementation. The [Phase 1 report](PHASE_1_COMPLETION_REPORT_2026-10-02.md) documents repaired isolation, preservation, checkpoints and crash recovery, plus the remaining source and target-platform gates.

All full-product controls remain subject to the original Phase 3 **email, consent, access and recovery** gates. The Phase 2 report's alternative pipeline-hardening title does not replace that scope.

## Staging and recovery safeguards

Staging must load a separate explicit environment, use a prepared database marked `environment=staging`, and use mock provider credentials. Staging/test never automatically load the local `server/.env` or root `.env`.

Staging preparation creates a new database from allowlisted public-market tables and inserts synthetic contacts. It never copies real contacts, tokens, suppression records or job logs. An existing target is rejected; staging creation cannot overwrite its source.

Recovery captures use unique directories and a separately saved random key file. Restoration runs in a new process and verifies authentication, the complete snapshot hash, structural integrity, foreign keys and all table counts. Original October 2 baseline artifacts are preserved.

## Features pending later gates

Livability location-quality withholding, distance/coverage claims and amenity provenance still require Phase 2 corrections. SORA remains a hardcoded reference series whose provenance must be established or whose feature must be disabled before launch. Phase 0 containment does not certify these analytics for publication.

## Approval register

| Decision | Evidence/status |
|---|---|
| Release owner and operational contact | Sam Fraser; direct user confirmation on 2 October 2026 |
| Deployment context / future backup destination | Not live; daily DigitalOcean backups plus separate-provider encrypted copies planned for deployment; local machine optional additional copy |
| Repair Phase 0 containment and local recovery | Direct instruction from Sam in this chat |
| Read-only-first engineering scope | Existing charter retained and now implemented; public release remains NO-GO |
| Full-product enablement, notices, retention, RPO/RTO, provider approval | Pending accountable-owner decisions and Phase 3/4 evidence |
| Final public release approval | Sam requires every identified issue to be fixed and verified; deployment-stage backup validation must pass before launch; this charter is not go-live approval |
