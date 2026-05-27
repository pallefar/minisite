---
phase: 67-operational-runbooks-observability
plan: 1
subsystem: ops-runbooks
tags: [ops, runbooks, hipaa, secrets, incident-response, backup, on-call]
requires: []
provides:
  - runbook:secrets-rotation
  - runbook:incident-response
  - runbook:backup-restore
  - runbook:on-call-rotation
affects: []
tech-stack:
  added: []
  patterns:
    - operator-checklists-over-prose
    - per-secret-rotation-procedure
    - severity-laddered-detection-signals
    - hipaa-§164.308-contingency-control
key-files:
  created:
    - leanshot/.planning/runbooks/secrets-rotation.md
    - leanshot/.planning/runbooks/incident-response.md
    - leanshot/.planning/runbooks/backup-restore.md
    - leanshot/.planning/runbooks/on-call-rotation.md
  modified: []
decisions:
  - cross-reference vendor-secrets.md as canonical inventory; secrets-rotation.md owns procedure
  - cross-reference hbnr-incident-response.md for HIPAA breach-flow specifics; incident-response.md owns general flow
  - single-person on-call rotation acknowledged as gap with explicit exit criteria
  - annual restore drill (HIPAA §164.308(a)(7)(ii)(D)) procedure documented; first drill at v1.4 launch
metrics:
  duration_minutes: ~25
  completed: 2026-05-27
  tasks_completed: 4
  files_created: 4
  total_lines: 1235
requirements_completed: [OPS-01, OPS-06, OPS-07, OPS-08]
---

# Phase 67 Plan 01: Operational Runbooks Summary

Shipped 4 operator-facing runbooks (1235 total lines) covering secrets rotation, incident response, backup/restore, and on-call rotation — checklist-style, HIPAA-mapped, and cross-referenced.

## What Was Built

Four pure-markdown runbooks landed in `leanshot/.planning/runbooks/`:

| File | Lines | Requirement | Audience |
|------|-------|-------------|----------|
| `secrets-rotation.md` | 337 | OPS-01 | Operator (founder) rotating secrets on schedule or in emergency |
| `incident-response.md` | 269 | OPS-06 | On-call responder during P1-P4 incidents |
| `backup-restore.md` | 363 | OPS-07 | Operator running PITR / pg_dump / bucket restore |
| `on-call-rotation.md` | 266 | OPS-08 | Founder on call + future backup contact |

### secrets-rotation.md (OPS-01)

- 20-row high-blast-radius inventory table (full registry remains in `vendor-secrets.md`).
- Per-secret rotation procedures A-L (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_CLINICAL_API_KEY`, `COHERE_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `SLACK_GUARDRAIL_WEBHOOK_URL`, `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY`, `MUX_TOKEN_*`, `VAPID_PRIVATE_KEY`, `SENTRY_DSN`).
- Emergency rotation flow with 60-minute time budget + forensics step.
- Verification checklist covering all storage locations, redeploys, smoke tests, audit logging.
- Pulls in lessons from `[[reference_supabase_service_role_key_format_divergence]]`, `[[reference_mux_fn_pair_deploy_passthrough_drift]]`, `[[feedback_vault_to_env_var_fast_path_pattern]]`.

### incident-response.md (OPS-06)

- P1-P4 severity ladder with first-response SLAs (P1=30min 24/7).
- 11 detection signals mapped to severity + auto-page rules (Sentry, Supabase status, Stripe webhook failures, Vercel deploy failures, Edge Fn 5xx, PostHog funnel breaks, Better Stack uptime, HIPAA audit anomalies, Slack guardrail).
- 11 log sources with URLs + retention windows.
- 6 stabilization playbooks: Edge Fn rollback, Vercel rollback, database PITR rollback, feature-flag kill switch, mass logout (JWT signing key rotation via SECDEF RPC), Stripe webhook backlog reconciliation.
- HIPAA §164.404 60-day breach clock summary; defers full flow to `hbnr-incident-response.md`.
- Communication templates (Slack `#incidents`, status page, post-resolution customer email per §164.404(c)).
- Postmortem 6-section template; tooling cheatsheet with `curl` examples for Sentry / Better Stack / Slack / PostHog.

### backup-restore.md (OPS-07)

- Three backup tiers: Supabase PITR (RPO 5min/RTO 30min), `pg_dump` snapshot (operator-on-demand, gpg-encrypted cold storage), storage bucket restore (manifest + signed-URL flow).
- HIPAA §164.308(a)(7) contingency-plan control fully mapped (sub-paragraphs A through E).
- PITR procedure: pre-flight (snapshot current first, pause cron, pause Stripe webhooks), in-place restore, partial restore via new-project clone.
- `pg_dump` snapshot procedure with gpg encryption + cold-storage upload + retention (30d hot, 7y cold per HIPAA medical-record retention).
- Storage bucket dump/restore via manifest JSON + `Authorization: Bearer SERVICE_ROLE_KEY` loop.
- 9-item post-restore verification checklist: row counts vs PostHog DAU, RLS policy presence via `pg_policies`, FK validity via `pg_constraint`, sequence catch-up, `ops_audit_log` continuity, real-user login smoke, Stripe sync spot-check, Edge Fn `/healthz`, PostHog event flow.
- Annual restore-drill procedure (§164.308(a)(7)(ii)(D)) with 5 phases (plan, execute, validate, document, postmortem) and explicit acknowledgment that the drill project must be deleted within 24h (data minimization).
- 4 disaster scenarios: Supabase region outage, operator-DROP, ransomware, Supabase account compromise.

