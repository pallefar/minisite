# Phase 27: Modular Admin Shell Extensions — Research

**Researched:** 2026-05-17
**Domain:** Admin-shell extensions — bulk actions, cohort builder, command palette, funnel-anomaly cron
**Confidence:** HIGH on cmdk + Postgres matview + pg_cron; MEDIUM on JSONB rule-tree-to-SQL translator (custom code, no off-the-shelf primitive); MEDIUM on Supabase Auth aal2 freshness (API surface verified, freshness-check pattern requires JWT inspection)

---

## Summary

Phase 27 adds four shared admin capabilities on top of the Phase 24 admin-shell foundation (manifest router + admin_role enum + audit_logs + log_admin_action RPC). All four are conventional patterns with well-trodden library choices — the engineering risk is integration discipline (sharing the cohort rule-tree contract across TS/SQL boundaries; aal2 step-up gating destructive palette actions; pg_cron schedule choreography against the existing v1.3 cron grid) rather than algorithmic novelty.

**Primary recommendation:** Lock to **cmdk 1.1.1** (vercel/cmdk, Radix-based, React 19 peer; verified npm registry 2026-05-17) for the command palette; **Postgres native materialized view + `refresh materialized view concurrently`** for cohort_membership (unique index on `(user_id, cohort_id)` satisfies the concurrency requirement); **pg_cron 5-minute schedule with built-in single-instance overlap protection** for the anomaly cron; **recursive Postgres function (NOT plpgsql LOOP, plain JSONB walk) for rule-tree → WHERE clause translation** with strict field allowlist enforcement at both the TS validator AND SECDEF RPC layers (defense-in-depth per `[[feedback_planner_iter1_anti_patterns]]`).

Carry-forward critical: every admin RPC writes audit_logs via Phase 24's `log_admin_action(action_name, target_user_id, ...)`; bulk actions write ONE row per affected user. Anomaly alert emails route via Phase 25's `_shared/email-router.ts` non-PHI Resend path; this is vendor-gated (Resend domain may not be verified by Phase 27 ship) so wrap in `[[reference_vendor_gated_send_health_check]]` startup probe.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Bulk actions (ADMIN-04)**
- **D-01** Execution: sync ≤100 rows; queue background Edge Fn beyond, hard cap 10,000. `admin_bulk_jobs` table with status enum, rows_total, rows_completed, error_log jsonb. Sync path runs inside admin RPC. Async path enqueues + polling (2s) UI progress bar. Per-row `log_admin_action` writes ONE row per affected user with before_data + after_data.
- **D-02** Confirmation modal: button-click for all actions. Modal shows action summary + count + first 3 sample users. Relies on undo (D-03) as safety net.
- **D-03** Undo policy: ban + comp-plan + tag/untag = 60s undo banner; force-password-reset = NO undo; CSV export = NO undo. Undo state stored as client transient + `bulk_action_undo_token` row (reverse RPC validates).
- **D-04** 5 action types v1: `csv_export`, `tag`, `comp_plan`, `ban`, `force_password_reset`. Each gates on admin_role + aal2 freshness.

**Cohort builder (ADMIN-05 + TAXO-03)**
- **D-05** Expression language = JSONB rule tree + visual builder UI. Shape: `{op:'and'|'or', children:[...]}` recursive, leaf `{field, op, value}`. Server-side translator generates SQL WHERE clause for matview population.
- **D-06** Field allowlist (15 fields v1): `tier`, `role`, `days_since_signup`, `days_since_last_login`, `total_paid_amount_cents`, `active_streak_days`, `has_active_subscription`, `signup_source`, `country`, `language`, `has_org`, `has_completed_onboarding`, `is_affiliate`, `anomaly_flagged`, `account_state`. No custom-SQL escape hatch in v1.
- **D-07** Consumer read pattern = matview + indexed read. `cohort_membership(user_id, cohort_id, joined_at)` PRIMARY KEY `(user_id, cohort_id)`. Matview rebuilt every 15min via pg_cron. Consumers query `select 1 from cohort_membership where user_id = ? and cohort_id = ?`. 15-min staleness acceptable.
- **D-08** Matview refresh = `refresh materialized view concurrently`. Single matview rebuilt per cron tick (not per-cohort).
- **D-09** Cohort lifecycle: `cohort_definitions.status` enum('draft','active','archived'). Only `active` populated into matview.

**Command palette (ADMIN-06)**
- **D-10** Library: cmdk (vercel/cmdk). ~10kB gz. Fits Phase 24 admin-shell 30 kB ceiling.
- **D-11** Index sources: (a) build-time modules from `ADMIN_MODULES` manifest; (b) recent items via SECDEF RPC `admin_palette_recent` fetched lazily on open; (c) build-time quick actions. No search-as-you-type DB lookup in v1.
- **D-12** Quick-action destructive gate: aal2 step-up required. If aal2 freshness > 15 min, prompt fresh TOTP before executing.
- **D-13** Keyboard-first UX: Cmd+K opens; ↑↓ navigates; ⏎ executes; Esc closes.

