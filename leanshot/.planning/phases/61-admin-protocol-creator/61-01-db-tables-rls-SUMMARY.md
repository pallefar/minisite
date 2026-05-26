---
phase: 61-admin-protocol-creator
plan: "01"
subsystem: database
tags: [schema, rls, typescript-types, protocols, migration]
dependency_graph:
  requires: []
  provides:
    - supabase/migrations/20260526000001_protocol_tables.sql
    - supabase/migrations/20260526000003_protocol_seed_data.sql
    - leanshot/src/types/protocols.ts
  affects:
    - leanshot/src/types/index.ts
tech_stack:
  added: []
  patterns:
    - row-per-version composite PK (id, version)
    - base_slug + computed slug column pattern
    - is_staff() RLS on staff tables
    - auth.uid()=patient_id RLS on patient tables
    - published-only public select via subselect JOIN
key_files:
  created:
    - supabase/migrations/20260526000001_protocol_tables.sql
    - supabase/migrations/20260526000003_protocol_seed_data.sql
    - leanshot/src/types/protocols.ts
  modified:
    - leanshot/src/types/index.ts
decisions:
  - Composite PK (id, version) on protocols enables PROTOCOL-05 row-per-version versioning
  - base_slug separate from computed slug (-vN) avoids Pitfall 2 slug enumeration/collision
  - monitoring as text[] not lookup table (D-CTX-01 MVP simplicity)
  - protocol_evidence.step_id ON DELETE CASCADE (Pitfall 6 — broken FK on step remove)
  - patient_protocol_assignment PK (patient_id, protocol_id) for idempotency on re-assign
  - tg_set_updated_at trigger inlined (no prior helper found in earlier migrations)
  - RLS public_published_select on protocol_steps/evidence uses subselect JOIN through protocols
metrics:
  duration_minutes: 15
  completed: "2026-05-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 61 Plan 01: DB Tables + RLS — Summary

**One-liner:** 6-table protocol schema with row-per-version PK, is_staff() + patient RLS, computed slug, and 9-interface TS contract module.

## What Was Built

### Task 1: Protocol schema migration + shared TS types

**supabase/migrations/20260526000001_protocol_tables.sql** — 273 lines

- ENUM `public.protocol_review_state`: `draft | in_review | published | archived` (guarded DO-block for idempotency)
- `public.protocols`: composite PK `(id, version)` for row-per-version history; `base_slug` + computed `slug = base_slug || '-v' || version::text`; FK `created_by`/`reviewed_by` → `auth.users(id) ON DELETE SET NULL`; `tg_set_updated_at` trigger
- `public.protocol_steps`: PK `(id)`; FK `(protocol_id, protocol_version)` → `protocols(id, version) ON DELETE CASCADE`; UNIQUE `(protocol_id, protocol_version, week)`; CHECK on frequency (4-value)
- `public.protocol_evidence`: `step_id NOT NULL REFERENCES protocol_steps(id) ON DELETE CASCADE`; `rag_source_id` intentionally has no FK (RAG chunks may be retracted)
- `public.protocol_review_log`: append-only audit; CHECK constraint on action values
- `public.patient_protocol_assignment`: PK `(patient_id, protocol_id)` for idempotent re-assign; `patient_id` → `auth.users(id) ON DELETE CASCADE`
- `public.admin_ai_assist_log`: `(actor_id, created_at desc)` index for per-day rate-limit count
- 6 indexes (active-state partial, published-slug, steps-week, evidence-step, review-log-time, ai-log-actor-date)
- RLS enabled on all 6 tables; policies: `staff_all` (is_staff()) on 5 tables; `own_select` + `staff_write` on patient table; `public_published_select` (review_state='published') on protocols, steps, evidence

**leanshot/src/types/protocols.ts** — 9 exported interfaces:

| Interface | DB Table | Notes |
|-----------|----------|-------|
| `Protocol` | protocols | Includes base_slug, slug, review_state, published_at |
| `ProtocolStep` | protocol_steps | monitoring: ProtocolMonitoringKey[] |
| `ProtocolEvidence` | protocol_evidence | step_id NOT NULL |
| `ProtocolReviewLogRow` | protocol_review_log | action union type |
| `PatientProtocolAssignment` | patient_protocol_assignment | PK (patient_id, protocol_id) |
| `AdminAiAssistLogRow` | admin_ai_assist_log | rate-limit audit |
| `AiAssistRequest` | — | Edge Fn request shape |
| `AiAssistResponse` | — | Edge Fn response shape (refusal flag) |
| `ProtocolReviewState` | ENUM | type alias |
| `ProtocolFrequency` | CHECK constraint | type alias |
| `ProtocolMonitoringKey` | text[] values | type alias |

**leanshot/src/types/index.ts** — appended `export * from './protocols';` to barrel.

### Task 2: Seed data migration

**supabase/migrations/20260526000003_protocol_seed_data.sql** — 3 reference protocols + 11 step rows:

| Protocol | UUID | Audience | Steps |
|----------|------|----------|-------|
| Tirzepatide 12-week titration | ...0061 | B2C, clinic | 6 (2.5→15mg weekly, weeks 1/5/9/13/17/21) |
| Retatrutide 16-week stack | ...0062 | B2C, clinic | 4 (2→8mg weekly, weeks 1/5/9/13) |
| GHRP-2 sleep stack | ...0063 | clinic only | 1 (0.2mg=200mcg daily, week 1) |

All seeded as `review_state='draft'`, `created_by=null`. Idempotent via `ON CONFLICT DO NOTHING`. No evidence rows seeded.

## Deviations from Plan

None — plan executed exactly as written.

The `tg_set_updated_at` function was inlined in the migration (per plan instruction) since no prior helper existed in earlier migrations that could be referenced.

## Threat Surface Scan

No new threat surface beyond what was declared in the plan's `<threat_model>`. All 4 declared threats have DB-layer mitigations:

- T-61-01-01: `review_state = 'published'` public select RLS — implemented
- T-61-01-02: `auth.uid() = patient_id` own-row select — implemented
- T-61-01-03: Staff-only RLS + Plan 02 SECDEF RPCs seat ready — schema layer done
- T-61-01-04: UUID-based slugs + published-only RLS — implemented

## Known Stubs

None. No UI components shipped in this plan. All artifacts are DB + type contracts.

## Self-Check: PASSED

- [x] `supabase/migrations/20260526000001_protocol_tables.sql` exists with 6 tables, ENUM, RLS, indexes
- [x] `supabase/migrations/20260526000003_protocol_seed_data.sql` exists with 3 protocols + 11 steps
- [x] `leanshot/src/types/protocols.ts` exists with 9 interfaces + 3 type aliases
- [x] `tsc --noEmit` shows zero errors attributable to protocols.ts
- [x] Commits: `61a8e29b` (Task 1) + `a0385768` (Task 2)