### on-call-rotation.md (OPS-08)

- Single-person rotation explicitly documented as v1.4 reality with no fake "rotation theater".
- SLA matrix splits business-hours from off-hours expectations.
- Better Stack on-call configured as primary tooling (built-in feature, no PagerDuty contract).
- Escalation tree shows "unmitigated" branch when founder unack'd after 30min — this gap is intentionally surfaced rather than hidden.
- HIPAA §164.308(a)(6) "security incident procedures" gap acknowledged with documented mitigations + exit criteria.
- Six trigger conditions for adding a backup contact (MAU>500, MRR>$5k, any P1 >2h to ack, OOO >7 consecutive days, B2B clinic procurement ask, 12-month annual review).
- Add-a-backup procedure: Better Stack member add + Supabase Studio Developer role + Vercel Member + GitHub Triage + BAA signing + 30-day synthetic-page drill.
- Burn-out mitigation guidance for the founder (do-not-ack non-P1 off-hours, track active-incident hours, vacation maintenance banner).
- 5 open items tracked for forward sweep (status-page DNS, backup contact, annual drill, PagerDuty eval, vacation policy).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | secrets-rotation.md (OPS-01) | `061fb291` | `leanshot/.planning/runbooks/secrets-rotation.md` |
| 2 | incident-response.md (OPS-06) | `b8607207` | `leanshot/.planning/runbooks/incident-response.md` |
| 3 | backup-restore.md (OPS-07) | `6bc11166` | `leanshot/.planning/runbooks/backup-restore.md` |
| 4 | on-call-rotation.md (OPS-08) | `a3c14f70` | `leanshot/.planning/runbooks/on-call-rotation.md` |

## Verification

- All 4 files exist at `leanshot/.planning/runbooks/`: confirmed via `wc -l`.
- Line counts: 337 / 269 / 363 / 266 — all comfortably ≥100 lines (per plan).
- secrets-rotation.md inventory ≥10 secrets: 20 high-blast-radius rows + full inventory in companion `vendor-secrets.md`.
- incident-response.md covers P1-P4 + log locations + rollback + HIPAA breach trigger: confirmed in sections "Severity Levels", "Log Locations", "Stabilization Playbooks", "HIPAA Breach Notification Trigger".
- backup-restore.md covers PITR + pg_dump fallback + drill procedure: confirmed in "Tier 1", "Tier 2", "Restore Drill" sections.

## Deviations from Plan

None. Plan was executed as written, with two intentional cross-reference enhancements:

1. **secrets-rotation.md** explicitly cross-references the pre-existing `vendor-secrets.md` (Phase 52 artifact, 171 lines, status=active) rather than duplicating the inventory. The 20-row table in secrets-rotation.md is a high-blast-radius *subset* for at-a-glance rotation prioritization; `vendor-secrets.md` remains the canonical full registry. Avoids two-sources-of-truth drift.

2. **incident-response.md** cross-references the pre-existing `hbnr-incident-response.md` (HIPAA Breach Notification Rule-specific flow, 121 lines, status=active) rather than duplicating breach procedures. incident-response.md owns the general P1-P4 flow; `hbnr-incident-response.md` owns the §164.404 breach-letter / 60-day-clock specifics. Operators are directed to use BOTH when an incident touches PHI.

## Threat Flags

None — these are markdown runbooks; no new code surface introduced.

## Known Stubs

None.

## Cross-references seeded

These runbooks reference each other and external lessons, providing operator navigation:

- `secrets-rotation.md` → `incident-response.md` (emergency rotation triggers incident flow)
- `secrets-rotation.md` → `vendor-secrets.md` (canonical inventory)
- `incident-response.md` → `secrets-rotation.md` (mass-logout playbook uses JWT rotation)
- `incident-response.md` → `backup-restore.md` (database rollback playbook)
- `incident-response.md` → `hbnr-incident-response.md` (HIPAA breach flow)
- `incident-response.md` → `on-call-rotation.md` (escalation matrix)
- `backup-restore.md` → `secrets-rotation.md` (post-restore secret rotation if needed)
- `on-call-rotation.md` → `incident-response.md` (per-incident operator procedure)

## Self-Check: PASSED

- `leanshot/.planning/runbooks/secrets-rotation.md`: FOUND (337 lines)
- `leanshot/.planning/runbooks/incident-response.md`: FOUND (269 lines)
- `leanshot/.planning/runbooks/backup-restore.md`: FOUND (363 lines)
- `leanshot/.planning/runbooks/on-call-rotation.md`: FOUND (266 lines)
- Commit `061fb291`: FOUND in worktree branch
- Commit `b8607207`: FOUND in worktree branch
- Commit `6bc11166`: FOUND in worktree branch
- Commit `a3c14f70`: FOUND in worktree branch

All claims verified.
