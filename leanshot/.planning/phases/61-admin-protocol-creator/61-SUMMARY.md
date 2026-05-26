---
phase: 61
phase_name: Admin Protocol Creator
status: complete
verdict: autonomous-verify-only
shipped: 2026-05-26
plans: 8
requirements: PROTOCOL-01, PROTOCOL-02, PROTOCOL-03, PROTOCOL-04, PROTOCOL-05, PROTOCOL-06, PROTOCOL-07, PROTOCOL-08
human_uat_deferred_to: Phase 70
---

# Phase 61 Summary — Admin Protocol Creator

**Shipped:** 2026-05-26 in one autonomous session (`/gsd-autonomous --from 61 --to 69`).
**Plans:** 8 / 8 — discuss → UI design contract (6/6 PASS) → research + patterns → planner (iter-1 revision: 1 BLOCKER + 1 WARNING fixed) → 3-wave execute → close-out.

## What Shipped

### Database (Plan 01 + 02)

6 new tables under `public.` with full RLS via `public.is_staff()`:
- `protocols` — composite PK `(id, version)`, row-per-version immutability, `base_slug` separate from computed `slug = base_slug || '-v' || version`
- `protocol_steps` — per-week dose + frequency + monitoring (text[])
- `protocol_evidence` — RAG-cited chunks attached at step-level (NOT NULL `step_id`)
- `protocol_review_log` — append-only audit on every state transition
- `patient_protocol_assignment` — composite PK `(patient_id, protocol_id)`, idempotent on re-assign
- `admin_ai_assist_log` — 50/day/admin rate limit + audit

3 reference protocols seeded:
- Tirzepatide 12-wk titration (B2C + clinic; 6 weekly steps 2.5→15mg)
- Retatrutide 16-wk stack (B2C + clinic; 4 weekly steps 2→8mg)
- GHRP-2 sleep stack (clinic-only; 1 daily step 0.2mg)

7 SECDEF RPCs mirroring `approve_rag_chunk` shape verbatim:
- `publish_protocol(p_protocol_id, p_version)` — 2-person rule via `SELF_REVIEW_REJECTED` exception when actor=`created_by`
- `submit_protocol_for_review`, `rollback_protocol`, `archive_protocol`, `assign_protocol_to_patient` (idempotent upsert), `get_protocol_by_slug`, `list_admin_ai_assist_usage_today` (UTC-day truncation per RESEARCH.md Pitfall 4)

### Edge Function (Plan 03)

`protocol-ai-assist` — OpenRouter `anthropic/claude-sonnet-4-5` (dotted per [[feedback_openrouter_substitution_pattern]]) + PHARMA-02 carveout + 50/day rate-limit + refusal flag + placeholder runtime guard. Split into `handler.ts` (pure, testable) + `index.ts` (`Deno.serve` guarded by `import.meta.main` per [[reference_deno_test_top_level_serve_trap]]). 6/6 RED→GREEN Vitest tests.

### Admin UI (Plans 04 + 05)

`/admin/protocols/*` route family:
- `ProtocolsLayout` (mirrors `RagLayout` verbatim)
- `ProtocolsListPage` with filter pills + keyboard shortcuts (N/J/K/Shift+?)
- `ProtocolEditorPage` two-column grid `lg:grid-cols-[1fr_320px]` + state machine (`draft → in_review → published → archived`) + version-on-edit
- `ProtocolStepRow` — per-week dose + frequency + monitoring pills + Cite + Suggest buttons
- `ProtocolReviewBanner` — 2-person UI Layer: Publish button NEVER in DOM for authors (conditional render, not disabled — full removal)
- `EvidenceSearchSheet` — right-side Sheet calling `rag-retrieve` Edge Fn + checkbox attach to `protocol_evidence` with `step_id NOT NULL`
- `AiAssistModal` — state machine `idle → loading → loaded | refusal | error`; 429 path closes; refusal links to RAG queue; Apply writes draft step
- `ProtocolStatusBadge` (4-state) + `ProtocolKeyboardHelpModal`
- Destructive CTAs honor UI-SPEC revision: `Archive protocol` (not `Archive`) + `Rollback to v{N}` (not `Rollback`)

### Clinician Adopt Flow (Plan 06)

`/clinic/protocols` route in `ClinicWorkspace`:
- `ClinicProtocolsPage` — list filterable by compound + audience
- `AdoptProtocolSheet` — drawer opens patient picker
- `PatientPickerList` — wires to real `rank_org_patients` RPC (NOT placeholder `clinic_patient_roster`)
- `AdoptDiffModal` — confirmation with diff preview; Cancel CTA is `Keep current schedule` per UI-SPEC revision
- Calls `assign_protocol_to_patient` SECDEF RPC with proper `(p_protocol_id, p_version, p_patient_id)` signature