**Funnel-anomaly cron (TAXO-05 + SC#5)**
- **D-14** Tracked-funnels list admin-configurable via `anomaly_tracked_funnels(funnel_id, event_name, is_enabled, baseline_lookback_days, sigma_threshold, created_by, created_at)`. Seed 5 funnels: signup_completed, activation_event, payment_succeeded, lifetime_grant, helpdesk_ticket_resolved.
- **D-15** Baseline = hybrid same-DOW (4wk, weight 0.6) + same-HOD (7d, weight 0.4) weighted blend. Flag when 24h count < (blended mean − 2σ). `funnel_anomaly_baseline_compute(event_name)` SECDEF function.
- **D-16** Cron schedule: every 5 minutes (`0,5,10,15,20,25,30,35,40,45,50,55 * * * *`). No collision with audit-archive (day-1 03:00), BAA expiry (day-1 06:00), subprocessor-diff (Mon 07:00), affiliate-lifetime-recurring (day-1 03:00).
- **D-17** Alert routing: in-app banner on /admin/* (realtime channel) + email to `SUPERADMIN_ALERTS_EMAIL` env var.
- **D-18** Suppression: same funnel suppressed 4h after first alert.
- **D-19** Alert log: `funnel_anomaly_alerts(id, funnel_id, fired_at, observed_count, expected_mean, expected_stddev, z_score, resolution_status enum('firing','resolved','acknowledged'), acknowledged_by, acknowledged_at)`. Append-only; superadmin acknowledges via UI; audit-logged.

**Schema additions**
- **D-20** New tables: `admin_bulk_jobs`, `cohort_definitions`, `cohort_membership` (matview), `anomaly_tracked_funnels`, `funnel_anomaly_alerts`, `bulk_action_undo_token` (60s TTL via cron-purge).
- **D-21** New SECDEF RPCs (7): `admin_bulk_action_execute`, `admin_bulk_action_undo`, `cohort_define`, `cohort_archive`, `admin_palette_recent`, `funnel_anomaly_baseline_compute`, `funnel_anomaly_acknowledge`. All audit-logged via `log_admin_action`.
- **D-22** New Edge Functions (3): `admin-bulk-job-worker`, `funnel-anomaly-cron`, `bulk-undo-token-purge` (1-min cron purges expired undo tokens).
- **D-23** Append-only RLS on `audit_logs` (Phase 24 carry) + same posture on `funnel_anomaly_alerts` + `admin_bulk_jobs` (read-only after creation).

### Claude's Discretion

- Exact JSONB rule tree → SQL translator implementation (recursive function in TS + tests).
- Visual builder UI primitives (recommend headless library — e.g. dnd-kit for nesting, or hand-rolled).
- Matview refresh failure handling (cron alert if refresh takes >60s).
- cmdk theming to match Phase 24 admin-shell visual style.
- Recent-items recency window (recommend last 7 days, max 20 items).
- aal2 step-up implementation (Supabase Auth `mfa.challengeAndVerify` per Phase 24 D-07).
- Field-allowlist seed migration shape (DB enum vs TS const + ESLint rule).

### Deferred Ideas (OUT OF SCOPE)

- Custom-SQL escape hatch in cohort builder (superadmin-only) — revisit if 15-field allowlist proves insufficient.
- Search-as-you-type member lookup in palette — v1.4 if recent-items proves insufficient.
- Slack/PagerDuty alert channels — v1.5 when on-call rotation exists.
- Type 'CONFIRM' free-text for destructive bulks — revisit on accidental-bulk-ban incident.
- 5-minute universal undo for ALL actions — current 60s sufficient.
- Per-cohort matview refresh — revisit at cohort count >50.
- Per-clinic anomaly tracking — deferred to Phase 30 (clinic dashboard).
- Cohort overlap / set operations UI — visual builder supports nested AND/OR/NOT but no "intersect cohort A with cohort B" sugar.
- Auto-suppression on resolution — v1 ships fixed 4h window; v1.4 adds "resolved when count returns to within 1σ".
- Bulk action templates / saved filters — v1.4.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-04 | Admin runs bulk actions on Members table (CSV export, tag, comp-plan, ban, force-password-reset) with confirmation modal + audit-log entry per row affected | Standard Stack §Bulk-actions row; Architecture Patterns §1; Don't Hand-Roll: undo-token TTL → use Postgres + pg_cron purge; existing `BulkExportCSVFlow.tsx` Modal+state-machine pattern is the carry-forward template |
| ADMIN-05 | Admin defines + saves cohorts via cohort-builder UI; cross-feature reuse (TAXO funnels, GAME challenges, PAYWALL variants, RECOMMEND triggers, SAVE eligibility) | Architecture Patterns §2 (rule-tree-to-SQL); Code Examples §Recursive translator; Don't Hand-Roll: no JSONB-rule-engine library exists for our 15-field allowlist — hand-roll with zod validator + recursive TS function |
| ADMIN-06 | Admin invokes Cmd+K for fuzzy-search across modules + recent items + quick actions; keyboard-only nav | Standard Stack §cmdk 1.1.1; Code Examples §Command.Dialog + onKeyDown; Architecture Patterns §3 (3-source index merge); aal2 step-up gate per D-12 |
| TAXO-03 | `cohort_definitions` table + `cohort_membership` matview refreshed via pg_cron 15-min | Architecture Patterns §2; Postgres docs verified [REFRESH MATERIALIZED VIEW CONCURRENTLY](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html) requires unique index using ONLY column names (no expressions, no WHERE) — `(user_id, cohort_id)` PK satisfies this. |
| TAXO-05 | Anomaly cron flags funnel-drop regressions (rolling 7-day baseline; alert when conversion < baseline−2σ) | Architecture Patterns §4 (hybrid DOW+HOD baseline); pg_cron single-instance overlap protection verified — if cron run takes >5min, next instance queues automatically. Code Examples §SQL window function. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bulk action confirmation modal + sample-preview UI | Browser/Client | — | Pure presentation; reads from Members table query state already in client |
| Bulk action ≤100 sync execution | API/Backend (Supabase RPC) | Database (audit_logs trigger) | Tx-bounded; per-row audit_logs writes inside the RPC tx; aal2 gate enforced server-side |
| Bulk action >100 async execution | API/Backend (Edge Function worker) | Database (admin_bulk_jobs table) | Edge Function polls `status='pending'`; SQS-style claim pattern via `update ... returning` |
| Bulk undo token lifecycle | Database (60s TTL + pg_cron purge) | API/Backend (reverse RPC) | Postgres native; cron purges expired rows; reverse RPC validates token existence |
| Cohort rule-tree storage | Database (JSONB column) | — | Native JSONB; indexed only by cohort_id |
| Cohort rule-tree validation | Browser/Client (visual builder) AND API/Backend (SECDEF RPC) | — | Defense in depth — TS zod validator at client + recursive plpgsql/SQL validator at RPC ingress |
| Cohort rule-tree → SQL WHERE | API/Backend (recursive TS in Edge Fn that refreshes matview) | Database (matview population SQL) | Translator generates parameterized SQL; matview SQL hardcodes the field allowlist (defense-in-depth) |
| Cohort membership read | Database (matview + index) | — | Sub-50ms p99 read budget — matview row lookup, no join, no compute |
| Cohort matview refresh | Database (pg_cron 15-min) | — | Postgres native `refresh materialized view concurrently` |
| Cmd+K palette UI | Browser/Client (cmdk Radix Dialog) | — | Headless React; static module list bundled; recent-items lazy-fetched on open |
| Palette recent-items query | API/Backend (SECDEF RPC) | Database (read from audit_logs filtered by actor + recency) | Returns last 20 admin-interacted items in last 7 days |
| Palette destructive action gate | API/Backend (assertAaL2Fresh helper) | Browser/Client (cmdk action handler triggers re-challenge UI) | aal2 freshness check via JWT `auth_time` claim; <15min window |
| Funnel-anomaly baseline compute | Database (SECDEF SQL function with window functions) | — | Postgres window functions over events table; cheap (<1s for 7d × 5 funnels at v1.3 scale) |
| Funnel-anomaly cron tick | API/Backend (Edge Function called from pg_cron) | Database (writes funnel_anomaly_alerts) | Edge Fn computes baseline, writes alert row, broadcasts realtime, calls email-router |
| Funnel-anomaly in-app banner | Browser/Client (Supabase Realtime channel subscription in AdminLayout) | — | Realtime broadcast `funnel_anomaly_alerts` channel; AdminLayout subscribes + renders banner |
| Funnel-anomaly email alert | API/Backend (Phase 25 `_shared/email-router.ts` non-PHI Resend path) | — | Vendor-gated by `[[reference_vendor_gated_send_health_check]]` — Resend domain verification |

## Standard Stack

### Core (net-new for Phase 27)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **cmdk** | `1.1.1` (latest 2026-05-17) | Command palette React component | `[VERIFIED: npm registry 2026-05-17]` — Radix-based, headless, accessible combobox; React 18 + 19 peer; published 2025-03-14; minor patch from 1.1.0. ~10 kB gz raw; pulls 4 Radix deps (`@radix-ui/react-id`, `@radix-ui/react-dialog`, `@radix-ui/react-primitive`, `@radix-ui/react-compose-refs`) verified via `npm view cmdk dependencies`. **Pitfall:** the Radix Dialog dep is shared with `vaul`/other Radix consumers — verify total tree-shaken size against the 30 kB admin-shell ceiling at first build. `[CITED: /dip/cmdk Context7]` |
| **Postgres matview + REFRESH CONCURRENTLY** | Postgres 15+ (Supabase Pro+) | `cohort_membership` matview with non-blocking refresh | `[CITED: https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html]` Concurrent refresh requires **at least one UNIQUE index using ONLY column names** (no expression indexes, no partial indexes with WHERE). The D-07 `(user_id, cohort_id)` PRIMARY KEY satisfies this. Only ONE concurrent refresh against a single matview at a time; pg_cron's single-instance overlap protection (see below) handles the rest. |
| **pg_cron** | Bundled with Supabase Pro+ | Cron scheduling for matview refresh (15min), anomaly cron (5min), undo-purge (1min) | `[CITED: https://github.com/citusdata/pg_cron]` "pg_cron can run multiple jobs in parallel, but only one instance of each specific job at a time. If a second instance is triggered before the first finishes, it's queued and starts as soon as the first one completes." **This is the overlap protection.** A 5-min anomaly job that takes 7 min will queue the next tick, not double-fire. |

### Supporting (carry-forward from v1.3 already-locked stack)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod** | already in stack | Cohort rule-tree validator at client + RPC ingress | One schema in `src/lib/cohort/rule-tree-schema.ts`; both TS validator AND a JSON-schema artifact consumed by the SECDEF RPC's validator (parsing at DB layer is plpgsql; zod runs at Edge Function ingress before matview-refresh RPC is called). Per `[[feedback_planner_iter1_anti_patterns]]` — ONE source of truth for the shape. |
| **Supabase Realtime** | v1.2 carry-forward | `funnel_anomaly_alerts` broadcast channel | AdminLayout subscribes on mount when user has `admin_role >= 'admin'`. Pattern from Phase 19 affiliate updates per `[[feedback_realtime_layer_e2e_pattern]]` — drive event via Edge Fn write, verify via direct channel.subscribe() in tests (NOT UI traversal). |
| **Phase 25 `_shared/email-router.ts`** | net-new in P25 (vendor-gated) | Anomaly alert email send | Non-PHI template (funnel name + counts only — no user PII); routes via Resend (P25 D-03 keeps Resend for non-PHI). Wrap in startup health check per `[[reference_vendor_gated_send_health_check]]` — Resend domain may not be verified by P27 ship. |
| **Phase 24 `log_admin_action(...)`** | net-new in P24 | Per-row audit log for bulk actions + cohort lifecycle + palette destructive actions + anomaly acknowledgment | Already SECDEF and append-only; Phase 27 RPCs simply call it. Bulk actions write ONE row per affected user (D-01 explicit). |
| **Phase 24 `ADMIN_MODULES` manifest** | net-new in P24 | Palette static index | `src/lib/admin/modules.ts` exports 12 modules `{key, label, route, icon, lazy, flagKey, minRole}`. Palette maps to `Command.Item` list filtered by `hasMinRole(adminRole, m.minRole)` AND `posthog.isFeatureEnabled(m.flagKey)`. |
| **react-virtuoso** | `^4.18.7` (already in stack) | Virtualization for admin_bulk_jobs progress polling UI (long error_log lists) | Already used for photo grids per CLAUDE.md; reuse for any list >50 rows. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cmdk (vercel/cmdk) | `react-cmdk` (albingroen) | `[VERIFIED: Context7 benchmark]` react-cmdk has lower benchmark score (36 vs 91.55) and smaller community; vercel/cmdk is the Radix-blessed canonical choice. Reject react-cmdk. |
| cmdk | Hand-rolled palette (fuse.js + Radix Dialog) | Loses ~1 week of dev + accessibility audit work; cmdk's keyboard nav + ARIA combobox semantics are battle-tested. Reject hand-roll. |
| Postgres matview + cron refresh | Trigger-based incremental maintenance | At 15-min staleness budget + <20 cohorts × <100k profiles, full rebuild is simpler than incremental triggers and avoids the trigger-cascade correctness burden. Reject incremental. |
| Postgres matview | Application-level cache (Redis/edge KV) | Adds new vendor + new RLS-equivalent (cohort_membership has zero RLS — admin-only read via SECDEF); matview is RLS-compatible and zero new infra. Reject. |
| Recursive TS rule-tree translator | jsonLogic library | jsonLogic ships a JS evaluator; we need a SQL WHERE generator for matview population. Not a fit. Hand-rolled translator with strict allowlist is the safer choice. |
| pg_cron for anomaly schedule | Vercel Cron → Edge Function | pg_cron co-locates the schedule + the query that needs to run; Vercel Cron adds a network hop and a separate failure mode. Reject Vercel Cron for anomaly. |
| Supabase Realtime for in-app banner | Server-Sent Events from Edge Function | Realtime already in stack + RLS-aware; SSE would need new infra. Reject SSE. |

**Installation:**
```bash
npm install cmdk@^1.1.1
# Radix peer deps auto-installed: @radix-ui/react-id, @radix-ui/react-dialog,
# @radix-ui/react-primitive, @radix-ui/react-compose-refs
# Verify React 19 peer warning is suppressed: cmdk@1.1.1 declares "^18 || ^19 || ^19.0.0-rc"
# zod is already in stack — no install needed
```

**Version verification (npm view 2026-05-17):**
- `cmdk@1.1.1` — published 2025-03-14, latest dist-tag. Peer deps: `react: ^18 || ^19 || ^19.0.0-rc`. **VERIFIED COMPATIBLE with React 19** (project on react@^19.0.0).

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              ADMIN BROWSER (Cmd+K open)                                │
│                                                                                        │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │  AdminLayout │───→│ Realtime         │←───│ Supabase Realtime ws (channel:   │   │
│  │  (banner     │    │ channel.subscribe│    │ funnel_anomaly_alerts)            │   │
│  │   render)    │    └──────────────────┘    └──────────────────────────────────┘   │
│  └──────────────┘                                            ▲                        │
│  ┌──────────────┐                                            │                        │
│  │ AdminShell   │───→ ADMIN_MODULES manifest (P24)                                    │
│  └──────┬───────┘                                            │                        │
│         │           ┌──────────────────────────────────┐     │                        │
│         └──Cmd+K──→ │  CommandPalette (cmdk Dialog)    │     │                        │
│                     │  ┌─────────────────────────────┐ │     │                        │
│                     │  │ 1. ADMIN_MODULES (static)   │ │     │                        │
│                     │  │ 2. Recent items (lazy RPC)──┼─┼──┐  │                        │
│                     │  │ 3. Quick actions (static)   │ │  │  │                        │
│                     │  └─────────────────────────────┘ │  │  │                        │
│                     └───────────────┬──────────────────┘  │  │                        │
│                                     │ destructive?         │  │                        │
│                                     ▼                      │  │                        │
│                     ┌──────────────────────────────────┐  │  │                        │
│                     │  aal2 freshness gate (<15 min)   │  │  │                        │
│                     │  → if stale: TOTP challenge UI   │  │  │                        │
│                     └───────────────┬──────────────────┘  │  │                        │
│  ┌──────────────┐                   │                      │  │                        │
│  │ BulkAction   │                   │                      │  │                        │
│  │ Modal        │───┐               │                      │  │                        │
│  │ (preview +   │   │               │                      │  │                        │
│  │  confirm)    │   │               │                      │  │                        │
│  └──────────────┘   │               │                      │  │                        │
│  ┌──────────────┐   │               │                      │  │                        │
│  │ Undo banner  │   │               │                      │  │                        │
│  │ (60s toast)  │   │               │                      │  │                        │
│  └──────────────┘   │               │                      │  │                        │
│  ┌──────────────┐   │               │                      │  │                        │
│  │ CohortBuilder│   │               │                      │  │                        │
│  │ (visual rule │   │               │                      │  │                        │
│  │  tree UI)    │   │               │                      │  │                        │
│  └──────┬───────┘   │               │                      │  │                        │
└─────────┼───────────┼───────────────┼──────────────────────┼──┼─────────────────────-─┘
          │           │               │                      │  │
          │ POST RPC  │ POST RPC      │ POST RPC             │  │
          ▼           ▼               ▼                      │  │
┌─────────────────────────────────────────────────────────-──┼──┼──────────────────────-┐
│                       SUPABASE BACKEND                     │  │                       │
│                                                            │  │                       │
│  ┌─────────────────────────────────────────────────────┐   │  │                       │
│  │  SECDEF RPCs (7 — D-21):                            │   │  │                       │
│  │  • admin_bulk_action_execute(action,filter)←──sync─┘  │  │                       │
│  │    ─ ≤100 → inline + log_admin_action × N           │     │                       │
│  │    ─ >100 → INSERT admin_bulk_jobs status=pending   │     │                       │
│  │  • admin_bulk_action_undo(token)                    │     │                       │
│  │  • cohort_define(name,rule)──┐                       │     │                       │
│  │  • cohort_archive(cohort_id) │                       │     │                       │
│  │  • admin_palette_recent()────┼─────────────────────────────┘                       │
│  │  • funnel_anomaly_baseline_compute(event)           │                              │
│  │  • funnel_anomaly_acknowledge(alert_id)             │                              │
│  └─────────┬─────────────────────┬─────────────────────┘                              │
│            │                     │                                                     │
│            ▼                     ▼                                                     │
│  ┌──────────────────┐  ┌──────────────────────────────────────────────────┐          │
│  │ audit_logs (P24) │  │ Phase 27 new tables (D-20):                       │          │
│  │ (append-only)    │  │  • admin_bulk_jobs                                │          │
│  │ log_admin_action │  │  • cohort_definitions (rule jsonb, status enum)   │          │
│  │ writes 1 row     │  │  • cohort_membership (MATVIEW, PK user+cohort)    │          │
│  │ per affected user│  │  • anomaly_tracked_funnels (admin-config)         │          │
│  └──────────────────┘  │  • funnel_anomaly_alerts (append-only)            │          │
│                        │  • bulk_action_undo_token (60s TTL)               │          │
│                        └────────────────────┬──────────────────────────────┘          │
│                                             │                                          │
│  ┌──────────────────────────────────────────┴──────────────────────────────┐          │
│  │  pg_cron schedule (3 new jobs — D-16 + D-08 + D-22):                    │          │
│  │   ┌─────────────────────────┐  ┌──────────────────────┐  ┌───────────┐ │          │
│  │   │ cohort-matview-refresh  │  │ funnel-anomaly-cron  │  │ undo-purge│ │          │
│  │   │ */15 * * * *            │  │ */5 * * * *          │  │ */1 * * * *│         │
│  │   │ refresh matview         │  │ → Edge Fn (HTTP)     │  │ DELETE    │ │          │
│  │   │ concurrently            │  │                      │  │ FROM      │ │          │
│  │   │                         │  │                      │  │ undo_token│ │          │
│  │   │                         │  │                      │  │ WHERE     │ │          │
│  │   │                         │  │                      │  │ created_at│ │          │
│  │   │                         │  │                      │  │ <now()-60s│ │          │
│  │   └─────────────────────────┘  └─────────┬────────────┘  └───────────┘ │          │
│  └─────────────────────────────────────────-┼──────────────────────────────┘          │
│                                              │                                         │
│                                              ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐         │
│  │  Edge Functions (3 new — D-22):                                            │         │
│  │  • admin-bulk-job-worker (SQS-style claim on pending jobs)                 │         │
│  │    → executes action_type → log_admin_action × N → set completed           │         │
│  │  • funnel-anomaly-cron (5-min tick):                                       │         │
│  │    1. For each enabled tracked_funnel:                                     │         │
│  │       a. Call funnel_anomaly_baseline_compute(event_name)                  │         │
│  │       b. If z_score > threshold AND last_fired > 4h ago:                   │         │
│  │          - INSERT funnel_anomaly_alerts                                    │         │
│  │          - Realtime broadcast on funnel_anomaly_alerts channel             │         │
│  │          - email-router.send (non-PHI template) to SUPERADMIN_ALERTS_EMAIL │         │
│  │  • bulk-undo-token-purge (also via cron SQL — no Edge Fn needed for this)  │         │
│  └──────────────────────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────────-┘
```

Primary flow trace (bulk-ban 47 users from Members table):
1. Admin selects 47 users in Members table, clicks "Ban".
2. BulkActionModal renders, shows "Ban 47 users — Alice, Bob, Carol, +44 more".
3. Confirm → `admin_bulk_action_execute('ban', {user_ids: [...]})` RPC.
4. Server checks `is_admin_at_least('admin')` + aal2 freshness; if stale, refuses with 401_AAL2_STALE.
5. 47 ≤ 100 → sync path. Loop: `update profiles set account_state='banned' where id=...; select log_admin_action('bulk_ban', user_id, ...)`. Insert `bulk_action_undo_token` row (60s TTL).
6. Client receives `{undo_token: '...', count: 47}` → toast banner with Undo button.
7. (a) Click Undo → `admin_bulk_action_undo(token)` → reverse update + new audit row + delete token. (b) Or wait 60s → token auto-purged by undo-purge cron.

### Recommended Project Structure

```
src/
├── components/
│   └── admin/
│       ├── bulk/
│       │   ├── BulkActionModal.tsx          # confirmation + preview (carry pattern from BulkExportCSVFlow)
│       │   ├── BulkUndoBanner.tsx           # 60s toast w/ Undo button
│       │   ├── BulkJobProgress.tsx          # async path polling UI (2s interval)
│       │   └── __tests__/
│       ├── cohort/
│       │   ├── CohortBuilder.tsx            # visual rule-tree editor
│       │   ├── CohortRuleNode.tsx           # recursive node renderer (and/or branch + leaf)
│       │   ├── CohortFieldPicker.tsx        # 15-field dropdown (D-06)
│       │   └── __tests__/
│       ├── palette/
│       │   ├── CommandPalette.tsx           # cmdk Dialog wrapper; Cmd+K listener
│       │   ├── PaletteItems.tsx             # static modules + recent + quick actions
│       │   ├── PaletteAal2Gate.tsx          # destructive action freshness check
│       │   └── __tests__/
│       └── anomaly/
│           ├── AnomalyBanner.tsx            # realtime-driven banner in AdminLayout
│           ├── AnomalyAlertList.tsx         # /admin/anomaly acknowledgment UI
│           ├── AnomalyTrackedFunnelsConfig.tsx  # superadmin config UI
│           └── __tests__/
├── lib/
│   ├── admin/
│   │   ├── bulk-actions.ts                  # client wrappers for sync RPC + async polling
│   │   ├── palette-recent.ts                # SECDEF RPC client
│   │   └── aal2-freshness.ts                # JWT inspection + step-up trigger
│   ├── cohort/
│   │   ├── rule-tree-schema.ts              # zod schema (ONE source of truth)
│   │   ├── rule-tree-to-sql.ts              # recursive TS translator (Edge Fn side)
│   │   └── field-allowlist.ts               # 15-field const + type guard
│   └── anomaly/
│       └── realtime-channel.ts              # AdminLayout subscribe helper
└── …
supabase/
├── migrations/
│   ├── 20260601000001_admin_bulk_jobs.sql
│   ├── 20260601000002_cohort_definitions.sql
│   ├── 20260601000003_cohort_membership_matview.sql
│   ├── 20260601000004_anomaly_tracked_funnels.sql
│   ├── 20260601000005_funnel_anomaly_alerts.sql
│   ├── 20260601000006_bulk_action_undo_token.sql
│   ├── 20260601000007_admin_bulk_action_execute_rpc.sql
│   ├── 20260601000008_cohort_rpcs.sql
│   ├── 20260601000009_admin_palette_recent_rpc.sql
│   ├── 20260601000010_funnel_anomaly_baseline_compute.sql
│   ├── 20260601000011_funnel_anomaly_acknowledge_rpc.sql
│   ├── 20260601000012_cohort_matview_refresh_cron.sql
│   ├── 20260601000013_funnel_anomaly_cron.sql
│   └── 20260601000014_undo_token_purge_cron.sql
└── functions/
    ├── admin-bulk-job-worker/
    ├── funnel-anomaly-cron/
    └── _shared/
        └── (reuses Phase 24 posthog-server.ts + Phase 25 email-router.ts)
```

(Migration timestamps use `20260601` as placeholder — planner picks final timestamps; remember strict 14-digit per `[[reference_supabase_migration_filename_regex]]`.)

### Pattern 1: cmdk Command.Dialog with Cmd+K listener

**What:** Headless command palette with overlay, accessible combobox semantics, keyboard nav.
**When to use:** Single mount in AdminLayout (or AdminShell) — listens for Cmd+K globally; closes on Esc; emits onSelect for chosen item.

```tsx
// Source: /dip/cmdk Context7 — verified 2026-05-17
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';

export function CommandPalette({ adminRole }: { adminRole: AdminRole }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Admin command palette">
      <Command.Input placeholder="Type a command or search…" />
      <Command.List>
        <Command.Empty>No results.</Command.Empty>
        <Command.Group heading="Modules">
          {ADMIN_MODULES
            .filter((m) => hasMinRole(adminRole, m.minRole))
            .map((m) => (
              <Command.Item key={m.key} onSelect={() => { location.hash = `/admin/${m.route}`; setOpen(false); }}>
                <m.icon size={16} aria-hidden /> {m.label}
              </Command.Item>
            ))}
        </Command.Group>
        {/* Group 2: lazy-loaded recent items; Group 3: quick actions (with aal2 gate) */}
      </Command.List>
    </Command.Dialog>
  );
}
```

### Pattern 2: Cohort rule-tree → SQL WHERE (recursive TS translator)

**What:** Walk the JSONB rule tree; emit parameterized SQL fragments; combine with AND/OR per branch node.
**When to use:** Edge Function that refreshes the matview reads each active cohort_definition, calls translator, builds full INSERT-SELECT for matview population.

```typescript
// src/lib/cohort/rule-tree-to-sql.ts — example
// Source: hand-rolled per D-05; defense-in-depth via field allowlist enum
import { z } from 'zod';
import { FIELD_ALLOWLIST, type AllowedField } from './field-allowlist';

