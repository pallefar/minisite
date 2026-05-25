# Phase 27: Modular Admin Shell Extensions - Discussion Log

> Audit trail only. Decisions captured in CONTEXT.md.

**Date:** 2026-05-17
**Phase:** 27 — Modular Admin Shell Extensions
**Areas discussed:** Bulk actions, Cohort builder, Cmd+K palette, Funnel-anomaly cron

---

## Bulk Actions

### Q1 — Execution mode + row cap

| Option | Description | Selected |
|---|---|---|
| Sync ≤100 + async beyond (cap 10,000) | Familiar small UX; no timeout for large. (Recommended) | ✓ |
| Sync always with hard cap 500 | Simpler; restricts large. | |
| Async always | Consistent; overhead for small. | |

**User's choice:** Sync ≤100; async beyond (cap 10,000)

### Q2 — Confirmation modal

| Option | Description | Selected |
|---|---|---|
| Type 'CONFIRM' for destructive + button-click for non-destructive | Defense in depth; GitHub-style. | |
| Button-click for all actions | Simpler UX; fastest workflow. | ✓ |
| Type affected count | Force-read count. | |

**User's choice:** Button-click for all actions. Relies on undo (Q3) as safety.

### Q3 — Undo policy

| Option | Description | Selected |
|---|---|---|
| 60s undo for ban/comp/tag; none for password-reset/CSV | Mixed; matches Gmail undo-send. (Recommended) | ✓ |
| No undo — manual reverse only | Simpler; higher cost on accident. | |
| 5-min universal undo for all state mutations | Cushy; bigger investment. | |

**User's choice:** 60s for ban/comp/tag; none for password-reset/CSV.

---

## Cohort Builder

### Q4 — Expression language

| Option | Description | Selected |
|---|---|---|
| JSONB rule tree + visual builder UI | Non-engineering accessible; constrained. (Recommended) | ✓ |
| Raw SQL-snippet | Most powerful; injection risk. | |
| json-rules-engine | Library; doesn't translate to SQL natively. | |

**User's choice:** JSONB rule tree + visual builder UI.

### Q5 — Field allowlist

| Option | Description | Selected |
|---|---|---|
| Curated 15-field allowlist v1 | Predictable; auditable. (Recommended) | ✓ |
| Open field-set on profiles/affiliates/subscriptions | More flexible; harder perf. | |
| Curated + superadmin SQL escape hatch | Two paths. | |

**User's choice:** Curated 15-field allowlist v1.

### Q6 — Consumer read pattern

| Option | Description | Selected |
|---|---|---|
| Matview 15-min + indexed read | Per TAXO-03; sub-50ms p99. (Recommended) | ✓ |
| Matview + SECDEF helper `is_user_in_cohort` | Cleaner API; extra fn call. | |
| On-the-fly rule evaluation (no matview) | Always fresh; doesn't meet perf gate. | |

**User's choice:** Matview + indexed read.

---

## Cmd+K Command Palette

### Q7 — Library

| Option | Description | Selected |
|---|---|---|
| cmdk (vercel/cmdk) | ~10kB gz; React-only; battle-tested. (Recommended) | ✓ |
| kbar | More featureful; ~20-30kB; less maintained. | |
| Custom Downshift + Fuse.js | Smallest; most labor. | |

**User's choice:** cmdk.

### Q8 — Index sources

| Option | Description | Selected |
|---|---|---|
| Static modules + recent items (SECDEF RPC) + static quick actions | Fast first-paint; recent loads async. (Recommended) | ✓ |
| Static + recent + dynamic search-as-you-type | Powerful; more round-trips. | |
| Static only (no DB) | Cheapest; loses "jump to recent". | |

**User's choice:** Static modules + recent items (lazy on open) + static quick actions.

### Q9 — Destructive quick-action gating

| Option | Description | Selected |
|---|---|---|
| aal2 step-up required for destructive | Shoulder-surfing defense. (Recommended) | ✓ |
| Destructive actions hidden from palette | Less friction; weaker workflow. | |
| Allow without step-up; rely on modal | Fast; weakest defense. | |

**User's choice:** aal2 step-up for destructive.

---

## Funnel-Anomaly Cron

### Q10 — Tracked funnels source

| Option | Description | Selected |
|---|---|---|
| 5 hard-coded funnels v1 | Predictable. | |
| All events flagged `is_funnel:true` in taxonomy | Flexible; false-positive noise risk. | |
| Admin-configurable `anomaly_tracked_funnels` table | Most flexible; one more surface. | ✓ |

**User's choice:** Admin-configurable table.

### Q11 — Baseline methodology

| Option | Description | Selected |
|---|---|---|
| Rolling 7-day same-hour-of-day | Sufficient noise floor v1. (Recommended) | |
| Same day-of-week (4 weeks) | Captures weekly pattern; slower detection. | |
| Hybrid same-DOW + same-HOD with weighted blending | Most sensitive; complex SQL. | ✓ |

**User's choice:** Hybrid same-DOW + same-HOD blending.

### Q12 — Alert routing + suppression

| Option | Description | Selected |
|---|---|---|
| In-app banner + email to superadmin alias; 4h suppression | (Recommended) | ✓ |
| Email + audit-log only (no banner) | Slower discovery loop. | |
| Slack + email + banner + PagerDuty | Overkill v1. | |

**User's choice:** In-app banner + email; 4h same-funnel suppression.

---

## Claude's Discretion

- JSONB → SQL translator (recursive TS function).
- Visual builder UI primitives (headless lib or hand-rolled).
- Matview refresh failure handling.
- cmdk theming match.
- Recent-items window (recommend 7d, 20 items).
- aal2 step-up wiring via `mfa.challengeAndVerify`.
- Field-allowlist enforcement (DB enum vs TS const + ESLint).

## Deferred Ideas

Custom SQL escape hatch, search-as-you-type palette member lookup, Slack/PagerDuty alerts, CONFIRM-text destructive bulk, 5-min universal undo, per-cohort matview refresh, per-clinic anomaly tracking, cohort set operations UI sugar, auto-resolution suppression reset, bulk action templates.