### Patient + KB + Public (Plan 07)

- `useActiveProtocolAssignment` hook — computes current week from `started_at`; reads `patient_protocol_assignment` + joined `protocol_steps` for the current row
- `MedicationTab` extension — `Expected: X mg • Logged: Y mg` deviation row per dose entry
- `BodyTab` extension — "Protocol adherence: N%" insights card
- `ProtocolSummaryCard` — used by both KB shortcode + public route
- `protocol-shortcode-plugin.ts` — pre-parser mirroring `remark-citations.ts` Phase 60-10 pattern
- `KnowledgeArticleDetailPage` — wired to invoke `parseProtocolShortcodes` on `sanitizedBody` (sanitize-then-parse ordering per Phase 60 T-60-13 XSS defense) → renders `ProtocolSummaryCard` inline (BLOCKER fix from plan-checker iter-1)
- `PublicProtocolPage` at `/protocols/<slug>` — auth-required, published-only, `<meta name="robots" content="noindex">` (clinical content)
- `App.tsx selectView` — `/protocols/*` branch added BEFORE marketing fallback

## What Did Not Ship This Phase (rolled to other phases)

See [`61-CARRY-OVER.md`](61-CARRY-OVER.md) for full enumeration:
- 5 HUMAN-UAT items → Phase 70
- 3 tech-debt items → Phase 63
- 2 operational items → Phase 67

## Test Coverage

- 12 Vitest files / **64 tests passing** (admin + clinic + protocols + knowledge + markdown + hooks suites)
- 6 Edge Fn handler tests passing (RED→GREEN flow on refusal + rate-limit + PHARMA-02 + success paths)
- tsc clean (`npx tsc -p tsconfig.app.json --noEmit` exits 0)
- 0 known regressions; no NET-NEW failures vs baseline

## Deployment Evidence

- 3 migrations applied to remote `ytnsipxxmzgaebkqmokp` via `supabase db push --linked`
- Edge Fn `protocol-ai-assist` deployed (`a466ffd9-8575-478b-b667-1d4a680dcd11`) status ACTIVE
- 0 cron jobs added in this phase (Phase 61 has no scheduled work)

## Notable Process Findings (validated/added to memory this phase)

- [[feedback_parallel_wave_state_md_merge_conflict]] — prompt-level "DO NOT modify STATE.md" constraints DO NOT WORK; gsd-executor agent template overrides them. Resolve at every merge.
- [[feedback_wave1_executor_redefines_wave0_types]] — Wave 1 executor recreated `src/types/protocols.ts` with phantom columns; resolved by taking HEAD (DB schema is source of truth)
- [[feedback_ui_spec_token_table_completeness]] — UI-checker FLAGs tokens used in surface descriptions but missing from spec's color table EVEN IF defined in src/index.css
- [[reference_general_purpose_agent_no_recursive_spawn]] — sub-agents cannot recursively spawn sub-sub-agents via Task/Agent; orchestrate plan/execute at top-level
- [[reference_supabase_back_dated_migration_blocks_push]] — fired at close-out; Phase 60 cluster's 20281201* timestamps required forward-renaming Phase 61's 20260526* → 20290101*
- `CREATE POLICY IF NOT EXISTS` is unsupported on this project's PG version; use bare `CREATE POLICY`

## Commits

37 commits this session (~Phase 61). Notable boundaries:
- `363a5da5` smart discuss CONTEXT
- `cc711c8b` UI-SPEC approved (6/6 PASS)
- `cba5ba34` RESEARCH + PATTERNS
- `b28ab83b` 8 PLANs + VALIDATION (iter-1 revision)
- `82f55a50` ROADMAP plan list
- `c018b067` 61-01 DB merge (Wave 0)
- `10049b0a` 61-02 SECDEF RPCs merge
- `b0efd259` 61-03 Edge Fn merge
- `merge(61-04)`, `ce0ea2fb` 61-06, `cdbd61b3` 61-07 (Wave 1)
- `merge(61-05)` admin editor (Wave 2)
- `0532136e` policy syntax fix
- close-out commits (this writeup)

## Resume Hint for Phase 62

Phase 62 (Insights & Research Engine) is next. Heavy data layer: k-anonymity (k≥5) + differential privacy + matview rollups + research-publication pipeline. Closes the RAG loop by feeding published papers back as `source_type='leanshot_research'` Phase 60 chunks. Requirements INSIGHTS-01..10.

Recommended next action: `/gsd-autonomous --from 62 --to 69` (continues the autonomous run).