const LeafSchema = z.object({
  field: z.enum(FIELD_ALLOWLIST),
  op: z.enum(['=', '!=', '>', '<', '>=', '<=', 'in', 'is_null', 'is_not_null']),
  value: z.unknown(),
});
type Branch = { op: 'and' | 'or'; children: RuleNode[] };
type Leaf = z.infer<typeof LeafSchema>;
type RuleNode = Branch | Leaf;

const BranchSchema: z.ZodType<Branch> = z.lazy(() =>
  z.object({
    op: z.enum(['and', 'or']),
    children: z.array(z.union([LeafSchema, BranchSchema])).min(1).max(50),
  })
);
const RuleNodeSchema: z.ZodType<RuleNode> = z.union([LeafSchema, BranchSchema]);

const MAX_DEPTH = 8; // DoS prevention

export function ruleTreeToSql(node: RuleNode, depth = 0): { sql: string; params: unknown[] } {
  if (depth > MAX_DEPTH) throw new Error('RULE_TREE_TOO_DEEP');
  if ('children' in node) {
    const parts = node.children.map((c) => ruleTreeToSql(c, depth + 1));
    const sql = `(${parts.map((p) => p.sql).join(` ${node.op.toUpperCase()} `)})`;
    return { sql, params: parts.flatMap((p) => p.params) };
  }
  // Leaf — field allowlist enforced by zod enum; op enforced by zod enum
  const col = `p.${node.field}`; // p = profiles alias; allowlist guarantees safe column name
  switch (node.op) {
    case 'is_null': return { sql: `${col} IS NULL`, params: [] };
    case 'is_not_null': return { sql: `${col} IS NOT NULL`, params: [] };
    case 'in':
      if (!Array.isArray(node.value)) throw new Error('IN_VALUE_NOT_ARRAY');
      return { sql: `${col} = ANY($${'placeholder'}::text[])`, params: [node.value] };
    default:
      return { sql: `${col} ${node.op} $${'placeholder'}`, params: [node.value] };
  }
  // NOTE: real impl uses an indexed-placeholder counter — pseudo-code above for clarity
}

