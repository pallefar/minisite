# Phase 61: Admin Protocol Creator - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Mode:** Smart Discuss (autonomous)

<domain>
## Phase Boundary

Admin authoring tool for versioned, RAG-evidence-cited dosing protocols (Tirzepatide 12-wk titration, Retatrutide stack, GHRP-2 sleep stack, etc.) that flow into the clinician dashboard (Phase 30), patient dose-log (Phase 35), and helpdesk KB (Phase 37). Ships 8 surfaces:

1. **DB schema** (`protocols`, `protocol_steps`, `protocol_evidence`, `protocol_review_log`, `patient_protocol_assignment`, `admin_ai_assist_log`) + version-immutable history.
2. **Admin authoring UI** at `/admin/protocols` — compound picker + audience multiselect + step-builder grid + RAG-evidence drawer + AI-assist Suggest action.
3. **SECDEF RPCs** — `publish_protocol` (2-person rule), `assign_protocol_to_patient`, `rollback_protocol`, `archive_protocol`, plus AI-assist Edge Fn (`protocol-ai-assist`).
4. **Clinician dashboard extension** at `/clinic/protocols` — browse + Adopt-for-patient flow.
5. **Patient dose-log extension** — non-destructive prefill + Expected/Logged deviation surfacing.
6. **Helpdesk KB shortcode** — `[protocol:<id>]` renders `<ProtocolSummaryCard>` inline.
7. **Public read-only protocol view** at `/protocols/<slug>` (auth: signed-in users; published-only).
8. **Audit + rate-limit infrastructure** — `protocol_review_log` + `admin_ai_assist_log` (50/day/admin cap).

**Out of scope (defer to P70 / later):**
- Multi-language protocol content (English only; Spanish in v1.5 if KB demand).
- Patient-facing protocol authoring (admins only).
- Protocol marketplace / inter-clinic sharing (single-tenant + B2C only).
- Protocol PDF export for handoff (deferred to Phase 68 sales enablement if asked).
- Adopt-by-cohort batch flow (single-patient adopt only in MVP).

</domain>

<decisions>
## Implementation Decisions

### Step-Builder UX + Evidence Search Drawer (Area 1)

- **Per-week step rows**: `dose_mg` (numeric) + `frequency` enum (`daily`/`weekly`/`bi-weekly`/`custom-cron` w/ cron string sub-field) + `monitoring` multiselect (`weight`, `glucose`, `bp`, `mood`, `gi-symptoms`). One row per `protocol_steps.week`.
- **Numeric `week` ordering** — sorted ascending; add/insert/remove buttons; **no drag-and-drop in MVP** (keyboard-first, reuses Phase 60-08 keyboard navigation pattern).
- **Right-side `<Sheet>` evidence drawer** — opened per-active-step via "Cite evidence" button. Reuses the `Sheet.tsx` primitive used in Phase 60-08 (`RejectReasonSheet`/`AddSourceSheet`). Search box → calls `rag-retrieve` Edge Fn (Phase 60-06) → top-10 results → checkbox per chunk to attach.
- **Attach UX** — `INSERT INTO protocol_evidence(protocol_id, step_id, citation_text, rag_source_id, verbatim_quote)`. Surfaces as `TierBadge` chip beneath each step. Click chip → popover with verbatim_quote (reuses Phase 60-10 AI-coach citation popover component).
- **Step-level granularity is mandatory** — protocol-level-only attach is disallowed by schema (`step_id` is NOT NULL).

### AI-Assist + 2-Person Review (Area 2)

- **AI-assist scope: per-step Suggest action only.** Button on each active step row → opens modal with "Suggest safe titration curve for {compound} given prior steps {context}" → calls `protocol-ai-assist` Edge Fn → returns `{dose_mg, monitoring[], cited_chunk_ids[]}`. Click `Apply` writes draft step (admin reviews + saves). No free-text chat. No auto-whole-protocol generation.
- **Provider**: OpenRouter `anthropic/claude-sonnet-4-5` (matches Phase 60-04 substitution pattern). Prompt template injects retrieved RAG chunks (top-5 via `rag-retrieve`) per RAG-augmented synthesis. `$ai_generation` + `$ai_evaluation` PostHog events on every call. Vendor field = `openrouter_anthropic`.
- **Guardrails (PHARMA-02 carveout)**:
  - Hard-coded refusal phrases at output post-processing (e.g., "I can't recommend …") with structured `refusal: true` flag in response.
  - No off-label suggestion without explicit RAG citation (server-side check: if no `cited_chunk_ids` returned, force `refusal:true`).
  - `admin_ai_assist_log` rate-limiter: 50 suggestions per UTC-day per admin. Exceeded → 429 + structured error.
