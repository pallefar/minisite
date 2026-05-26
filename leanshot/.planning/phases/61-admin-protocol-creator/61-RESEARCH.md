# Phase 61: Admin Protocol Creator — Research

**Researched:** 2026-05-26
**Domain:** Admin authoring tool — PostgreSQL schema, SECDEF RPCs, RAG integration, React admin UI, Edge Fn AI-assist
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Step-Builder UX + Evidence Search Drawer:**
- Per-week step rows: `dose_mg` (numeric) + `frequency` enum (`daily`/`weekly`/`bi-weekly`/`custom-cron` + cron sub-field) + `monitoring` multiselect (`weight`, `glucose`, `bp`, `mood`, `gi-symptoms`)
- Numeric `week` ordering; add/insert/remove buttons; NO drag-and-drop in MVP
- Right-side `<Sheet>` evidence drawer opened per-step via "Cite evidence" button; reuses `Sheet.tsx` primitive from Phase 60-08
- `INSERT INTO protocol_evidence(protocol_id, step_id, citation_text, rag_source_id, verbatim_quote)` on attach
- `step_id` is NOT NULL — protocol-level-only attach disallowed
- Evidence chip click opens `CitationPopover` (Phase 60-10 reuse verbatim)

**AI-Assist + 2-Person Review:**
- AI-assist scope: per-step Suggest action only (no free-text chat, no auto-whole-protocol generation)
- Provider: OpenRouter `anthropic/claude-sonnet-4-5` (matches Phase 60-04 substitution)
- `$ai_generation` + `$ai_evaluation` PostHog events on every call; `vendor: 'openrouter_anthropic'`
- PHARMA-02 carveout: hard-coded refusal phrases + `refusal: true` flag; no off-label without RAG citation
- Rate limit: 50 suggestions/UTC-day/admin via `admin_ai_assist_log`
- 2-person review: `publish_protocol(protocol_id)` SECDEF returns `SELF_REVIEW_REJECTED` when `auth.uid() = created_by`
- State machine: `draft → in_review → published → archived`; `version` increments on each edit of published version
- Rollback: `rollback_protocol(protocol_id, target_version)` SECDEF; marks current `archived`, target `published`; audit row to `protocol_review_log`
- Review UX: author NEVER sees Publish button in DOM (not just disabled — full removal)

**Clinician Adopt + Patient Prefill + KB Integration:**
- New `/clinic/protocols` route in Phase 30 clinician dashboard
- Non-destructive merge prefill via `patient_protocol_assignment(patient_id, protocol_id, version, started_at)`
- Deviation surfacing: per-dose `Expected: Xmg • Logged: Ymg` + aggregated "Protocol adherence: N%" card in BodyTab
- KB shortcode `[protocol:<id>]` → `<ProtocolSummaryCard>` (extension to existing react-markdown pipeline)
- Public read-only `/protocols/<slug>`: auth-gated (signed-in only), published-only, `noindex`