// Defense in depth — also re-validate field name at the SECDEF RPC layer in plpgsql
// using a hardcoded CHECK against the allowlist; if either layer disagrees, reject.
```

### Pattern 3: pg_cron schedule with HTTP POST to Edge Function

**What:** Cron tick calls Edge Function via `net.http_post` with service-role auth from Vault.
**When to use:** `funnel-anomaly-cron` (5min); `admin-bulk-job-worker` (poll alternative — could also run on Vercel Cron or be SQS-driven; this project uses pg_cron + Edge Fn per Phase 24 precedent).

```sql
-- Source: derived from Phase 24 Plan 24-01 cron pattern (verified) — 2026-05-17
select cron.schedule(
  'funnel-anomaly-cron',
  '0,5,10,15,20,25,30,35,40,45,50,55 * * * *',
  $$
  select net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/funnel-anomaly-cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('source','cron')
  )
  $$
);
```

**Single-instance overlap protection:** `[CITED: pg_cron docs]` "only one instance of each specific job at a time. If a second instance is triggered before the first finishes, it's queued." So if a 5-min anomaly run takes 7 min, the next tick queues — no double-fire. Acceptable for the 5-min SC#5 SLA (worst case alert latency = 10 min after detection if cron is congested).

### Pattern 4: REFRESH MATERIALIZED VIEW CONCURRENTLY for cohort_membership

**What:** Non-blocking matview rebuild on 15-min cron tick.
**When to use:** `cohort-matview-refresh` cron; consumers (PAYWALL, RECOMMEND, SAVE, GAME, TAXO) read from matview in steady state.

```sql
-- Source: https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html — verified 2026-05-17
-- REQUIREMENT: at least one UNIQUE index using ONLY column names (no expressions, no WHERE).
-- The D-07 (user_id, cohort_id) PRIMARY KEY satisfies this.

create materialized view public.cohort_membership as
  select … (populated by INSERT-SELECT derived from active cohort_definitions via rule-tree translator) …
with no data;

-- Required unique index for CONCURRENTLY refresh:
create unique index cohort_membership_pk on public.cohort_membership(user_id, cohort_id);

