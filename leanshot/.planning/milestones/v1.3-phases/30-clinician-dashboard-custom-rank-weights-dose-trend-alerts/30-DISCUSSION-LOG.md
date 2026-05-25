# Phase 30 Discussion Log

**Date:** 2026-05-17
**Phase:** Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts
**REQ coverage:** CLIN-01..08 (8/8)
**Discussion mode:** discuss (default)
**Areas covered:** 4 (Phase 25 dep / email path · Rank weights data shape · Dose-trend algorithm + thresholds · Alert delivery + status machine)

---

## Area A: Phase 25 dependency / email path

### Q1 — Email path strategy (Phase 25 SES vs Resend fallback)
**Options:**
1. Ship now with Resend + no-PHI template (Recommended) — direct dispatch; CI lint covers no-PHI invariant; swap to SES via no-op rename when Phase 25 ships
2. Block Phase 30 on Phase 25 Plan 25-03 alone — ship just the router, leave SES vendor wiring as health check
3. Reorder: ship full Phase 25 (all 10 plans) before Phase 30

**Selected:** Option 1 — ship now with Resend + no-PHI template.
**Rationale:** unblocks Phase 30 immediately; Plan 29-05 already proved the Resend non-PHI fallback works in production; swap-in to `_shared/email-router.ts` is a no-op rename when Phase 25 ships.

### Q2 — Email template subject + body shape
**Options:**
1. Generic + actionable (Recommended) — subject `New clinical alert — {org_name}`; body single CTA link
2. Generic + count rollup — adds alert count
3. Org-only branded — org logo + CTA; suits white-label

**Selected:** Option 1 — generic + actionable.
**Rationale:** simplest no-PHI template; passes lint trivially; deep-link `?alert={uuid}` lands clinician on correct record post-auth.

---

## Area B: Rank weights data shape

### Q3 — Where do per-clinic ranking weights live?
**Options:**
1. JSONB column on org_settings (Recommended) — `org_settings.ranking_weights jsonb null`; NULL falls through to Phase 10 hardcoded defaults
2. Separate `org_ranking_weights` table — row-per-signal; better audit history but more joins
3. Two-level defaults + override — DB constants + org_settings override

**Selected:** Option 1 — JSONB on org_settings.
**Rationale:** minimal schema delta; preserves Phase 10 contract for non-customized clinics; sum=1.0 invariant via CHECK or trigger.

### Q4 — Roster reorder mechanism (SC#1: within 1s of save)
**Options:**
1. Realtime broadcast via Phase 28 HMAC channel (Recommended) — `org-{hmac8}-settings` channel; cross-tab
2. Client refetch on save success — single-tab only
3. Polling on roster (Phase 10 pattern) — up to 30s lag, misses SC#1 1s SLA

**Selected:** Option 1 — HMAC realtime broadcast.
**Rationale:** meets SC#1 SLA; reuses Phase 28 + Plan 29-03 infrastructure; cross-tab consistency.

---

## Area C: Dose-trend algorithm + thresholds

### Q5 — What clinical signal triggers an alert?
**Options:**
1. Adherence + variance (Recommended) — N missed in M days OR variance > X%
2. Adherence-only — N missed in M days
3. Dose-skip streak — N consecutive skips

**Selected:** Option 1 — dual-rule adherence + variance.
**Rationale:** captures both "patient stopped" and "patient drifting"; pure SQL (no ML); defaults N=2, M=14, X=25%.

### Q6 — CLIN-07 per-patient threshold overrides
**Options:**
1. New `org_patient_thresholds` table (Recommended) — composite PK (org_id, patient_user_id) + JSONB thresholds + audit fields
2. Column on `org_patient_links` — tight coupling; awkward when set pre-acceptance
3. JSONB in `org_consent_grants.scope` — conflates with consent semantics

**Selected:** Option 1 — new `org_patient_thresholds` table.
**Rationale:** clean separation; per-row audit-loggable; cron resolves effective thresholds with `COALESCE(override, org_default)`.

---

## Area D: Alert delivery + status machine

### Q7 — `clinician_alerts` schema shape
**Options:**
1. Single table + status enum (Recommended) — pending|acknowledged|snoozed|auto_resolved|delivery_failed
2. Two tables: alerts + delivery_log — same as recommended but explicit
3. Append-only alerts + event-sourced status view — overkill for v1.3

**Selected:** Option 1 — single table + status enum + separate append-only `clinician_alert_deliveries` log.

### Q8 — Debounce + retry mechanics
**Options:**
1. debounce_key + cron deduplication (Recommended) — `${type}:${patient}:${day}` UNIQUE; two crons (detect 03:00 + deliver every 20min × 3 retries = ~1h window)
2. Single-cron with internal retry loop — blocks worker, retries lost on restart
3. Two crons + queue table — premature for v1.3

**Selected:** Option 1 — debounce_key UNIQUE + two-cron pattern.
**Rationale:** dedup enforced at DB level; retry window ~1h via */20min schedule; mirrors Plan 29-04 cron pattern.

### Q9 — In-app delivery + snooze UX
**Options:**
1. Phase 28 HMAC realtime + persistent panel + preset snoozes (Recommended) — `1h | 4h | 24h | 7d`
2. Polling-based panel + preset snoozes — adds latency
3. Email-only + dashboard, no panel — violates SC#3 "in-app notification"

**Selected:** Option 1 — HMAC realtime + persistent panel + preset snoozes.
**Rationale:** meets SC#3 in-app requirement; reuses HMAC infra; preset durations keep snooze UI scoped (free-form deferred to v1.4).

---

## Decisions captured to CONTEXT.md

A1-D-01 through D-18 — 18 implementation decisions across 5 categories (Phase 25 dep + rank weights + dose-trend + alert delivery + aggregate dashboard).

## Deferred ideas (not folded)

10 items — see `30-CONTEXT.md` `<deferred>` block. Highlights: free-form snooze, ML-based trend, Slack/SMS, cross-clinic benchmarks, per-clinician routing prefs, alert escalation, patient-side visibility, severity-collapse decision, matview combine, `_shared/email-router.ts` swap timing.

## Claude's Discretion (researcher/UI-researcher decides at plan-phase)

- Right-rail vs bell-icon dropdown for ClinicianAlertsPanel
- Sliders vs numeric inputs vs presets for ranking-weights UI
- 1 vs 3 severity levels for clinician_alerts
- Cron schedule collision resolution (D-17 — 5 candidate slots audited)
- 1 combined vs 2 separate matviews (perf-driven)
- `_shared/email-router.ts` swap-in timing (P30 vs P25 close task)