### Claude's Discretion
- Naming of new components within `src/components/admin/protocols/`
- Specific PostHog event names for AI-assist (suggested: `protocol_ai_assist_suggested`, `protocol_ai_assist_applied`)
- Migration file timestamps (use `20281202XXXXXX_` series — after Phase 60's `20281201XXXXXX` series)
- Exact RLS policy expressions (use `public.is_staff()` helper; patient-facing tables use `auth.uid()=patient_id`)
- `protocol_steps.monitoring` as `text[]` (MVP simplicity, not a lookup table)

### Deferred Ideas (OUT OF SCOPE)
- Protocol templates marketplace (clone-from-other-clinic) — v1.5
- PDF export of protocol for patient handoff — Phase 68 if sales-enablement asks
- Patient-facing protocol authoring (DIY) — out of scope; admin/clinician-only
- Adopt-by-cohort batch flow — Phase 62 insights engine
- Spanish localization of protocol bodies — v1.5 contractor expansion
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROTOCOL-01 | Schema: `protocols` + `protocol_steps` + `protocol_evidence` tables | DB schema section; migration timestamp series `20281202XXXXXX` |
| PROTOCOL-02 | Admin authoring UI at `/admin/protocols` — compound picker + audience multiselect + step-builder grid + evidence drawer + AI-assist | UI section; reuse RagLayout/QueueDetailPane analogs |
| PROTOCOL-03 | RAG-evidence search uses Phase 60 retriever; chunks attach as `protocol_evidence` rows | RAG integration section; `_shared/rag-retrieve.ts` verified live |
| PROTOCOL-04 | 2-person review rule: SECDEF `publish_protocol` checking `actor != created_by` | SECDEF section; mirrors `approve_rag_chunk` shape exactly |
| PROTOCOL-05 | Versioning: edits create new version row; prior published stays live until new approved; rollback action | DB schema (row-per-version); `rollback_protocol` SECDEF |
| PROTOCOL-06 | Clinician dashboard extension at `/clinic/protocols`; adopt-for-patient flow | Clinician integration section |
| PROTOCOL-07 | Patient dose-log prefill + Expected/Logged deviation surfacing | Patient integration section |
| PROTOCOL-08 | KB shortcode `[protocol:<id>]` → `<ProtocolSummaryCard>` inline | KB shortcode section; react-markdown plugin chain |
</phase_requirements>

---

## Summary

Phase 61 ships an admin authoring tool for versioned, RAG-evidence-cited dosing protocols. It is a pure composition phase: no new AI subsystems, no new vendor integrations. It reuses Phase 60's `rag-retrieve` Edge Fn (deployed live), Phase 60-08's 2-person SECDEF shape, Phase 60-10's `CitationPopover`, Phase 60-04's OpenRouter client pattern, and the existing `Sheet`/`Modal`/`Card` DS primitives.

The codebase investigation confirms every analog file exists and is already in production. The `approve_rag_chunk` migration at `20281201000002` is the direct template for `publish_protocol`. The `RagLayout.tsx` + `RagQueuePage.tsx` + `QueueDetailPane.tsx` pattern is the direct template for `ProtocolsLayout` + `ProtocolsListPage` + `ProtocolEditorPage`. The `rag-summarize-and-chunk/anthropic.ts` OpenRouter client is the direct template for `protocol-ai-assist`'s Anthropic caller.

The phase spans 6 new tables, 5 SECDEF RPCs, 1 Edge Fn (`protocol-ai-assist`), 13 new React components, 3 consumer-surface extension points (MedicationTab, BodyTab, KB renderer), 1 admin module manifest entry, and 1 new public route (`/protocols/<slug>`) using the established Phase 60-13 `selectView` pathname-branch pattern.

**Primary recommendation:** Plan 7-9 tasks across 1 wave + close-out. DB + RPC migration first (Wave 0), then admin UI + Edge Fn (Wave 1), then patient/clinician/KB integration (Wave 2 or same wave with `depends_on` edges).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Protocol schema + state machine | Database / Storage | — | All version transitions enforced at DB layer via SECDEF RPCs; UI cannot bypass |
| 2-person review enforcement | Database / Storage | API / Backend | DB-layer `FOR UPDATE` lock + `auth.uid()` check is Layer 1; UI removal of button is Layer 2 |
| RAG evidence search | API / Backend (Edge Fn) | Browser / Client | `rag-retrieve` Edge Fn does vector search + rerank; browser UI calls it server-to-server |
| AI-assist suggestion | API / Backend (Edge Fn) | — | `protocol-ai-assist` Edge Fn calls OpenRouter, enforces PHARMA-02, rate-limits via DB |
| Admin authoring UI | Browser / Client | Frontend Server (SSR) | React SPA; admin shell is client-rendered; no SSR for admin surfaces |
| Clinician adopt flow | Browser / Client | Database / Storage | Client-side Sheet + diff modal; `assign_protocol_to_patient` SECDEF writes to DB |
| Patient dose-log prefill | Browser / Client | Database / Storage | MedicationTab reads `patient_protocol_assignment` via Supabase JS client; non-destructive merge in UI |
| KB shortcode rendering | Browser / Client | — | react-markdown plugin resolves `[protocol:<id>]` → `<ProtocolSummaryCard>` at render time |
| Public `/protocols/<slug>` | Browser / Client | Database / Storage | Path-based routing via `selectView` in App.tsx (same pattern as `/knowledge/*`); RLS ensures published-only |
| Audit trail | Database / Storage | — | `protocol_review_log` is insert-only; all state transitions write audit rows via SECDEF |

---

## Standard Stack

### Core (all already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.0.0 | UI components | Project standard [VERIFIED: package.json] |
| TypeScript | ~5.6.3 | Type safety | Project standard [VERIFIED: package.json] |
| Tailwind v4 | ^4.0.0-beta.7 | Styling via `@theme` tokens | Project standard [VERIFIED: package.json] |
| framer-motion | ^11.11.17 | Sheet/Modal animations | Already in DS primitives [VERIFIED: package.json] |
| lucide-react | ^0.460.0 | Icons | Project standard [VERIFIED: package.json] |
| zod (npm) | ^4.0.0 | Schema validation in React | [VERIFIED: package.json] |
| zod (Deno) | npm:zod@^3 | Schema validation in Edge Fns | [VERIFIED: _shared/deno.json] |
| Supabase JS | ^2 | DB client, auth | Project standard [ASSUMED] |

### Edge Function Stack (already in `_shared/`)

| Helper | Source | Purpose | Why Standard |
|--------|--------|---------|--------------|
| `_shared/rag-retrieve.ts` | Phase 60-02 | Call `rag-retrieve` Edge Fn with retry + Zod parse | Already deployed live [VERIFIED: codebase grep] |
| `_shared/posthog-rag-events.ts` | Phase 60-02 | Typed `$ai_generation` + `$ai_evaluation` emitters | Phase 60 pattern; `vendor` field required [VERIFIED: codebase grep] |
| `_shared/pharma-02-carveout.ts` | Phase 60-04 | Runtime PHARMA-02 guard | 3-layer invariant Layer 2 [VERIFIED: codebase grep] |
| `_shared/posthog-server.ts` | Phase 60-02 | Raw PostHog server capture | Base layer [VERIFIED: codebase grep] |
| `_shared/slack-guardrail-alert.ts` | Phase 60-02 | Slack guardrail trip alerts | Required for refusal events [VERIFIED: codebase grep] |
| `_shared/supabase-server.ts` | Phase 60 | Service-role Supabase client | [VERIFIED: codebase grep] |

### No New npm Packages

Phase 61 installs zero new npm packages. All React components use existing DS primitives (`Card`, `Sheet`, `Modal`, `Input`, `Badge`, `Pill`, `EmptyState`, `Skeleton`, `Button`). All Edge Fn dependencies use `_shared/` helpers already deployed in Phase 60.

---

## Package Legitimacy Audit

> Phase 61 installs **zero new external packages**. All dependencies are already in `package.json` (verified Phase 60) or in `supabase/functions/_shared/` (verified deployed). No legitimacy audit required.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Admin Browser
    │
    ├─► GET /admin/protocols          → ProtocolsLayout → ProtocolsListPage (list all)
    ├─► GET /admin/protocols/:id      → ProtocolsLayout → ProtocolEditorPage
    │       │
    │       ├─ "Cite evidence" click  → EvidenceSearchSheet
    │       │       └─► POST /functions/v1/rag-retrieve   [Phase 60-06, deployed live]
    │       │                └─► top-10 chunks → checkbox attach → protocol_evidence INSERT
    │       │
    │       ├─ "Suggest" click        → AiAssistModal
    │       │       └─► POST /functions/v1/protocol-ai-assist  [new Phase 61 Edge Fn]
    │       │                ├─► retrieveRagChunks(query, k=5) → rag-retrieve
    │       │                ├─► PHARMA-02 carveout check
    │       │                ├─► OpenRouter anthropic/claude-sonnet-4-5 (chat completions)
    │       │                ├─► rate-limit check: admin_ai_assist_log COUNT today
    │       │                └─► { dose_mg, monitoring[], cited_chunk_ids[], refusal }
    │       │
    │       ├─ "Submit for review"    → UPDATE protocols SET review_state='in_review'
    │       └─ "Publish Protocol"     → SECDEF publish_protocol(protocol_id)
    │               ├─► auth.uid() = created_by? → RAISE 'SELF_REVIEW_REJECTED'
    │               └─► version++ → INSERT new version row → old stays published until approved
    │
    ├─► GET /clinic/protocols         → ClinicProtocolsPage (clinician view)
    │       └─ "Adopt for patient"   → AdoptProtocolSheet → AdoptDiffModal
    │                                 → SECDEF assign_protocol_to_patient
    │                                   → INSERT patient_protocol_assignment
    │
    ├─► GET /protocols/<slug>         → PublicProtocolPage (consumer, auth-gated, noindex)
    │       └─► RLS: only published protocols SELECT-able by authenticated
    │
    └─► Patient Dashboard
            ├─ MedicationTab          ← reads patient_protocol_assignment + protocol_steps
            │       └─ Expected/Logged deviation row (informational, non-blocking)
            └─ BodyTab                ← "Protocol adherence: N%" insights card
```

### Recommended Project Structure

```
src/
├── components/admin/protocols/      # All admin authoring components
│   ├── ProtocolsLayout.tsx          # Mirror RagLayout.tsx — pathname sub-nav
│   ├── ProtocolsListPage.tsx        # Mirror RagQueuePage.tsx — list + filter pills
│   ├── ProtocolEditorPage.tsx       # Mirror QueueDetailPane.tsx — two-column editor
│   ├── ProtocolStepRow.tsx          # Per-week step sub-component
│   ├── EvidenceSearchSheet.tsx      # Mirror AddSourceSheet.tsx — rag-retrieve + checkboxes
│   ├── AiAssistModal.tsx            # Modal DS primitive; no direct analog
│   ├── ProtocolReviewBanner.tsx     # Warning-toned banner
│   ├── ProtocolStatusBadge.tsx      # Thin Badge wrapper (mirrors TierBadge.tsx pattern)
│   ├── ProtocolKeyboardHelpModal.tsx # Mirror QueueKeyboardHelpModal.tsx
│   ├── ClinicProtocolsPage.tsx      # Clinician list (subset of admin list)
│   ├── AdoptProtocolSheet.tsx       # Sheet + patient picker
│   ├── AdoptDiffModal.tsx           # Two-column diff preview modal
│   └── ProtocolSummaryCard.tsx      # Card DS `variant="flat"` for KB shortcode
├── components/protocols/
│   └── PublicProtocolPage.tsx       # Consumer surface, auth-gated, noindex
supabase/
├── migrations/
│   ├── 20281202000001_protocol_tables.sql    # 6 new tables + ENUMs + indexes + RLS
│   ├── 20281202000002_protocol_secdef_rpcs.sql  # 5 SECDEF RPCs
│   └── 20281202000003_protocol_seed_data.sql   # 3 reference protocols seed
└── functions/
    └── protocol-ai-assist/
        ├── deno.json
        ├── index.ts
        ├── handler.ts               # Handler separated from serve (per D-60-05-01 pattern)
        └── __tests__/
            └── handler.test.ts
```

### Pattern 1: Admin Module Registration

**What:** Add `protocols` entry to `ADMIN_MODULES` manifest in `src/lib/admin/modules.ts`.
**When to use:** Every new admin section visible in AdminShell nav.

```typescript
// Source: verified from src/lib/admin/modules.ts existing entries (RagLayout analog)
{
  key: 'protocols',
  label: 'Protocols',
  route: 'protocols',
  icon: ClipboardListIcon,   // lucide-react
  lazy: () => import('@/components/admin/protocols/ProtocolsLayout'),
  flagKey: 'admin_protocols',
  minRole: 'admin',
}
```

### Pattern 2: SECDEF RPC — `publish_protocol` (2-Person Rule)

**What:** Mirror `approve_rag_chunk` shape exactly. Key invariant: `FOR UPDATE` row lock + `auth.uid() = created_by` guard before state transition.
**When to use:** Any state transition requiring 2-person enforcement.

```sql
-- Source: verified from supabase/migrations/20281201000002_phase60_secdef_rpcs.sql
create or replace function public.publish_protocol(
  p_protocol_id uuid,
  p_version     int
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created_by  uuid;
  v_state       public.protocol_review_state;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select created_by, review_state
  into   v_created_by, v_state
  from   public.protocols
  where  id = p_protocol_id and version = p_version
  for    update;

  if not found then
    raise exception 'protocol % version % not found', p_protocol_id, p_version;
  end if;

  -- 2-person rule (mirrors approve_rag_chunk guard verbatim)
  if v_created_by is not null and v_created_by = auth.uid() then
    raise exception 'SELF_REVIEW_REJECTED'
      using errcode = '42501';
  end if;

  if v_state <> 'in_review' then
    raise exception 'cannot publish protocol in state %', v_state;
  end if;

  -- Mark prior published version as archived
  update public.protocols
  set    review_state = 'archived'
  where  id = p_protocol_id and review_state = 'published';

  -- Publish this version
  update public.protocols
  set    review_state = 'published',
         published_at  = now(),
         reviewed_by   = auth.uid(),
         reviewed_at   = now()
  where  id = p_protocol_id and version = p_version;

  -- Audit row
  insert into public.protocol_review_log
    (protocol_id, version, actor, action, at)
  values
    (p_protocol_id, p_version, auth.uid(), 'published', now());
end
$$;

revoke all on function public.publish_protocol(uuid, int) from public;
grant execute on function public.publish_protocol(uuid, int) to authenticated;
```

### Pattern 3: Version-Immutable History (Row-Per-Version)

**What:** Each edit of a published protocol inserts a new row with `version = old_version + 1` and `review_state = 'draft'`. The prior published version row is NOT mutated.
**When to use:** Any domain requiring immutable audit history + rollback.

```sql
-- Schema shape (source: CONTEXT.md PROTOCOL-01 + PROTOCOL-05)
create table public.protocols (
  id              uuid         default gen_random_uuid(),
  version         int          not null default 1,
  name            text         not null,
  compound        text         not null,
  audience        text[]       not null default '{}',
  slug            text         generated always as (
                    lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
                    || '-v' || version::text
                  ) stored,
  review_state    public.protocol_review_state not null default 'draft',
  created_by      uuid         references auth.users(id),
  reviewed_by     uuid         references auth.users(id),
  published_at    timestamptz,
  reviewed_at     timestamptz,
  created_at      timestamptz  not null default now(),
  primary key     (id, version)   -- composite PK enables same UUID across versions
);
```

### Pattern 4: OpenRouter Client for `protocol-ai-assist`

**What:** Mirror `rag-summarize-and-chunk/anthropic.ts` pattern — uses `OPENROUTER_API_KEY`, calls `https://openrouter.ai/api/v1/chat/completions`, model ID = `anthropic/claude-sonnet-4-5` (OpenRouter dotted convention).
**When to use:** Any Edge Fn calling LLM via OpenRouter (per Phase 60 vendor substitution decision).

```typescript
// Source: verified from supabase/functions/rag-summarize-and-chunk/anthropic.ts
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const AI_ASSIST_MODEL = 'anthropic/claude-sonnet-4-5' as const;
// PostHog vendor field (per Phase 60 CR-01 fix):
const POSTHOG_MODEL = 'openrouter/anthropic/claude-sonnet-4-5' as const;
const POSTHOG_VENDOR = 'openrouter_anthropic' as const;

const key = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  },
  body: JSON.stringify({
    model: AI_ASSIST_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
  }),
  signal: AbortSignal.timeout(30_000),
});
```

### Pattern 5: KB Shortcode Plugin (`[protocol:<id>]`)

**What:** Extend existing react-markdown rendering pipeline with a custom inline token parser. The existing `remark-citations.ts` parser (Phase 60-10) is a pure regex string parser, NOT a remark AST plugin — so the protocol shortcode uses the same approach: a pre-parse pass over markdown text that replaces `[protocol:<uuid>]` tokens with renderable React elements.
**When to use:** Any inline rendering extension to KB article markdown.

```typescript
// Source: verified from src/lib/rag/remark-citations.ts (pattern) + CONTEXT.md decisions
// Protocol shortcode regex — matches [protocol:uuid]
const PROTOCOL_SHORTCODE_REGEX = /\[protocol:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

// Resolution: at render time, fetch protocol summary via Supabase JS client
// and render <ProtocolSummaryCard>. Same deferred-fetch pattern as CitationPopover.
```

### Pattern 6: Public Route via `selectView` (App.tsx)

**What:** Add `/protocols/*` pathname branch to `selectView` in App.tsx, following the exact same shape as the `/knowledge/*` branch added in Phase 60-13.
**When to use:** Any new public or auth-gated path-routed consumer surface.

```typescript
// Source: verified from src/App.tsx lines 687-693 (knowledge branch pattern)
// Add BEFORE clinic-invite and AFTER /knowledge check:
if (opts.pathname.startsWith('/protocols')) {
  return opts.user ? 'protocols' : 'auth';
  // Auth-gated: no user → bounce to auth (unlike /knowledge which is public)
}
```

### Anti-Patterns to Avoid

- **Putting `auth.uid()` in `WHERE` clause of `publish_protocol` body without `FOR UPDATE`:** Race condition allows concurrent double-publish. Always `SELECT ... FOR UPDATE` first (see `approve_rag_chunk` pattern).
- **Disabling Publish button with `disabled` attribute:** CONTEXT.md explicitly requires full DOM removal (`current_user_id === protocol.created_by` → conditional render, not `disabled`). A disabled button is still findable in DOM.
- **Using `font-medium` or `font-bold`:** Phase 60 UI BLOCKER lesson — only `font-normal` (400) and `font-semibold` (600) allowed.
- **Using undefined Tailwind v4 tokens:** Phase 60 UI BLOCKER lesson — any token not in `src/index.css @theme {}` silently no-ops and renders invisible. Check `var(--color-surface-elevated)` etc. exist before use.
- **Calling `rag-retrieve` from browser directly:** Evidence drawer must call it server-to-server (Edge Fn) or via the typed `retrieveRagChunks` client. Direct browser fetch to `rag-retrieve` bypasses the auth pattern.
- **Returning `auth.uid()` from `publish_protocol` to browser:** The errcode `42501` + structured `SELF_REVIEW_REJECTED` message is sufficient; never expose raw DB error strings.
- **Using `text-sm`, `text-lg`, `text-base`, `text-xl`, `text-2xl`:** Use only `text-[11px]`, `text-[13px]`, `text-[18px]`, `text-heading` (28px). Typography ceiling is enforced by gsd-ui-auditor.
- **Deno top-level `Deno.serve()` without `import.meta.main` guard:** Per `reference_deno_test_top_level_serve_trap` — project Edge Fns use `Deno.serve()` unguarded, so `deno test path/` triggers real HTTP server. Separate `handler.ts` from `index.ts` (per D-60-05-01 pattern) so tests can import handler without spawning the server.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search + rerank | Custom pgvector query + scoring | `_shared/rag-retrieve.ts` → `rag-retrieve` Edge Fn | Already handles HNSW ANN + Cohere rerank + Jina fallback + Zod schema validation + retry logic |
| 2-person review DB enforcement | Direct UPDATE in RPC | `FOR UPDATE` lock + `auth.uid() = created_by` guard (see `approve_rag_chunk` template) | Prevents concurrent double-approve race; `approve_rag_chunk` is the production-tested shape |
| PostHog LLM event emission | Hand-rolled fetch to PostHog | `_shared/posthog-rag-events.ts` `emitAiGeneration()` | Typed; enforces D-13 userId non-empty invariant; includes `vendor` field automatically |
| PHARMA-02 safety check | Ad-hoc regex in Edge Fn | `_shared/pharma-02-carveout.ts` `assertNoPharma02DoseQuotes()` | 3-layer invariant Layer 2; if hand-rolled it breaks the CI grep gate (Layer 3) |
| OpenRouter HTTP client | Direct `fetch` to OpenRouter with ad-hoc retry | Mirror `rag-summarize-and-chunk/anthropic.ts` structure | Retry delays, PHI-safe logging, cost constants already solved |
| Citation marker parsing | Custom regex parser | `_shared/rag-retrieve.ts` already returns `chunk_id` list; `remark-citations.ts` has UUID regex pattern | `UUID_CITATION_REGEX` already handles RFC 4122 UUIDs; reuse the pattern |
| Admin sub-nav routing | Custom router | `RagLayout.tsx` pathname-based `resolveActive` pattern | No react-router in admin shell (per `reference_react_router_consumer_admin_split` — react-router IS used in admin surfaces); mirror the pattern exactly |
| KB markdown rendering | Custom HTML renderer | `react-markdown` with pre-parse shortcode substitution | Already used in `KnowledgeArticleDetailPage.tsx` and `AIChatPanel.tsx`; XSS-safe by default |

**Key insight:** Every non-trivial technical problem in Phase 61 has already been solved in Phase 60. This is a composition phase, not a research phase. The research value is in confirming the analogs exist and documenting how to assemble them correctly.

---

## Common Pitfalls

### Pitfall 1: `SELF_REVIEW_REJECTED` errcode vs human-readable message

**What goes wrong:** Supabase JS client surfaces the raw `RAISE EXCEPTION` message as the `code` field on the error object only if the Postgres error is a custom one. The UI needs to detect the `SELF_REVIEW_REJECTED` sentinel string in the error message.
**Why it happens:** Supabase's PostgREST wraps DB exceptions; the `details` field carries the exception message string, not a structured code.
**How to avoid:** In the React UI, catch the RPC error and check `error.message.includes('SELF_REVIEW_REJECTED')` OR check `error.code === '42501'` + inspect `error.details` for the sentinel. Show toast "Another admin must review this protocol before publish."
**Warning signs:** If the toast never appears and the Publish button is missing from the reviewer's DOM, the review state condition is wrong.

### Pitfall 2: Slug uniqueness across versions

**What goes wrong:** The slug `tirzepatide-12-wk-titration-v1` collides with `tirzepatide-12-wk-titration-v2` if slug is derived only from name. Public `/protocols/<slug>` route would resolve to the wrong version.
**Why it happens:** Generated slug includes version suffix (`-v{N}`) per the schema pattern; but the public route should serve the LATEST published version by compound-slug (without version suffix).
**How to avoid:** Store a separate `base_slug` (without `-vN`) on each row. The public `/protocols/<slug>` RPC queries `WHERE base_slug = p_slug AND review_state = 'published'` and returns the highest version. The `slug` with version suffix is for admin audit use only.

### Pitfall 3: `patient_protocol_assignment` non-destructive merge race

**What goes wrong:** If `assign_protocol_to_patient` is called twice (double-submit), two rows are inserted and MedicationTab shows duplicate Expected rows.
**Why it happens:** No `UNIQUE` constraint on `(patient_id, protocol_id)` → no idempotency.
**How to avoid:** Add `UNIQUE(patient_id, protocol_id)` to `patient_protocol_assignment`. The SECDEF RPC should use `INSERT ... ON CONFLICT (patient_id, protocol_id) DO UPDATE SET version = EXCLUDED.version, started_at = now()` for re-assignment (user adopts a newer version).

### Pitfall 4: `admin_ai_assist_log` rate limit off-by-one on day boundary

**What goes wrong:** `COUNT(*) WHERE actor_id = auth.uid() AND created_at >= CURRENT_DATE` crosses midnight UTC mid-session and suddenly unblocks a capped admin.
**Why it happens:** `CURRENT_DATE` is evaluated at statement start but the session may span midnight.
**How to avoid:** Use `date_trunc('day', now() AT TIME ZONE 'UTC')` for consistent UTC-day boundary in the RPC. Document that the limit resets at midnight UTC (per CONTEXT.md copy).

### Pitfall 5: OpenRouter dotted model ID in PostHog vs hyphenated guard

**What goes wrong:** Phase 60 memory note (`reference_anthropic_model_id_hyphenated_format`) says Anthropic API rejects dotted IDs. The CI grep gate looks for hyphenated model IDs. OpenRouter uses DOTTED IDs.
**Why it happens:** The hyphenated rule applies only to direct Anthropic API calls. OpenRouter's API uses dotted conventions.
**How to avoid:** In `protocol-ai-assist`, use `anthropic/claude-sonnet-4-5` (dotted, for the actual API call) and emit `model: 'openrouter/anthropic/claude-sonnet-4-5'` to PostHog (vendor-prefixed, for cost tracking). Do NOT use hyphenated in either place for this Fn. Suspend the hyphenated grep gate for this Fn (same as Phase 60 override pattern).

### Pitfall 6: `protocol_evidence.step_id NOT NULL` — broken FK if step is removed

**What goes wrong:** Admin removes a step row that has attached evidence. If `protocol_steps` has evidence FK'd to it, the DELETE fails.
**Why it happens:** `step_id FK REFERENCES protocol_steps(id)` without cascade.
**How to avoid:** Add `ON DELETE CASCADE` on `protocol_evidence.step_id → protocol_steps.id`. When a step is removed, its evidence is also removed. The "remove step" undo Toast (6s window) must INSERT both the step AND its evidence back.

### Pitfall 7: `selectView` ordering for `/protocols/<slug>` route

**What goes wrong:** If the `/protocols/*` branch is ordered after the `/admin/*` branch in `selectView`, an admin user visiting `/protocols/foo` sees the admin shell.
**Why it happens:** `selectView` uses early-return ordering; branches match the first condition satisfied.
**How to avoid:** Place `/protocols/*` AFTER `/knowledge/*` (Phase 60-13 precedent) but BEFORE `/clinic/*` and any auth-gated dashboard branches. The guard is `opts.user ? 'protocols' : 'auth'` (unlike `/knowledge/*` which is public-no-auth).

---

## Code Examples

### SECDEF RPC `assign_protocol_to_patient`

```sql
-- Source: CONTEXT.md decisions + approve_rag_chunk pattern
create or replace function public.assign_protocol_to_patient(
  p_protocol_id uuid,
  p_version     int,
  p_patient_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_state public.protocol_review_state;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select review_state
  into   v_state
  from   public.protocols
  where  id = p_protocol_id and version = p_version;

  if not found or v_state <> 'published' then
    raise exception 'protocol % v% is not published', p_protocol_id, p_version;
  end if;

  insert into public.patient_protocol_assignment
    (patient_id, protocol_id, version, started_at)
  values
    (p_patient_id, p_protocol_id, p_version, now())
  on conflict (patient_id, protocol_id)
  do update set version = excluded.version, started_at = now();
end
$$;

revoke all on function public.assign_protocol_to_patient(uuid, int, uuid) from public;
grant execute on function public.assign_protocol_to_patient(uuid, int, uuid) to authenticated;
```

### ProtocolsLayout (Admin Sub-Nav)

```typescript
// Source: verified pattern from src/components/admin/rag/RagLayout.tsx
// Mirror exactly — pathname-based sub-nav, no react-router
const SUB_ROUTES = [
  { key: 'list',    label: 'Protocols', path: 'list',    Component: ProtocolsListPage },
  { key: 'drafts',  label: 'Drafts',    path: 'drafts',  Component: ProtocolsListPage },  // filtered view
] as const;

function resolveActive(pathname: string): typeof SUB_ROUTES[number] {
  const m = pathname.match(/^\/admin\/protocols\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  return SUB_ROUTES.find((r) => r.path === seg) ?? SUB_ROUTES[0]!;
}
```

### EvidenceSearchSheet calling `rag-retrieve`

```typescript
// Source: _shared/rag-retrieve.ts typed client + CONTEXT.md decisions
// Called from browser via supabase.functions.invoke (user JWT forwarded automatically)
async function searchEvidence(query: string) {
  const { data, error } = await supabase.functions.invoke('rag-retrieve', {
    body: { query, k: 10, filters: { surface: 'coach' } },
  });
  if (error) throw error;
  return data.chunks; // RagRetrievedChunk[]
}
```

### `protocol-ai-assist` handler shape

```typescript
// Source: D-60-05-01 pattern (handler.ts separated from index.ts for testability)
export interface AiAssistDeps {
  openrouterKey: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
}

export async function handleAiAssist(
  req: AiAssistRequest,
  deps: AiAssistDeps
): Promise<AiAssistResponse> {
  // 1. Rate-limit check: count admin_ai_assist_log for today
  // 2. Retrieve top-5 RAG chunks via retrieveRagChunks({ query: compoundQuery, k: 5 })
  // 3. PHARMA-02 carveout: if topic_tag is gated → force refusal
  // 4. Call OpenRouter anthropic/claude-sonnet-4-5 with RAG context injected
  // 5. Parse response: { dose_mg, monitoring[], cited_chunk_ids[] }
  // 6. If no cited_chunk_ids → force refusal: true
  // 7. INSERT into admin_ai_assist_log
  // 8. emitAiGeneration({ model: POSTHOG_MODEL, vendor: 'openrouter_anthropic', ... })
  // 9. Return { dose_mg, monitoring, cited_chunk_ids, refusal, refusal_reason }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct Anthropic API calls | OpenRouter `anthropic/claude-*` model IDs | Phase 60-04 override 2026-05-26 | Dotted model IDs in API calls; vendor-prefixed in PostHog; grep gates suspended for affected Fns |
| `text-sm`, `text-lg` utilities | `text-[11px]`, `text-[13px]`, `text-[18px]`, `text-heading` | Phase 60 UI BLOCKER | Mandatory — gsd-ui-auditor will BLOCK on violations |
| Undefined `@theme` tokens (e.g., `text-text-primary`) | Only tokens defined in `src/index.css @theme {}` | Phase 60 UI BLOCKER | Undefined tokens silently no-op → invisible text |
| `remark` AST plugins for markdown extensions | Pure string parser pre-pass (no remark dependency) | Phase 60-10 `remark-citations.ts` | Lighter; same result; no remark peer-dep issues |

**Deprecated/outdated:**
- `font-medium`, `font-bold`: not allowed per 2-weight ceiling (400/600 only)
- Drag-and-drop step ordering: explicitly deferred by CONTEXT.md
- Protocol-level-only evidence attach: `step_id NOT NULL` enforces step-level granularity

---

## Reuse Targets (Explicit per `feedback_planner_prompt_explicit_reuse_targets`)

The planner MUST name these exact files in plan task descriptions, not just "reuse admin patterns":

| New File | Reuse Verbatim From | What to Reuse |
|----------|---------------------|---------------|
| `ProtocolsLayout.tsx` | `src/components/admin/rag/RagLayout.tsx` | Entire pathname-based sub-nav structure; `resolveActive`; `grid gap-6 lg:grid-cols-[200px_1fr]` layout |
| `ProtocolsListPage.tsx` | `src/components/admin/rag/RagQueuePage.tsx` | List table shape; filter pills; empty state; J/K keyboard nav; Shift+? help modal |
| `ProtocolEditorPage.tsx` | `src/components/admin/rag/QueueDetailPane.tsx` | Two-column layout `grid gap-6 lg:grid-cols-[1fr_320px]`; metadata panel pattern |
| `EvidenceSearchSheet.tsx` | `src/components/admin/rag/AddSourceSheet.tsx` + `RejectReasonSheet.tsx` | Sheet DS primitive wrapping; focus trap; close-on-Escape |
| `ProtocolStatusBadge.tsx` | `src/components/admin/rag/TierBadge.tsx` | Thin `Badge` DS wrapper with aria-label describing state semantics |
| `ProtocolKeyboardHelpModal.tsx` | `src/components/admin/rag/QueueKeyboardHelpModal.tsx` | Keyboard shortcut table layout; modal DS primitive usage |
| `CitationPopover.tsx` | `src/components/dashboard/ai/CitationPopover.tsx` | Reuse verbatim — do NOT copy; import from original path |
| `TierBadge.tsx` | `src/components/admin/rag/TierBadge.tsx` | Reuse verbatim — import from original path |
| `publish_protocol` SECDEF | `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` `approve_rag_chunk` | Copy shape: `FOR UPDATE` lock → 2-person guard → state precondition → UPDATE → audit INSERT |
| `protocol-ai-assist` OpenRouter call | `supabase/functions/rag-summarize-and-chunk/anthropic.ts` | OpenRouter client shape; retry delays; PHI-safe logging; POSTHOG_MODEL constant |
| PostHog event emission in Edge Fn | `supabase/functions/_shared/posthog-rag-events.ts` `emitAiGeneration` | Import `emitAiGeneration` directly; never hand-roll |
| KB shortcode parser | `src/lib/rag/remark-citations.ts` | UUID regex pattern; pre-parse segment approach |
| Public `/protocols/*` route | `src/App.tsx` lines 687-693 (`/knowledge/*` branch) | `selectView` pathname branch + view type extension + lazy component import pattern |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenRouter model ID `anthropic/claude-sonnet-4-5` is currently available and priced reasonably for admin use (not haiku) | Standard Stack | If unavailable, fallback to `anthropic/claude-haiku-4.5` which is faster/cheaper but less capable for synthesis; planner should add a config constant |
| A2 | `var(--color-warning-soft)` and `var(--color-rose-soft)` are defined in `src/index.css @theme {}` | UI/Color | If undefined, the review banner background renders invisible (Phase 60 BLOCKER class issue); executor must grep for these before use |
| A3 | Phase 30 roster patient-list component is importable from `AdoptProtocolSheet` (i.e., it's a named export in `src/components/clinic/roster/`) | Clinician Integration | If it's a full page component not split into a reusable list, the executor must extract the list into a new component first |
| A4 | `public.protocols` `slug` generation via `generated always as` computed column works in the Supabase PostgreSQL version | DB Schema | If the Postgres version doesn't support computed slug generation, use a trigger instead (same pattern as `tg_set_updated_at`) |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (There are 4 assumptions above requiring confirmation at plan/execute time.)

---

## Open Questions

1. **Phase 30 roster patient-list component reusability**
   - What we know: `src/components/clinic/roster/` directory exists; `ClinicWorkspace.tsx` uses it
   - What's unclear: Whether the patient picker is a standalone exported component or embedded in a page-level component
   - Recommendation: Executor reads `src/components/clinic/roster/` at execute time; if not standalone, extract to `PatientPickerList.tsx` as a Wave 0 sub-task

2. **`var(--color-warning-soft)` / `var(--color-rose-soft)` token presence**
   - What we know: UI-SPEC uses `var(--color-rose-soft)` for review banner background
   - What's unclear: Whether these tokens exist in `src/index.css @theme {}`
   - Recommendation: Executor greps `src/index.css` for `rose-soft` before using it; if absent, add the token in the migration plan's Wave 0 task

3. **`patient_protocol_assignment` deviation calculation**
   - What we know: `started_at + current week number` determines which `protocol_steps.week` applies
   - What's unclear: Whether the week computation belongs in the DB (RPC), in an Edge Fn, or in the browser
   - Recommendation: Compute in browser (simple arithmetic from `started_at`); no server round-trip needed for display

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| OPENROUTER_API_KEY | `protocol-ai-assist` Edge Fn | ✓ (Phase 60.5) | — | AI-assist returns 503 + Slack alert if missing |
| Supabase project `ytnsipxxmzgaebkqmokp` | All DB operations | ✓ | PostgreSQL | — |
| `rag-retrieve` Edge Fn | Evidence search drawer | ✓ (Phase 60-06, deployed) | — | Evidence drawer shows error state |
| `supabase/functions/_shared/pharma-02-carveout.ts` | `protocol-ai-assist` Layer 2 guard | ✓ | — | — |
| `npm run test:unit` (vitest) | Unit tests for new components | ✓ | vitest (package.json) | — |
| `$HOME/.deno/bin/deno` | Deno Edge Fn tests | ✓ (per `reference_deno_binary_path`) | — | Use `$HOME/.deno/bin/deno` explicitly |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None identified.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (npm) + Deno test (Edge Fns) |
| Config file | `vite.config.ts` (per `reference_vitest_4_projects_config_masks_default` — use `npx vitest run --config vite.config.ts`) |
| Quick run command | `npx vitest run --config vite.config.ts src/components/admin/protocols/` |
| Full suite command | `npm run test:unit` |
| Edge Fn test command | `$HOME/.deno/bin/deno test --no-check supabase/functions/protocol-ai-assist/__tests__/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROTOCOL-01 | Migration creates 6 tables with correct columns/constraints | SQL/integration | vitest rls suite | ❌ Wave 0 |
| PROTOCOL-02 | ProtocolsListPage renders list + filter pills + empty state | unit | `npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx` | ❌ Wave 0 |
| PROTOCOL-03 | EvidenceSearchSheet calls rag-retrieve and renders results | unit (mocked) | `npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx` | ❌ Wave 0 |
| PROTOCOL-04 | `publish_protocol` returns SELF_REVIEW_REJECTED when actor = creator | SQL | `$HOME/.deno/bin/deno test --no-check supabase/functions/protocol-ai-assist/__tests__/` | ❌ Wave 0 |
| PROTOCOL-05 | Editing published protocol creates new version row; prior stays published | SQL | vitest rls suite | ❌ Wave 0 |
| PROTOCOL-06 | AdoptProtocolSheet renders patient picker + diff modal | unit (mocked) | `npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/AdoptProtocolSheet.test.tsx` | ❌ Wave 0 |
| PROTOCOL-07 | MedicationTab renders Expected/Logged deviation row when protocol assigned | unit | `npx vitest run --config vite.config.ts src/components/dashboard/tabs/MedicationTab.test.tsx` | ✅ exists (extend) |
| PROTOCOL-08 | ProtocolSummaryCard renders from `[protocol:<id>]` shortcode | unit | `npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --config vite.config.ts src/components/admin/protocols/`
- **Per wave merge:** `npm run test:unit && $HOME/.deno/bin/deno test --no-check supabase/functions/protocol-ai-assist/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx` — covers PROTOCOL-02
- [ ] `src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx` — covers PROTOCOL-03
- [ ] `src/components/admin/protocols/__tests__/AdoptProtocolSheet.test.tsx` — covers PROTOCOL-06
- [ ] `src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx` — covers PROTOCOL-08
- [ ] `supabase/functions/protocol-ai-assist/__tests__/handler.test.ts` — covers PROTOCOL-04 AI-assist + rate-limit

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes — all RPCs require `is_staff()` or `auth.uid()` | `public.is_staff()` SECDEF helper + Supabase Auth JWT |
| V3 Session Management | no — standard Supabase session; no new session logic | — |
| V4 Access Control | yes — 2-person review enforcement; patient data isolation | SECDEF RPCs with `FOR UPDATE` + `auth.uid()` guard; RLS `auth.uid() = patient_id` for patient tables |
| V5 Input Validation | yes — all RPC inputs are typed uuid/int/text; AI output validated | Postgres parameter types + Zod schema on Edge Fn response |
| V6 Cryptography | no — no new crypto; existing Supabase auth handles JWT | — |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Self-review of protocol (PHARMA-02 safety gate bypass) | Elevation of privilege | 3-layer: DB `FOR UPDATE` guard + UI DOM removal + CI eval test |
| AI-assist prompt injection via compound name field | Tampering | Sanitize compound input before injecting into prompt; use structured JSON message format |
| Rate limit bypass by cycling admin accounts | Denial of service / abuse | Rate limit is per `actor_id` (auth.uid()); each admin account has separate 50/day counter |
| Off-label recommendation without citation | Information disclosure (PHARMA-02) | Server-side: if `cited_chunk_ids.length === 0` → force `refusal: true`; `_shared/pharma-02-carveout.ts` Layer 2 |
| Patient cross-tenant protocol assignment | Elevation of privilege | `assign_protocol_to_patient` SECDEF validates that patient is in caller's org (if org-scoped) — planner must confirm org-scoping need |
| `[protocol:<id>]` shortcode injection (XSS) | Tampering | react-markdown doesn't render raw HTML by default; `ProtocolSummaryCard` renders via React (escaped); no `dangerouslySetInnerHTML` on protocol content |
| Public `/protocols/<slug>` enumeration | Information disclosure | RLS: only `review_state = 'published'` rows SELECT-able; slug is not sequential (UUID-based); `noindex` prevents search engine caching |

---

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` — `approve_rag_chunk` SECDEF template (verified verbatim)
- `supabase/functions/_shared/rag-retrieve.ts` — typed RAG retrieval client (verified verbatim)
- `supabase/functions/_shared/pharma-02-carveout.ts` — PHARMA-02 runtime guard (verified verbatim)
- `src/components/admin/rag/RagLayout.tsx` — admin sub-nav pattern (verified verbatim)
- `src/components/dashboard/ai/CitationPopover.tsx` — citation popover (verified verbatim)
- `src/lib/rag/remark-citations.ts` — citation parser pattern (verified verbatim)
- `src/App.tsx` lines 687-693 — `selectView` public route pattern (verified verbatim)
- `supabase/functions/rag-summarize-and-chunk/anthropic.ts` — OpenRouter client pattern (verified verbatim)
- `supabase/functions/_shared/posthog-rag-events.ts` — typed PostHog emitter (verified verbatim)
- `.planning/phases/61-admin-protocol-creator/61-CONTEXT.md` — locked decisions (primary source)
- `.planning/phases/61-admin-protocol-creator/61-UI-SPEC.md` — 6/6 PASS design contract (primary source)
- `.planning/REQUIREMENTS.md` PROTOCOL-01..08 — requirement definitions (primary source)

### Secondary (MEDIUM confidence)
- `src/lib/admin/modules.ts` — ADMIN_MODULES manifest pattern for new entry (verified)
- `src/components/admin/rag/TierBadge.tsx` + `QueueKeyboardHelpModal.tsx` + `AddSourceSheet.tsx` — component analogs (verified file existence)
- `package.json` — no new packages required (verified)
- `_shared/deno.json` — Deno import map confirms zod@^3 for Edge Fns (verified)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; all existing Phase 60 helpers verified live
- Architecture: HIGH — every pattern has a verbatim analog in the codebase
- Pitfalls: HIGH — derived from Phase 60 execution lessons documented in MEMORY.md
- SECDEF RPC shape: HIGH — `approve_rag_chunk` is the direct template; read verbatim
- UI component shape: HIGH — `RagLayout` / `QueueDetailPane` are the direct templates

**Research date:** 2026-05-26
**Valid until:** 2026-07-26 (stable — all dependencies are already deployed; no fast-moving dependencies)