- **2-person review enforcement (SECDEF)**:
  - `publish_protocol(protocol_id)` returns 403 with code `SELF_REVIEW_REJECTED` when `auth.uid() = protocols.created_by`. Mirror Phase 60-08 `approve_rag_chunk` shape verbatim.
  - State machine: `draft → in_review → published → archived`. `version` increments on every edit of `published` (creates new row; prior version stays live until new approved).
  - **Rollback** = `rollback_protocol(protocol_id, target_version)` SECDEF → marks current version `archived`, target version `published`. Audit row written to `protocol_review_log`.
- **Review UX banner**: `[Pending review by another admin]` above protocol view in `in_review`. Author **never sees the Publish button** in DOM (not just disabled — full removal). Reviewer sees it. Audit trail in `protocol_review_log(protocol_id, version, actor, action, at)`.

### Clinician Adopt + Patient Prefill + KB Integration (Area 3)

- **New `/clinic/protocols` route** in Phase 30 clinician dashboard. Lists published protocols filterable by compound + audience. Per-protocol "Adopt for patient" button → opens patient picker drawer (reuses Phase 30 roster patient-list component) → confirmation modal with diff preview → `assign_protocol_to_patient(protocol_id, patient_id)` SECDEF RPC.
- **Non-destructive merge prefill**: `patient_protocol_assignment(patient_id, protocol_id, version, started_at)` row inserted on assign. Dose-log UI reads protocol_steps for the current week (computed from `started_at` + current date) and renders `Expected: X mg` inline under each empty dose entry. Existing logged doses NEVER overwritten.
- **Deviation surfacing**:
  - Per-dose row in MedicationTab: `Expected: 5mg • Logged: 4.5mg` (only when both present and differ).
  - Aggregated "Protocol adherence: 85%" card in `BodyTab` insights (reuses existing insights-card pattern from Phase 38).
- **KB protocol summary card via shortcode**:
  - KB article markdown supports `[protocol:<id>]` shortcode (extension to existing `react-markdown` pipeline).
  - Resolves at render-time to inline `<ProtocolSummaryCard>` showing title + compound + week count + `View full protocol →` link.
  - Cited evidence footnotes styled inline (`[1]`, `[2]` matching Phase 60-10 AI-coach citation visual).
- **Public read-only protocol view** at `/protocols/<slug>`:
  - Auth: any signed-in user (B2C patient or clinician).
  - Only `status = 'published'` protocols resolvable; others return 404.
  - SEO: `noindex` (clinical content; do not crawl).

### Claude's Discretion

- Naming of new components within `src/components/admin/protocols/` mirroring `src/components/admin/rag/` structure (PATTERNS.md will name analogs explicitly per [[feedback_planner_prompt_explicit_reuse_targets]]).
- Specific PostHog event names for AI-assist (suggestion: `protocol_ai_assist_suggested`, `protocol_ai_assist_applied`).
- Migration file timestamps (use current date `2026-05-26`).
- Exact RLS policy expressions on new tables (use `public.is_staff()` helper per [[reference_supabase_is_staff_helper]]; patient-facing tables use `auth.uid()=patient_id`).
- Whether to use existing `protocol_steps.monitoring` as Postgres `text[]` or new lookup table — pick text[] for MVP simplicity.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Admin shell**: `src/components/admin/AdminShell.tsx` + `AdminLayout.tsx` + module manifest. New module entry `protocols` plugs in alongside `rag`, `members`, `affiliates`, `cohort`, `growth`.
- **RAG curation analog** (Phase 60-08): `src/components/admin/rag/` — `RagLayout.tsx`, `RagQueuePage.tsx`, `QueueDetailPane.tsx`, `AddSourceSheet.tsx`, `RejectReasonSheet.tsx`, `EditChunkModal.tsx`, `TierBadge.tsx`. Mirror this shape for `src/components/admin/protocols/`.
- **RAG retriever Edge Fn** (Phase 60-06): `supabase/functions/rag-retrieve/` — invoked from evidence drawer for chunk search. Already deployed + live.
- **OpenRouter helper**: `supabase/functions/_shared/openrouter.ts` (Phase 60-02). Reuse for `protocol-ai-assist` synthesis.
- **2-person review SECDEF pattern**: `supabase/migrations/*_approve_rag_chunk.sql` (Phase 60-08) — copy shape verbatim for `publish_protocol`.
- **`is_staff()` helper**: `supabase/migrations/20261101000006_is_staff_helper.sql` — use directly in new RLS.
- **AI-coach citation popover**: `src/components/dashboard/ai/CitationPopover.tsx` (Phase 60-10). Reuse for evidence-chip click in step-builder.
- **DS primitives**: `Card`, `Sheet`, `Modal`, `Input`, `Badge`, `Pill`, `EmptyState`, `Skeleton` — all from `src/components/ui/`.
- **PostHog LLM Analytics wiring**: `supabase/functions/_shared/posthog.ts` — emit `$ai_generation` + `$ai_evaluation` per existing pattern.