-- Index for the consumer-side hot read (sub-50ms p99 per SC#4):
-- The unique index above already covers (user_id, cohort_id) lookups.

-- Cron entry:
select cron.schedule(
  'cohort-matview-refresh',
  '*/15 * * * *',
  $$ refresh materialized view concurrently public.cohort_membership $$
);
```

**Initial population gotcha:** matview created WITH NO DATA must be populated by a first non-concurrent `refresh materialized view` BEFORE the CONCURRENT version can run. Plan 27-02 ships this as a 2-step migration (CREATE → REFRESH non-concurrent → enable cron).

### Pattern 5: Hybrid same-DOW + same-HOD baseline (Postgres window functions)

**What:** Compute blended baseline for funnel anomaly detection.
**When to use:** `funnel_anomaly_baseline_compute(event_name)` SECDEF function called by the 5-min cron.

```sql
-- Source: hand-rolled per D-15; verified against Postgres docs for STDDEV_SAMP + window-frame semantics
-- (no Context7 hit for this specific pattern — it's bespoke statistics)
create or replace function public.funnel_anomaly_baseline_compute(p_event_name text)
returns table (
  observed_count int,
  expected_mean numeric,
  expected_stddev numeric,
  z_score numeric
)
language sql
security definer
set search_path = extensions, public, pg_temp
as $$
  with last_24h as (
    select count(*)::int as cnt
    from public.events
    where event_name = p_event_name
      and created_at >= now() - interval '24 hours'
  ),
  same_hod_7d as (  -- same hour-of-day across last 7 days (excluding the live 24h window)
    select date_trunc('day', created_at) as d, count(*)::int as cnt
    from public.events
    where event_name = p_event_name
      and created_at between now() - interval '8 days' and now() - interval '1 day'
      and extract(hour from created_at) = extract(hour from now())
    group by 1
  ),
  same_dow_4w as (  -- same day-of-week across last 4 weeks
    select date_trunc('day', created_at) as d, count(*)::int as cnt
    from public.events
    where event_name = p_event_name
      and created_at between now() - interval '29 days' and now() - interval '1 day'
      and extract(dow from created_at) = extract(dow from now())
    group by 1
  ),
  hod_stats as (
    select avg(cnt)::numeric as m, coalesce(stddev_samp(cnt), 0)::numeric as s from same_hod_7d
  ),
  dow_stats as (
    select avg(cnt)::numeric as m, coalesce(stddev_samp(cnt), 0)::numeric as s from same_dow_4w
  )
  select
    (select cnt from last_24h)                                              as observed_count,
    (0.4 * (select m from hod_stats) + 0.6 * (select m from dow_stats))    as expected_mean,
    (0.4 * (select s from hod_stats) + 0.6 * (select s from dow_stats))    as expected_stddev,
    case
      when (0.4 * (select s from hod_stats) + 0.6 * (select s from dow_stats)) = 0 then 0
      else ((select cnt from last_24h) - (0.4 * (select m from hod_stats) + 0.6 * (select m from dow_stats)))
        / (0.4 * (select s from hod_stats) + 0.6 * (select s from dow_stats))
    end                                                                     as z_score;
$$;
```

Edge Function tick logic:
```typescript
// For each enabled tracked funnel:
const { data } = await sb.rpc('funnel_anomaly_baseline_compute', { p_event_name: funnel.event_name });
if (data.z_score < -funnel.sigma_threshold) {
  // Check 4h suppression
  const { data: last } = await sb.from('funnel_anomaly_alerts')
    .select('fired_at').eq('funnel_id', funnel.funnel_id)
    .order('fired_at', { ascending: false }).limit(1).single();
  if (!last || (Date.now() - new Date(last.fired_at).getTime()) > 4 * 60 * 60 * 1000) {
    // INSERT alert row + Realtime broadcast + email send (vendor-gated)
  }
}
```

### Pattern 6: Supabase Auth aal2 freshness check

**What:** Verify the current session is at AAL2 AND was challenged within the last 15 min.
**When to use:** Before any destructive palette quick-action (D-12).

```typescript
// src/lib/admin/aal2-freshness.ts
import { supabase } from '@/lib/supabase';

const AAL2_FRESHNESS_MS = 15 * 60 * 1000; // D-12: 15-minute window

export async function isAal2Fresh(): Promise<boolean> {
  // [CITED: Supabase docs — mfa.getAuthenticatorAssuranceLevel verified 2026-05-17]
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== 'aal2') return false;

  // Freshness — JWT `auth_time` claim is the unix epoch when the most recent AAL2 challenge succeeded.
  // [ASSUMED: Supabase JWT shape includes `auth_time` per OIDC convention — verify by decoding a fresh aal2 JWT at implementation time;
  //  if absent, fall back to tracking last-challenge timestamp in sessionStorage when challengeAndVerify resolves.]
  const { data: sess } = await supabase.auth.getSession();
  const jwt = sess?.session?.access_token;
  if (!jwt) return false;
  const payload = JSON.parse(atob(jwt.split('.')[1]));
  const authTimeMs = (payload.auth_time ?? payload.iat ?? 0) * 1000;
  return Date.now() - authTimeMs < AAL2_FRESHNESS_MS;
}

export async function requireAal2Fresh(onStepUp: () => Promise<void>) {
  if (await isAal2Fresh()) return;
  await onStepUp(); // UI prompts mfa.challengeAndVerify modal
}
```

**Caveat:** Phase 24 D-09 locks "every-session step-up — no trust cookie", which means aal2 happens once per sign-in. The 15-min freshness window in P27 D-12 is ADDITIONAL: even within a signed-in admin session, a destructive palette action older than 15 min from the most recent challenge demands a fresh challenge. Verify the actual JWT shape at Plan 27-03 implementation — if `auth_time` isn't surfaced, store the timestamp client-side on each successful `mfa.challengeAndVerify` resolution.

### Anti-Patterns to Avoid

- **Defensive jsonb contracts in plpgsql duplicating the TS validator** (per `[[feedback_planner_iter1_anti_patterns]]`) — define the cohort rule-tree shape ONCE in `src/lib/cohort/rule-tree-schema.ts` (zod); the SECDEF RPC re-validates using a hardcoded plpgsql allowlist check (NOT a parallel JSON-schema validator). Two layers, one source of shape truth.
- **Hand-rolling fuzzy search inside cmdk** — cmdk ships an internal default scorer; only customize via `filter` prop if needed. Don't bring in fuse.js as a second scorer.
- **Storing undo state in localStorage** — undo state must be server-tokened (`bulk_action_undo_token` row) so that closing the tab doesn't make the action irreversible; and so that the reverse RPC can validate the token wasn't tampered with.
- **Polling matview refresh status from client** — matview refresh is a DB-internal operation; clients query the matview directly; refresh failures alert via the standard `[[feedback_status_machine_transition_owner]]` cron-failure pattern (cron job exit-code != 0 → audit_logs row → admin banner).
- **Subscribing to Realtime channel inside every admin sub-route** — subscribe ONCE at AdminLayout (or AdminShell) level; rebroadcast via Zustand store to children. Multiple subscriptions waste websocket frames and break the 4h suppression heuristic at the UI layer (some banners would flash for already-resolved alerts).
- **Vercel Cron for anomaly tick** — `funnel-anomaly-cron` MUST stay in pg_cron so it co-locates with the SQL query that computes baseline; Vercel Cron adds a network hop with no upside.
- **Direct `service_role` writes to audit_logs from Edge Functions** — Phase 24 D-17 REVOKEs INSERT on `audit_logs` from service_role; all P27 RPCs go through `log_admin_action` SECDEF function which is the only privileged write path.
- **Per-tab Realtime channel subscriptions on the `funnel_anomaly_alerts` table directly** — subscribe to the named broadcast channel (push from Edge Fn), NOT to postgres_changes on the table. Direct table subscription would emit one event per admin per alert per tab — banner duplication.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Command palette with fuzzy search + keyboard nav + ARIA combobox | Custom Modal + filter + onKeyDown | **cmdk** | Radix-blessed; <hundred bytes of accessibility audit work saved; React 19 peer verified |
| Matview rebuild + non-blocking reads | Trigger-based incremental sync OR app-level cache | **Postgres `refresh materialized view concurrently`** | Native; correctness is Postgres's problem, not ours; cron tick is one line of SQL |
| Cron scheduler with overlap protection | Vercel Cron + Redis lock | **pg_cron** (single-instance protection built-in) | Already in Supabase Pro; no extra vendor; lock is automatic per pg_cron docs |
| 60-second TTL on undo tokens | Edge function with setTimeout OR Redis TTL | **Postgres row + 1-min pg_cron purge** | Survives Edge Function cold starts; auditable; trivial query |
| JSONB tree validation | Hand-rolled type guards | **zod with `z.lazy()` recursive schema** | Already in stack; supports recursion + max depth via `.refine()` |
| Statistical baseline blending (mean/stddev/z-score) | Custom JavaScript in Edge Fn | **Postgres `STDDEV_SAMP` + window functions** | Computed inside the DB — one round-trip; consistent across cron + ad-hoc admin queries |
| Realtime in-app banner push | Polling /admin/api/anomaly endpoint | **Supabase Realtime broadcast channel** | Already in stack; admin's browser receives event in <500ms; battery-cheap |
| Email send for anomaly alerts | Direct Resend SDK call | **Phase 25 `_shared/email-router.ts`** | One templated path with PHI-routing already wired; vendor-gated via health check per `[[reference_vendor_gated_send_health_check]]` |
| TOTP step-up challenge | Custom OTP UI | **Supabase Auth `mfa.challengeAndVerify`** | Already used in Phase 24 D-07; ES256 / aal2 already-wired |
| Audit log row writes | Custom INSERT INTO audit_logs | **Phase 24 `log_admin_action(...)` SECDEF RPC** | Only privileged write path; Phase 24 RLS REVOKEs direct INSERT |

**Key insight:** Phase 27 is almost entirely composition of existing primitives (Phase 24 audit_logs + admin shell, Phase 25 email-router, Supabase Realtime, pg_cron, Postgres matview, cmdk). The risky surface is the **cohort rule-tree shape contract** (TS ↔ SQL boundary) and the **aal2 freshness mechanic** (depends on JWT internals). All other plans are CRUD-shaped.

## Common Pitfalls

### Pitfall 1: REFRESH CONCURRENTLY requires UNIQUE index with NO expressions and NO WHERE clause

**What goes wrong:** Migration creates `cohort_membership` matview with a partial unique index `where joined_at is not null` — `refresh materialized view concurrently` errors at runtime with `cannot refresh materialized view "public.cohort_membership" concurrently`.
**Why it happens:** Postgres requires the unique index to cover ALL rows of the matview. Partial indexes (with WHERE) and expression indexes (e.g., `lower(email)`) disqualify the matview from concurrent refresh.
**How to avoid:** D-07 PK `(user_id, cohort_id)` is already plain column-only — keep it that way. If a planner adds a second unique index later, ensure it's column-only too. Per `[[reference_supabase_migration_gotchas]]` — partial-index expressions must be IMMUTABLE; for matview concurrency they must also be ABSENT.
**Warning signs:** Migration succeeds (CREATE MATERIALIZED VIEW + CREATE UNIQUE INDEX both pass); cron job fails on the first 15-min tick. Audit cron failures via the cron-failure alert pattern.

### Pitfall 2: First matview refresh must NOT use CONCURRENTLY

**What goes wrong:** Migration ships `create materialized view ... with no data`, then immediately enables the `*/15 * * * *` cron. First cron tick errors: `cannot refresh materialized view "public.cohort_membership" concurrently — view has not been populated yet`.
**Why it happens:** `WITH NO DATA` matviews must be populated by a non-concurrent `refresh materialized view` once before the concurrent path becomes valid.
**How to avoid:** Plan 27-02 migration does `create materialized view ... with no data; refresh materialized view public.cohort_membership; -- non-concurrent first` BEFORE registering the cron.
**Warning signs:** First scheduled cron tick fails; subsequent ticks succeed.

### Pitfall 3: pg_cron schedule collision risk on top-of-hour ticks

**What goes wrong:** 4 existing v1.3 crons + 3 new P27 crons → potential lock contention on `audit_logs` writes or matview refresh during the same window.
**Why it happens:** Audit-archive (P24, day-1 03:00), BAA expiry (P25, day-1 06:00), subprocessor-diff (P25, Mon 07:00), affiliate-lifetime-recurring (P26, day-1 03:00) are all month/week-scale; P27 adds cohort-matview-refresh `*/15`, funnel-anomaly-cron `*/5`, undo-purge `*/1`. The `*/15` and `*/5` align at `:00, :15, :30, :45` — triple-fire collision potential.
**How to avoid:** Stagger P27 schedules. Recommended: anomaly `0,5,10,15,20,25,30,35,40,45,50,55 * * * *` (every 5 — D-16 already locks this); matview refresh `7,22,37,52 * * * *` (every 15, offset +7 — NOT `*/15` literal); undo-purge `*/1 * * * *` (1-minute, fine — short-running). This eliminates triple-fire on the quarter-hour boundary.
**Warning signs:** Audit-log latency spikes at :00 and :15 marks; Supabase metrics dashboard shows query queueing.

### Pitfall 4: Cohort rule-tree validator drift between TS and plpgsql

**What goes wrong:** Frontend TS validator accepts `field='custom_field_xyz'` because dev added it to the enum on the TS side; SECDEF RPC's plpgsql allowlist check rejects it; matview refresh skips the cohort silently; consumer reads see empty membership.
**Why it happens:** D-06 lists 15 fields; both layers maintain a copy; copies drift.
**How to avoid:** Generate the plpgsql allowlist FROM the TS enum at build time (codegen step in CI). Migration that creates the SECDEF RPC reads from a generated `.sql` snippet committed alongside `src/lib/cohort/field-allowlist.ts`. Per `[[feedback_planner_iter1_anti_patterns]]` — defensive jsonb contracts duplicated in plpgsql are an anti-pattern.
**Warning signs:** Cohort defined in UI; matview rebuilds successfully; consumer query returns zero rows even though the audit-trail shows users matching the cohort criteria.

### Pitfall 5: aal2 freshness JWT claim may not exist on Supabase Auth

**What goes wrong:** `isAal2Fresh()` reads `payload.auth_time` from the JWT; field doesn't exist; always returns false; admin re-prompted for TOTP on every palette destructive action.
**Why it happens:** Supabase Auth docs verify `mfa.getAuthenticatorAssuranceLevel()` returns `{currentLevel, nextLevel}` but `[ASSUMED]` the JWT contains `auth_time`. The OIDC spec defines this claim; Supabase may or may not surface it.
**How to avoid:** At Plan 27-03 implementation, decode a fresh `aal2` JWT (after `mfa.challengeAndVerify`) and verify `auth_time` is present. If absent, store `localStorage['leanshot_aal2_last_verified']` timestamp on each successful challengeAndVerify resolve. This is a client-side timestamp (less defensible than JWT-issued) but acceptable given the 15-min window is UX guidance, not a security boundary (the security boundary is `currentLevel === 'aal2'` per Phase 24 D-09).
**Warning signs:** Every palette destructive action prompts TOTP within the same session.

### Pitfall 6: Realtime channel subscription leaks across React StrictMode mounts

**What goes wrong:** AdminLayout subscribes to `funnel_anomaly_alerts` channel in `useEffect`; React StrictMode double-mounts in dev; subscriptions duplicate; anomaly banner shows twice.
**Why it happens:** Supabase Realtime channel API requires explicit `unsubscribe` on effect cleanup; missing or improperly returned cleanup leaks the channel.
**How to avoid:** Effect MUST return `() => { channel.unsubscribe(); }`. Test in StrictMode (vitest + RTL) by asserting only one `console.log('anomaly received')` per emit. Per `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant verification via direct channel.subscribe() in the test, NOT UI traversal.
**Warning signs:** Banner duplication in dev; in prod, doubled email send if the same Edge Fn tick triggers two broadcasts.

### Pitfall 7: Bulk action async path can lose progress on Edge Function cold start

**What goes wrong:** Admin queues 5000-user bulk ban; `admin-bulk-job-worker` Edge Function processes rows in batches of 50; cold-start kills the function at row 2347; `admin_bulk_jobs.rows_completed` stuck at 2300 (last committed batch); user re-runs the job → 4900 users banned twice.
**Why it happens:** Edge Functions have a max execution time (Supabase: 150s for Pro, 400s for Team); large bulk jobs exceed this; partial completion + re-run = duplicate work.
**How to avoid:** (a) Worker claims jobs with `update admin_bulk_jobs set status='running', claimed_at=now() where status='pending' and (claimed_at is null or claimed_at < now() - interval '5 minutes') returning *` (SQS-style claim with stale-claim recovery). (b) Inside the worker, EACH affected user write is idempotent (e.g., `update profiles set account_state='banned' where id=$1 and account_state != 'banned'` — no-op if already banned). (c) Audit-log writes use a uniqueness key on `(job_id, target_user_id)` so re-runs don't double-audit. (d) Worker checkpoints `rows_completed` after each batch of 50.
**Warning signs:** Bulk job status flickers between pending/running; rows_completed jumps backward on retry.

### Pitfall 8: Cohort matview rebuild time grows non-linearly with cohort count × profile count

**What goes wrong:** At v1.3 launch, 5 cohorts × 10k profiles = ~50k matview rows; refresh takes 1.2s. By Phase 39 PAYWALL ships, 25 cohorts × 100k profiles = ~2.5M rows; refresh takes 45s and overlaps with the next tick.
**Why it happens:** Single matview rebuild per tick (D-08) is fastest at v1 scale but doesn't scale linearly when each tick re-evaluates every cohort's rule-tree against every profile.
**How to avoid:** Add a cron-failure alert at >60s refresh time (Claude's Discretion per CONTEXT.md). When the alert fires, switch to per-cohort matviews OR move evaluation to incremental-trigger model (deferred per CONTEXT.md "Per-cohort matview refresh — revisit at cohort count >50"). Plan 27-02 ships a metric in the cron exit handler.
**Warning signs:** Cron `*/15` ticks start queueing (pg_cron's single-instance lock visible in `cron.job_run_details`).

## Runtime State Inventory

> Phase 27 is greenfield code/schema — no rename, refactor, or migration of existing data. Omit Runtime State Inventory per instructions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase pg_cron | All 3 new crons (D-22) | ✓ | bundled with Supabase Pro | — |
| Supabase pg_net | Cron HTTP calls to Edge Fns | ✓ | already enabled per Phase 24 Plan 24-01 | — |
| Supabase Realtime | Anomaly banner broadcast (D-17) | ✓ | already used by v1.2 affiliate updates | — |
| Supabase Vault | Service-role key for cron HTTP auth | ✓ (post-Phase-24 user_setup) | already populated as `SUPABASE_SERVICE_ROLE_KEY` | — |
| Supabase Storage `audit-archive` bucket | Not P27 (Phase 24 only) | ✓ | provisioned in P24 Wave 0 | — |
| Phase 24 `log_admin_action` RPC | Per-row audit on bulk + cohort + palette + anomaly | ✓ (after P24 Plan 24-01 ships) | — | — |
| Phase 24 `ADMIN_MODULES` manifest | Palette static index | ✓ (after P24 Plan 24-03 ships) | — | — |
| Phase 24 `admin_role` enum + `is_admin_at_least(min_role)` | RPC gating | ✓ (after P24 Plan 24-01 ships) | — | — |
| Phase 24 PostHog `disable_session_recording_on_url` regex for `/admin/*` | Privacy on palette open (D-12 step-up TOTP form rendered in DOM) | ✓ (P24 D-12 covers via PHI gate; P25 D-16 explicit) | — | — |
| Phase 25 `_shared/email-router.ts` | Anomaly alert email (D-17) | ⚠ vendor-gated | net-new in Phase 25 | Wrap in `[[reference_vendor_gated_send_health_check]]` — if Resend domain unverified, log warning + skip email; banner still fires |
| `SUPERADMIN_ALERTS_EMAIL` env var | Email recipient (D-17) | ⚠ new env | — | Hardcode founder's email at Phase 27 plan-time as Edge Function secret; rotate via Supabase Function Secrets later |
| cmdk `1.1.1` | Palette UI (D-10) | ✗ (new install) | — | None — D-10 locks the library choice; install before Plan 27-03 |
| Phase 26 admin role `superadmin` tier (already in P24 enum) | Anomaly tracked-funnels config + cohort archive + bulk-action approval | ✓ | — | — |

**Missing dependencies with fallback:**
- Phase 25 email-router not yet verified by P27 ship → vendor-gated health-check stub that logs WARNING when Resend domain unverified. Banner still fires (acceptable degradation).

**Missing dependencies with no fallback:**
- cmdk package install — trivial; included in Plan 27-03 must-haves.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^4.1.5` (existing, configured) |
| Config file | `vitest-e2e.config.ts`, `vitest-mobile.config.ts` (existing) — for unit tests, default `vitest.config.ts` should exist or be created during Phase 24 |
| Quick run command | `npm test -- src/lib/cohort/__tests__ --run` |
| Full suite command | `npm test` (runs vitest then playwright) |
| Playwright config | `playwright.config.ts` (existing) — used for e2e |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-04 (SC#1) | Bulk action on Members → confirmation modal → audit_logs row per user | integration (DB) | `npm test -- src/lib/admin/__tests__/bulk-actions-audit.test.ts --run` | ❌ Wave 0 |
| ADMIN-04 sync ≤100 | Sync RPC executes inline + writes N audit rows in tx | integration | `npm test -- src/lib/admin/__tests__/bulk-action-sync.test.ts --run` | ❌ Wave 0 |
| ADMIN-04 async >100 | Edge Fn worker claims job + checkpoints rows_completed | integration | `npm test -- src/lib/admin/__tests__/bulk-action-async.test.ts --run` | ❌ Wave 0 |
| ADMIN-04 undo 60s | Undo token valid for 60s + reverse RPC writes new audit row | integration | `npm test -- src/lib/admin/__tests__/bulk-action-undo.test.ts --run` | ❌ Wave 0 |
| ADMIN-05 (SC#2) | Define cohort → matview populates → consumer reads sub-50ms | integration + perf | `npm test -- src/lib/cohort/__tests__/cohort-define-and-read.test.ts --run` | ❌ Wave 0 |
| ADMIN-05 rule-tree validator | zod schema rejects malformed trees (depth >8, non-allowlisted field) | unit | `npm test -- src/lib/cohort/__tests__/rule-tree-schema.test.ts --run` | ❌ Wave 0 |
| ADMIN-05 SQL translator | Recursive AND/OR + leaf ops emit correct parameterized SQL | unit | `npm test -- src/lib/cohort/__tests__/rule-tree-to-sql.test.ts --run` | ❌ Wave 0 |
| ADMIN-06 (SC#3) | Cmd+K opens palette, ↑↓ navigates, ⏎ executes, Esc closes | e2e (Playwright) | `npx playwright test e2e/admin-palette.spec.ts` | ❌ Wave 0 |
| ADMIN-06 aal2 step-up | Destructive action when freshness >15min prompts TOTP challenge | integration | `npm test -- src/components/admin/palette/__tests__/PaletteAal2Gate.test.tsx --run` | ❌ Wave 0 |
| TAXO-03 matview refresh | `refresh materialized view concurrently` succeeds with PK unique index | DB | `supabase db query --linked --sql "refresh materialized view concurrently public.cohort_membership;"` | ❌ Wave 0 |
| TAXO-03 (SC#4) sub-50ms p99 | Consumer query p99 latency under 50ms | perf | `npm test -- src/lib/cohort/__tests__/cohort-read-perf.test.ts --run` (k6 or custom benchmark — verify via Wave 0) | ❌ Wave 0 |
| TAXO-05 (SC#5) anomaly fires <5min | Inject drop, cron tick, alert appears in admin UI within 5min | e2e + realtime | `npx playwright test e2e/anomaly-banner.spec.ts` + DB-level via `[[feedback_realtime_layer_e2e_pattern]]` | ❌ Wave 0 |
| TAXO-05 baseline blend | Hybrid DOW+HOD blend math is correct on seed data | unit (SQL) | `npm test -- src/lib/anomaly/__tests__/baseline-compute.test.ts --run` (calls RPC against seed) | ❌ Wave 0 |
| TAXO-05 suppression 4h | Second flag within 4h is suppressed | integration | `npm test -- src/lib/anomaly/__tests__/suppression.test.ts --run` | ❌ Wave 0 |
| audit_logs append-only | All Phase 27 RPCs write via log_admin_action (no direct INSERT) | integration | `npm test -- src/lib/admin/__tests__/p27-audit-write-path.test.ts --run` (asserts service_role denied direct INSERT) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- <relevant test path> --run` (sub-second for unit; <30s for integration)
- **Per wave merge:** `npm test` (full vitest + playwright, ~2-5min)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/admin/__tests__/bulk-actions-audit.test.ts` — covers ADMIN-04 SC#1
- [ ] `src/lib/admin/__tests__/bulk-action-sync.test.ts` — covers ADMIN-04 sync path
- [ ] `src/lib/admin/__tests__/bulk-action-async.test.ts` — covers ADMIN-04 async path
- [ ] `src/lib/admin/__tests__/bulk-action-undo.test.ts` — covers ADMIN-04 undo
- [ ] `src/lib/admin/__tests__/p27-audit-write-path.test.ts` — covers append-only RLS posture
- [ ] `src/lib/cohort/__tests__/cohort-define-and-read.test.ts` — covers ADMIN-05 + TAXO-03 SC#2
- [ ] `src/lib/cohort/__tests__/rule-tree-schema.test.ts` — covers rule-tree validator
- [ ] `src/lib/cohort/__tests__/rule-tree-to-sql.test.ts` — covers translator
- [ ] `src/lib/cohort/__tests__/cohort-read-perf.test.ts` — covers sub-50ms p99
- [ ] `src/components/admin/palette/__tests__/PaletteAal2Gate.test.tsx` — covers aal2 step-up
- [ ] `src/lib/anomaly/__tests__/baseline-compute.test.ts` — covers baseline math
- [ ] `src/lib/anomaly/__tests__/suppression.test.ts` — covers 4h window
- [ ] `e2e/admin-palette.spec.ts` — covers Cmd+K e2e flow (Playwright)
- [ ] `e2e/anomaly-banner.spec.ts` — covers SC#5 realtime banner
- [ ] vitest unit config (`vitest.config.ts`) — verify exists after Phase 24 ships; if not, Plan 27-01 user_setup includes init
- [ ] RLS test fixture pattern — reuse `src/lib/admin/__tests__` pattern from Phase 24 Plan 24-01 (admin.generateLink + /auth/v1/verify per `[[reference_rls_fixture_gotruechient_flake]]`)

## Security Domain

`security_enforcement` is enabled by default — including this section.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (existing); aal2 step-up via `mfa.challengeAndVerify` for destructive palette actions (D-12) |
| V3 Session Management | yes | Phase 24 D-09 every-session aal2 step-up; Phase 27 adds 15-min freshness for destructive |
| V4 Access Control | yes | `is_admin_at_least(min_role)` SECDEF guard on every P27 RPC; admin_bulk_action_execute reads admin_role + aal2 freshness |
| V5 Input Validation | yes | **zod for rule-tree (recursive, depth-capped, field allowlist enum); plpgsql allowlist re-check at SECDEF RPC** — defense in depth |
| V6 Cryptography | no | No new crypto in P27; aal2/TOTP uses Supabase Auth (Phase 24) |
| V8 Data Protection | yes | audit_logs append-only RLS (P24 carry); same posture on funnel_anomaly_alerts + admin_bulk_jobs |
| V11 Business Logic | yes | Bulk action async idempotency `(job_id, target_user_id)`; cohort matview consumer sub-50ms read; anomaly suppression 4h |
| V13 API & Web Service | yes | 7 SECDEF RPCs — all gated by is_admin_at_least + (where destructive) aal2 freshness |

### Known Threat Patterns for {Supabase + cmdk + Postgres + Edge Fns}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via cohort rule-tree field name | Tampering | zod enum allowlist (15 fields) — field strings NEVER interpolated raw; column name pulled from a static map keyed by the enum |
| SQL injection via cohort rule-tree value | Tampering | Parameterized SQL — `value` always bound as `$N`, never string-concatenated |
| Bulk action mass-deletion or mass-ban abuse | Tampering + Elevation | (1) is_admin_at_least('admin') for execute; (2) aal2 freshness <15min; (3) 10K hard cap (D-01); (4) every action audit-logged per-user |
| Undo token forgery | Tampering | Token is uuid stored server-side; reverse RPC validates token exists + not expired + same actor |
| Palette destructive action via stolen session cookie | Spoofing | aal2 step-up forces fresh TOTP challenge within 15 min — attacker can't satisfy without TOTP secret |
| Realtime channel poisoning (admin sees fake banner) | Tampering | Anomaly broadcast uses Supabase Realtime broadcast with RLS-gated channel; only Edge Fn (service_role) can push; subscribers only `admin_role >= admin` |
| Cohort matview enumeration revealing user PII | Information Disclosure | matview rows are `(user_id, cohort_id, joined_at)` only — no PHI; consumer query is admin-only via SECDEF |
| pg_cron job hijack via mutation of cron.job | Elevation | cron.job table is owner-only; Supabase manages owner; no direct admin access |
| Anomaly email leakage of user data | Information Disclosure | Non-PHI template — funnel name + counts only; no user IDs or PII in alert payload (D-17) |
| Recursive rule-tree DoS | Denial of Service | zod `.max(50)` on children array; MAX_DEPTH=8 enforced in translator; both layers fail fast |
| Bulk async job stuck pending (worker dead) | Availability | Stale-claim recovery — claim WHERE `claimed_at < now() - interval '5 minutes'` allows another worker to pick up |
| Aal2 freshness bypass via JWT replay | Spoofing | JWT signed by Supabase; `auth_time` claim is server-issued; replay protection is JWT-standard (exp + iat) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase Auth JWT includes `auth_time` claim from OIDC | Pattern 6 (aal2 freshness) | Medium — fall back to client-side timestamp in localStorage on each successful challengeAndVerify; security boundary remains `currentLevel === 'aal2'` (defensible) |
| A2 | Postgres `events` table exists at Phase 27 with `(event_name, created_at)` indexed | Pattern 5 (baseline compute) | Low — Phase 24 TAXO ships event taxonomy + server-side capture; the `events` table is the events_mirror (or PostHog server-side capture sink). If absent, baseline cron reads from PostHog REST API instead (slower; CONTEXT.md flagged this as researcher recommend — see Open Question 7) |
| A3 | cmdk 1.1.1 + 4 Radix deps total ≤ 18 kB gz when tree-shaken | Standard Stack §cmdk | Medium — first build measures actual; if over 30 kB ceiling, defer-lazy-load palette per Phase 24 D-18 |
| A4 | Phase 25 `_shared/email-router.ts` exposes a non-PHI Resend path callable from Edge Fn | Standard Stack §email-router | Low — D-03 explicitly locks Resend for non-PHI; signature is `sendEmail({to, template, props, phi: false})`. Vendor-gated via health-check fallback |
| A5 | Supabase Edge Fn timeout sufficient for bulk-async worker batch (50 rows × 4 RPCs per row ~10s) | Pattern 7 (async path) | Medium — Pro tier 150s; Team tier 400s. v1.3 ships on Pro until HIPAA tier upgrade in P25. Batch size 50 is conservative |
| A6 | pg_cron `cron.schedule` accepts the `0,5,10,15,...` explicit minute list syntax | Pattern 3 (cron schedule) | Low — standard cron syntax; D-16 already locks this format |
| A7 | Phase 24 admin shell ships before Phase 27 begins (ADMIN_MODULES + log_admin_action + is_admin_at_least exist) | Environment Availability | High — Phase 27 cannot start without Phase 24; phase dependency declared in ROADMAP. If P24 slips, P27 blocks |
| A8 | Anomaly cron 5-min schedule satisfies SC#5 "<5 minutes from detection" under pg_cron single-instance overlap | Pattern 3 (cron) | Low — worst case alert latency = 10 min if cron tick takes 6 min (next tick queues 1 min). Acceptable per SC#5 wording which is "within 5 minutes" of detection, not "5 minutes after the funnel event itself" |

**If user confirms or rejects A1, A2, A5, A7** at discuss-phase or plan-checker iter-1, the assumed claims become locked decisions.

## Open Questions

1. **Does Supabase Auth JWT surface `auth_time` claim?** (A1 above)
   - What we know: `mfa.getAuthenticatorAssuranceLevel()` returns `{currentLevel, nextLevel}` (verified)
   - What's unclear: Whether the JWT itself contains `auth_time` per OIDC convention
   - Recommendation: Plan 27-03 implementation step 1 = decode a fresh aal2 JWT and verify; document outcome in Plan 27-03 SUMMARY

2. **What populates the events table queried by `funnel_anomaly_baseline_compute`?** (A2 above)
   - What we know: Phase 24 TAXO ships `_shared/posthog-server.ts` for server-side event capture
   - What's unclear: Does Phase 24 also ship a local `events_mirror` table (e.g., for adblock-immunity + queryability) OR does anomaly cron need to query PostHog REST API for event counts?
   - Recommendation: **Local `events_mirror` table is the right design** — adblock-immunity, queryable by SQL (no REST API quota), 4h rolling retention sufficient for baseline compute. If Phase 24 doesn't ship this, Plan 27-04 must (small slab — single table + trigger from each PostHog server-side capture site). Flag in plan-checker.

3. **dnd-kit vs hand-rolled for cohort visual builder?**
   - dnd-kit is already in stack (v1.2 Phase 15 page builder); rule-tree nesting could reuse it
   - Hand-rolled with click-to-add-child + delete buttons is simpler — no drag needed for "and/or" branches
   - Recommendation: Hand-roll v1; users add children via "+ AND" / "+ OR" buttons, drag only if a child needs reparenting (rare). Lower bundle cost.

4. **Should anomaly tracked-funnels config UI live in /admin/anomaly OR /admin/settings?**
   - Phase 24 D-05 lists Settings as a top-level module
   - Anomaly config is small (5 funnels at seed) but adding more is admin-superadmin only
   - Recommendation: New `/admin/anomaly` route as a sub-module of Audit Log OR new top-level module. Defer to plan-checker — both are acceptable; Plan 27-05 plans for `/admin/anomaly` as own surface.

5. **Realtime channel naming for funnel_anomaly_alerts** — broadcast channel name should be HMAC-keyed or per-admin?
   - Phase 28 V13-2 will require HMAC realtime channel naming for clinic org_id isolation
   - Phase 27 anomaly alerts are super-tenant — every admin gets the same alert
   - Recommendation: Channel name `funnel_anomaly_alerts` (literal, super-tenant); RLS gating is on the subscriber side via `admin_role >= admin` check before subscribe. Phase 28 will introduce HMAC keying for org-scoped channels; P27 doesn't need it.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled command palette UI | cmdk (Radix-based, headless) | cmdk 1.0 — 2024-03 | Accessibility audit + keyboard nav free; ~10 kB gz |
| Trigger-based cohort membership maintenance | pg_cron + refresh matview concurrently | Postgres 9.4+ matviews; CONCURRENTLY since 9.4 | Cheaper to operate; no trigger-cascade correctness burden |
| Vercel Cron for short-cadence DB-touching jobs | pg_cron (single-instance overlap protection built-in) | pg_cron on Supabase Pro+ since 2021 | One vendor; co-located with the SQL |
| App-level vector store for cohort membership | Postgres matview (cohort_membership) | — | Zero new infra; RLS-compatible |

**Deprecated/outdated:**
- React Context for palette state — cmdk uses internal state machine; no Context needed at component layer
- Polling for in-app alerts — Supabase Realtime broadcast handles push semantics natively

## Sources

### Primary (HIGH confidence)
- Context7 `/dip/cmdk` — Command.Dialog + Cmd+K listener + onSelect pattern (verified 2026-05-17)
- npm registry `cmdk` — version 1.1.1 latest, React 19 peer, Radix deps (verified `npm view cmdk` 2026-05-17)
- https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html — UNIQUE index requirement for CONCURRENTLY refresh
- https://github.com/citusdata/pg_cron — single-instance overlap protection (verified 2026-05-17)
- https://supabase.com/docs/guides/auth/auth-mfa/totp — `mfa.enroll/challenge/verify/getAuthenticatorAssuranceLevel` API surface
- Phase 24 Plan 24-01 — audit_logs DDL + log_admin_action SECDEF function (canonical reference)
- Phase 24 Plan 24-03 — ADMIN_MODULES manifest shape (palette index source)
- Phase 25 D-03 — Resend non-PHI email path + email-router pattern

### Secondary (MEDIUM confidence)
- Phase 26 D-11 — AdminAffiliatesReviewQueue analog for funnel anomaly acknowledgment UI
- v1.2 BulkExportCSVFlow.tsx — Modal + state-machine pattern for bulk-action confirmation flow

### Tertiary (LOW confidence — flagged for validation)
- Supabase JWT `auth_time` claim presence (A1 — verify at Plan 27-03)
- Phase 24 events_mirror table existence (Open Question 2 — verify before Plan 27-04 plans)
- cmdk + 4 Radix deps total gz size under 30 kB ceiling (A3 — measure at first build)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cmdk + pg_cron + matview verified against primary docs
- Architecture: HIGH — composition of well-trodden Postgres + Supabase primitives; cohort rule-tree translator is bespoke but constrained by 15-field allowlist
- Pitfalls: HIGH — drawn from `[[feedback_planner_iter1_anti_patterns]]`, `[[reference_supabase_migration_gotchas]]`, Postgres docs, pg_cron docs; one MEDIUM (aal2 freshness — A1)

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days; library versions stable, Supabase API surface stable)