### Established Patterns
- Admin module = page-routed via `react-router-dom` inside admin surface only (`reference_react_router_consumer_admin_split`).
- SECDEF RPCs with explicit `SECURITY DEFINER` + `SET search_path = public, pg_temp` + `LANGUAGE plpgsql` + raised `EXCEPTION` for guard violations.
- Migrations under `supabase/migrations/` with `YYYYMMDDHHMMSS_` prefix.
- `keyboard-first` admin pattern: focus traps in sheets, `?` shortcut for help modal, arrow-key nav across list rows (`QueueKeyboardHelpModal.tsx` analog).
- Vendor field tagging in all `$ai_generation` events (Phase 60 CR-01).
- Typography ceiling: 11/13/18/28 px + 400/600 weights only (Phase 60 UI-review BLOCKER lesson).
- Tailwind v4 `@theme` tokens only — never undefined tokens (Phase 60 UI BLOCKER lesson; [[feedback_ui_auditor_catches_undefined_theme_tokens]]).

### Integration Points
- **Admin router**: register `protocols` module in admin manifest + AdminShell switch.
- **Clinician dashboard**: add `/clinic/protocols` route to existing Phase 30 router; new top-nav tab.
- **Patient MedicationTab**: extend dose-log render path to inspect active `patient_protocol_assignment` + inject Expected/Logged row.
- **KB renderer**: extend `react-markdown` plugin chain with `protocol-shortcode-resolver` (sibling to Phase 60-10 citation marker plugin).
- **Public `/protocols/<slug>`**: new route in main consumer SPA (add to TabId widening if router-less — confirm at plan-time).
- **RAG retrieve**: import + call `rag-retrieve` Edge Fn from evidence drawer (no new RAG infrastructure).

</code_context>

<specifics>
## Specific Ideas

- **Concrete seed data**: Three reference protocols to seed at migration time (so QA + clinician demo has content):
  1. Tirzepatide 12-week titration (2.5 → 5 → 7.5 → 10 → 12.5 → 15 mg)
  2. Retatrutide 16-week stack (placeholder dosing — RAG-cited)
  3. GHRP-2 sleep stack (peptide research-only; explicit B2C audience exclusion — clinic-only)
- **Adopt confirmation modal** must show diff preview (current schedule → protocol expectation) so clinician sees what changes for the patient before confirming.
- **Banner copy**: `[Pending review by another admin]` — exact string. Localizable via existing i18n infra.
- **`SELF_REVIEW_REJECTED` error code** consumed by admin UI to show toast `Another admin must review this protocol before publish.`
- **AI-assist refusal flag** → admin UI renders `⚠ Suggestion blocked — no qualifying evidence in RAG.` with link to RAG curation queue.

</specifics>

<deferred>
## Deferred Ideas

- **Protocol templates marketplace** (clone-from-other-clinic) — deferred to v1.5; single-tenant only in v1.4.
- **PDF export of protocol for patient handoff** — deferred to Phase 68 if sales-enablement asks; not in MVP scope.
- **Patient-facing protocol authoring** (DIY) — out of scope; admin/clinician-only.
- **Adopt-by-cohort batch flow** — defer to Phase 62 insights engine (cohort builder already lives there).
- **Spanish localization of protocol bodies** — defer to v1.5 contractor expansion (per Phase 60 i18n decision).

</deferred>
