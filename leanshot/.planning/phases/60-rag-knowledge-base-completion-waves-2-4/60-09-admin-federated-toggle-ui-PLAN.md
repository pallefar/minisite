---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 09
type: execute
wave: 1
depends_on: ["60-01", "60-07"]
files_modified:
  - leanshot/src/components/admin/rag/FederatedSourcesPage.tsx
  - leanshot/src/components/admin/rag/FederatedSourceRow.tsx
  - leanshot/src/components/admin/rag/PullHistoryConfirmDialog.tsx
  - leanshot/src/lib/admin/rag/federated-api.ts
  - leanshot/src/components/admin/rag/RagLayout.tsx
  - leanshot/src/lib/admin/rag/__tests__/federated-api.test.ts
  - leanshot/src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx
  - leanshot/src/components/admin/rag/__tests__/FederatedSourceRow.test.tsx
autonomous: true
requirements: ["RAG-06"]
tags: ["admin", "rag", "federated", "ui", "react"]

must_haves:
  truths:
    - "Admin can navigate to /admin/rag/federated and see exactly 3 source rows (PubMed (NLM E-utilities), OpenFDA, DailyMed)."
    - "Each row shows current enabled state, last_synced_at as relative time, last_error pill when non-null, and sync cadence label (Daily 3:00 AM UTC)."
    - "Toggling Sync enabled on a row invokes the SECDEF RPC, persists `federated_sources.enabled`, optimistically updates UI, and rolls back on error with toast."
    - "Pull full history button is gated behind an inline confirm Dialog with cost-warning copy; on confirm it POSTs to the 60-07 federated adapter Fn with `pull_mode=historical` and shows a status toast."
    - "Page renders within RagLayout (sticky tab nav) at the federated tab key; non-staff users hitting the page get 0 rows (RLS) and a guidance empty state."
    - "All copy strings match UI-SPEC §2 / Copywriting Contract verbatim (EN only at MVP)."
    - "Component is keyboard-navigable, screen-reader-friendly, dark-mode-correct, and respects useReducedMotion()."
  artifacts:
    - path: "leanshot/src/components/admin/rag/FederatedSourcesPage.tsx"
      provides: "Federated sources admin page component (default export)"
      contains: "export default function FederatedSourcesPage"
    - path: "leanshot/src/components/admin/rag/FederatedSourceRow.tsx"
      provides: "Per-source Card row with Toggle + last-sync + last-error + Pull history CTA"
      contains: "export function FederatedSourceRow"
    - path: "leanshot/src/components/admin/rag/PullHistoryConfirmDialog.tsx"
      provides: "Inline confirm Dialog for destructive Pull-history action (a11y modal)"
      contains: "export function PullHistoryConfirmDialog"
    - path: "leanshot/src/lib/admin/rag/federated-api.ts"
      provides: "Typed client wrapper over federated_sources SECDEF RPCs + Pull-history Fn invocation"
      exports: ["listFederatedSources", "setFederatedSourceEnabled", "triggerHistoricalPull", "FederatedSource"]
    - path: "leanshot/src/components/admin/rag/RagLayout.tsx"
      provides: "SUB_ROUTES extended with federated entry"
      contains: "federated"
  key_links:
    - from: "leanshot/src/components/admin/rag/FederatedSourcesPage.tsx"
      to: "leanshot/src/lib/admin/rag/federated-api.ts"
      via: "named import { listFederatedSources, setFederatedSourceEnabled, triggerHistoricalPull }"
      pattern: "from '@/lib/admin/rag/federated-api'"
    - from: "leanshot/src/lib/admin/rag/federated-api.ts"
      to: "supabase RPC `list_federated_sources` + `set_federated_source_enabled` (from 60-01)"
      via: "supabase.rpc(...) wrapper"
      pattern: "supabase\\.rpc\\('(list_federated_sources|set_federated_source_enabled)'"
    - from: "leanshot/src/lib/admin/rag/federated-api.ts"
      to: "Edge Fns `rag-federated-pubmed` / `rag-federated-fda` / `rag-federated-dailymed` (from 60-07)"
      via: "supabase.functions.invoke(...) with body { pull_mode: 'historical' }"
      pattern: "supabase\\.functions\\.invoke\\('rag-federated-"
    - from: "leanshot/src/components/admin/rag/RagLayout.tsx"
      to: "leanshot/src/components/admin/rag/FederatedSourcesPage.tsx"
      via: "lazy import + SUB_ROUTES entry"
      pattern: "FederatedSourcesPage"
---

<objective>
Build the admin Federated Sources management page at `/admin/rag/federated` (UI-SPEC §2 Surface 2). Admins toggle per-source sync enablement (PubMed / OpenFDA / DailyMed), inspect last-sync timestamp + last-error, and trigger a one-shot historical backfill. The page is the SOLE operator surface for federated adapters; without it, 60-07 adapter Fns can only be invoked by direct SQL or cron — unacceptable for runtime control.

Purpose:
- Close RAG-06 admin-controllability requirement: per-source enable/disable + historical pull.
- Provide visibility into adapter health (last_sync_at, last_error) to detect rate-limit / API-key failures before they cascade.
- Establish a typed client wrapper (`federated-api.ts`) the operator UI shares with future cost-dashboard cross-links (60-14 reads sync overhead).

Output:
- `FederatedSourcesPage.tsx` mounted under `RagLayout` `SUB_ROUTES` at path `federated`.
- `FederatedSourceRow.tsx` self-contained per-source Card (Toggle + meta + Pull-history CTA).
- `PullHistoryConfirmDialog.tsx` destructive-confirm modal.
- `federated-api.ts` typed RPC + Fn-invoke wrapper.
- Vitest unit tests covering: list render, optimistic toggle + rollback, confirm-dialog gating of historical pull, empty/error states.
- A11y baseline: `role="switch"` + `aria-checked` on toggle, `role="dialog"` + `aria-modal` + focus trap on confirm dialog, `aria-live="polite"` on last-sync timestamp updates, focus return on dialog close.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/PROJECT.md
@leanshot/.planning/ROADMAP.md
@leanshot/.planning/STATE.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@leanshot/CLAUDE.md

# Sibling plans this depends on
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-01-data-layer-migrations-PLAN.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-07-federated-adapters-PLAN.md

# Existing patterns to reuse verbatim
@leanshot/src/components/admin/rag/RagLayout.tsx
@leanshot/src/components/admin/rag/RagTopicsPage.tsx
@leanshot/src/components/admin/rag/RagSourcesPage.tsx
@leanshot/src/components/ui/Card.tsx
@leanshot/src/components/ui/Pill.tsx
@leanshot/src/components/ui/Modal.tsx
@leanshot/src/components/ui/Button.tsx

<interfaces>
<!-- Contracts the executor uses without re-exploring the codebase. -->
<!-- Phase 60 owns these tables/RPCs/Fns; signatures derived from outline + CONTEXT.md. -->

From leanshot/supabase/migrations/20261201000001_phase60_kb_tables.sql (60-01):
```sql
-- Table created by 60-01
create table public.federated_sources (
  name             text primary key,           -- 'pubmed' | 'openfda' | 'dailymed'
  display_name     text not null,              -- 'PubMed (NLM E-utilities)' | 'OpenFDA' | 'DailyMed'
  enabled          boolean not null default false,
  sync_cron        text not null,              -- '0 3 * * *'
  sync_cadence_label text not null,            -- 'Daily 3:00 AM UTC'
  last_synced_at   timestamptz null,
  last_error       text null,
  updated_at       timestamptz not null default now()
);
-- Seed rows for 'pubmed', 'openfda', 'dailymed' inserted by 60-01.
```

From leanshot/supabase/migrations/20261201000002_phase60_secdef_rpcs.sql (60-01):
```sql
-- Returns rows visible to staff only (RLS via public.is_staff()).
create or replace function public.list_federated_sources()
  returns setof public.federated_sources
  language sql security definer set search_path = public, auth as $$
    select * from public.federated_sources order by name;
  $$;

-- Toggles enabled; writes updated_at; staff-only.
create or replace function public.set_federated_source_enabled(
  p_name text,
  p_enabled boolean
) returns public.federated_sources
  language plpgsql security definer set search_path = public, auth as $$
  declare r public.federated_sources;
  begin
    if not public.is_staff() then raise exception 'unauthorized'; end if;
    update public.federated_sources
       set enabled = p_enabled, updated_at = now()
     where name = p_name
     returning * into r;
    return r;
  end;
  $$;
```

From leanshot/supabase/functions/rag-federated-pubmed/index.ts (60-07) (and -fda, -dailymed analogs):
```typescript
// POST body shape that triggers a historical (non-cron) pull
interface FederatedPullRequest {
  pull_mode: 'cron' | 'historical';   // 'historical' = bypass last-30-days seed limit
  // No other body fields at MVP.
}
// Response: 202 Accepted + { queued: true, job_id?: string }
```

From leanshot/src/lib/supabase.ts (existing project Supabase client):
```typescript
export const supabase: SupabaseClient;   // singleton, anon key, RLS-honored
// .rpc(name, args), .functions.invoke(name, { body }), .auth.getUser()
```

From leanshot/src/components/ui/Card.tsx:
```typescript
export interface CardProps {
  variant?: 'default' | 'elevated' | 'interactive' | 'hero' | 'flat';
  span?: 4 | 6 | 7 | 8 | 12;
  children: React.ReactNode;
  className?: string;
}
```

From leanshot/src/components/ui/Modal.tsx (existing a11y pattern — role="dialog" + aria-modal + focus trap):
```typescript
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}
```

From leanshot/src/hooks/useToast.ts (existing):
```typescript
export function useToast(): {
  show: (msg: string, tone?: 'info' | 'success' | 'danger') => void;
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Typed federated-api client wrapper + unit tests</name>
  <files>leanshot/src/lib/admin/rag/federated-api.ts, leanshot/src/lib/admin/rag/__tests__/federated-api.test.ts</files>
  <behavior>
    - `listFederatedSources()` calls `supabase.rpc('list_federated_sources')`, returns `FederatedSource[]` on success, throws on RPC error.
    - `setFederatedSourceEnabled(name, enabled)` calls `supabase.rpc('set_federated_source_enabled', { p_name, p_enabled })`, returns updated row.
    - `triggerHistoricalPull(name)` maps name → Fn slug (`'pubmed' → 'rag-federated-pubmed'`, etc.) and invokes via `supabase.functions.invoke(slug, { body: { pull_mode: 'historical' } })`; throws on non-2xx.
    - Unknown source name in `triggerHistoricalPull` throws synchronously (`'Unknown federated source: <name>'`) — no Fn call leaks.
    - All three functions surface RPC/Fn errors with the underlying `error.message` (so UI toast shows real cause).
    - `FederatedSource` TypeScript interface matches the SQL table shape exactly (name, display_name, enabled, sync_cron, sync_cadence_label, last_synced_at: string|null, last_error: string|null, updated_at).
    - Tests mock `@/lib/supabase` and assert each branch (success, RPC error, Fn error, unknown-source guard).
  </behavior>
  <action>
    Create `leanshot/src/lib/admin/rag/federated-api.ts` exporting the four symbols listed in must_haves.key_links. Use the existing `supabase` singleton at `@/lib/supabase` (verify the export name with `grep -n "^export" leanshot/src/lib/supabase.ts` first; adjust import if it exports `supabaseClient` instead). Source-name → Fn-slug map MUST be a const `Record<'pubmed' | 'openfda' | 'dailymed', string>` so TS catches typos at compile time. Per [[reference_supabase_service_role_key_format_divergence]] the historical-pull Fn invocation uses the user's session JWT (default `functions.invoke` behavior) — NOT service-role — because it's an admin-authenticated browser call and the Fn already trusts `public.is_staff()` via SECDEF check (60-07 owns this). Co-locate Vitest unit tests under `__tests__/federated-api.test.ts` — mock the supabase module via `vi.mock('@/lib/supabase', ...)`. Per [[reference_vitest_4_projects_config_masks_default]] gate via `npx vitest run --config vite.config.ts leanshot/src/lib/admin/rag/__tests__/federated-api.test.ts`.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/federated-api.test.ts</automated>
  </verify>
  <done>federated-api.ts exports listFederatedSources, setFederatedSourceEnabled, triggerHistoricalPull, FederatedSource; all 4 test branches (success / RPC error / Fn error / unknown-source guard) pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: FederatedSourceRow component with Toggle + meta + Pull-history CTA</name>
  <files>leanshot/src/components/admin/rag/FederatedSourceRow.tsx, leanshot/src/components/admin/rag/PullHistoryConfirmDialog.tsx, leanshot/src/components/admin/rag/__tests__/FederatedSourceRow.test.tsx</files>
  <behavior>
    - Renders `<Card variant="default" span={12}>` containing: left = source display_name (18px/600, `text-lg font-semibold`) + sync cadence label (13px/400 `text-sm text-text-secondary`); center = relative-time last-sync ("Last synced 3 hours ago" or "Never synced") + last-error Pill (warning tone, only when `last_error != null`); right = `<button role="switch" aria-checked={enabled} aria-label="Enable {display_name} sync">`.
    - Below the row footer: ghost `<Button>` labeled `Pull full history`. Clicking opens `PullHistoryConfirmDialog`; dialog confirm fires `onTriggerPull(name)` (passed via props). Dialog Cancel returns focus to the trigger button.
    - The Pull-history button is disabled while `enabled === false` (cannot historical-pull a disabled source). Disabled state has `aria-disabled="true"` and explanatory `title="Enable sync before pulling history"`.
    - Per UI-SPEC §2: no separate desktop/mobile components; single responsive layout via Tailwind flex/grid.
    - Per UI-SPEC critical invariants: typography 4-size ceiling (11/13/18/28 only — NO 16px); colors are tokens only (`text-text`, `text-text-secondary`, `text-text-tertiary`, `text-warning`); dark-mode parity via existing semantic tokens.
    - Per UI-SPEC §Animation: useReducedMotion() gates any toggle/dialog transitions.
    - Relative time computed inline with `Intl.RelativeTimeFormat` (no dayjs/date-fns — bundle constraint per CLAUDE.md).
    - `aria-live="polite"` on the last-sync text region so screen readers announce updates after a toggle/pull.
    - Last-error Pill text format: `Last error: {message}` (warning tone, low-emphasis); message truncated to 80 chars with `…`.
    - Tests assert: enabled toggle has aria-checked=true; disabled state disables Pull-history; click on Pull-history opens dialog; dialog Cancel closes without firing onTriggerPull; dialog Confirm fires onTriggerPull once with the source name; last_error null hides the pill; last_synced_at null shows "Never synced".
  </behavior>
  <action>
    Build `FederatedSourceRow.tsx` as a presentational component with props `{ source: FederatedSource; onToggle: (enabled: boolean) => void; onTriggerPull: () => void; isToggleBusy: boolean; isPullBusy: boolean }`. Use `<button role="switch">` for the Toggle — `Toggle` primitive does NOT exist in `src/components/ui/` (verified during planning); inline implementation here is correct per UI-SPEC §2 wording "enabled Toggle (aria-pressed on the toggle button itself)". Use existing `Card`, `Pill` (tone="warning"), `Button` (variant="ghost") primitives. Build `PullHistoryConfirmDialog.tsx` using the existing `Modal` primitive (which already provides role="dialog" + aria-modal + focus trap + ESC-close per `src/components/ui/Modal.tsx`); title = `Pull full history`, body = `This will fetch all available records and may increase costs significantly. Continue?` (per UI-SPEC §Copy), actions = `Cancel pull` (secondary) + `Pull history` (primary danger-styled). Wire dialog Confirm to call `props.onConfirm()` then close. Vitest + Testing Library; mock `useReducedMotion` to return false; use `userEvent` for keyboard tests (ESC closes dialog, Tab cycles within focus trap is enforced by Modal — trust the primitive, don't re-test). Per [[feedback_executor_tdd_scaffolds_sibling_plan_files]]: do NOT scaffold FederatedSourcesPage in this task — Task 3 owns it.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/FederatedSourceRow.test.tsx</automated>
  </verify>
  <done>FederatedSourceRow + PullHistoryConfirmDialog render correctly; all 7 behavior assertions pass; component uses only typography tokens 11/13/18 (no 16px); aria-checked, aria-label, aria-live, aria-disabled all wired.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: FederatedSourcesPage container — list + toggle + pull integration</name>
  <files>leanshot/src/components/admin/rag/FederatedSourcesPage.tsx, leanshot/src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx</files>
  <behavior>
    - On mount calls `listFederatedSources()`; while loading renders `Skeleton` placeholder; on success renders 3 `FederatedSourceRow` instances in stable order (pubmed, openfda, dailymed); on error renders `EmptyState` with `Failed to load federated sources. Refresh to try again.` (mirrors copy convention from UI-SPEC error states).
    - Page header: H1 `Federated Sources` (18px/600 per UI-SPEC — admin pages use 18px H1) + 1-line subtitle `Manage external data adapter sync schedules and historical backfills.` (13px/400 `text-text-secondary`). No Fraunces (Fraunces is consumer-hub-only per UI-SPEC Typography).
    - Toggle handler: optimistically updates local state, calls `setFederatedSourceEnabled`; on success shows `useToast().show('{display_name} sync enabled'|'disabled', 'success')`; on error rolls back local state and shows `useToast().show('Failed to update {display_name}: {error}', 'danger')`.
    - Pull-history handler: calls `triggerHistoricalPull(name)`; on success shows `useToast().show('Historical pull queued for {display_name}', 'success')`; on error shows danger toast with error message; dialog closes either way.
    - Empty result (non-staff RLS returns 0 rows): renders `EmptyState` heading `No access` body `Federated source management is restricted to staff accounts.` (uses existing `EmptyState` primitive).
    - Per-row busy state (`isToggleBusy` / `isPullBusy`) tracked in component-local state map keyed by source name, so toggling PubMed doesn't disable FDA's toggle.
    - Tests assert: loading → list render → toggle PubMed → setFederatedSourceEnabled called with ('pubmed', true); RPC failure → row reverts to previous enabled state; Pull-history full flow (open dialog → confirm → invoke); empty-list RLS path → "No access" empty state.
    - No `useEffect` infinite-loop traps: `listFederatedSources` called exactly once on mount (deps `[]`) — per CLAUDE.md eslint rule `react-hooks/exhaustive-deps`.
  </behavior>
  <action>
    Build `FederatedSourcesPage.tsx` as the default export. Use React 19 `use()` is NOT required — plain `useState` + `useEffect(() => { listFederatedSources().then(...) }, [])` is the existing pattern in `RagTopicsPage.tsx` and `RagSourcesPage.tsx` — match it for consistency. Per [[reference_codebase_maps_stale_post_v1_0]]: verify the pattern by reading `RagTopicsPage.tsx` lines 49-100 before writing — do NOT trust codebase maps. Use `useToast()` for all success/error feedback (toast tone follows existing convention: `'success'` for green-equivalent, `'danger'` for clay — Toast component owns the visual mapping). Render order is the SQL `order by name` order (alphabetical: dailymed, openfda, pubmed) — DO NOT re-sort in JS. Test file uses Testing Library `render` + mocks `@/lib/admin/rag/federated-api` + mocks `useToast`. Per UI-SPEC critical invariant #11: ensure NO `text-base` or `text-md` class slips in — grep the final file for those tokens and fail if present (`! grep -E 'text-(base|md)\\b' src/components/admin/rag/FederatedSourcesPage.tsx`). Per [[feedback_negation_grep_defeated_by_comment_string]]: do not put "text-base" or "text-md" inside comments either.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx && ! grep -nE 'text-(base|md)\b' src/components/admin/rag/FederatedSourcesPage.tsx src/components/admin/rag/FederatedSourceRow.tsx src/components/admin/rag/PullHistoryConfirmDialog.tsx</automated>
  </verify>
  <done>FederatedSourcesPage renders 3 rows, toggle/pull happy + sad paths verified, optimistic-update-with-rollback works, no 16px typography classes, eslint clean.</done>
</task>

<task type="auto">
  <name>Task 4: Mount FederatedSourcesPage in RagLayout SUB_ROUTES</name>
  <files>leanshot/src/components/admin/rag/RagLayout.tsx</files>
  <action>
    Edit `RagLayout.tsx` to (1) add `const FederatedSourcesPage = lazy(() => import('./FederatedSourcesPage'));` alongside the existing lazy imports (line ~22-23 region), (2) extend `SUB_ROUTES` const array with a new entry `{ key: 'federated', label: 'Federated', path: 'federated', Component: FederatedSourcesPage }` — insert it between `sources` and the cost/queue entries (Tab nav order: Topics, Sources, Federated, Queue, Telemetry, Cost) per UI-SPEC §2 admin-shell convention. (3) No router config changes elsewhere — the existing `resolveActive(pathname)` regex `/^\/admin\/rag\/?(?:([^/]+).*)?$/` already matches `/admin/rag/federated` and dispatches to the matching SUB_ROUTES entry by `path` field. Do NOT introduce react-router; per [[reference_react_router_consumer_admin_split]] the admin shell already uses the SUB_ROUTES pattern. Per [[feedback_batched_edits_verify_file_count]]: Read the file before editing to ensure Edit tool succeeds. After edit, `git diff --stat leanshot/src/components/admin/rag/RagLayout.tsx` should show exactly one file changed.
  </action>
  <verify>
    <automated>cd leanshot && grep -q "FederatedSourcesPage" src/components/admin/rag/RagLayout.tsx && grep -q "'federated'" src/components/admin/rag/RagLayout.tsx && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>RagLayout.tsx imports FederatedSourcesPage lazily; SUB_ROUTES contains a `federated` entry; tsc passes with no new errors.</done>
</task>

<task type="auto">
  <name>Task 5: A11y + full-suite gate</name>
  <files>leanshot/src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx</files>
  <action>
    Extend `FederatedSourcesPage.test.tsx` with one additional test block using `vitest-axe` (already in devDependencies — verify with `grep vitest-axe leanshot/package.json`; if absent, use `axe-core` directly with `axe.run(container)` pattern from existing admin tests like `src/components/admin/rag/__tests__/RagTopicsPage.test.tsx` if such test exists, else use Testing Library + `getAllByRole('switch')` to manually assert: each switch has accessible name, dialog has accessible name, no duplicate `id` attrs, no missing alt on icons). Final automated gate: full vitest run on the 3 test files (no full-suite — per STATE.md execution lesson "full-suite ~106-110 failing/24-25 baseline is FLAKY EnvironmentTeardownError — gate by own-tests + no-net-new") AND `tsc --noEmit` AND eslint on the 5 new source files. Per [[feedback_planner_silent_scope_reduction_patterns]]: this task is NOT a v2/placeholder — it is the FINAL a11y verification gate that signs off the entire plan; failure here blocks plan completion.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/federated-api.test.ts src/components/admin/rag/__tests__/FederatedSourceRow.test.tsx src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npx eslint src/components/admin/rag/FederatedSourcesPage.tsx src/components/admin/rag/FederatedSourceRow.tsx src/components/admin/rag/PullHistoryConfirmDialog.tsx src/lib/admin/rag/federated-api.ts src/components/admin/rag/RagLayout.tsx</automated>
  </verify>
  <done>All three test files pass; tsc clean; eslint clean on all 5 modified files; a11y assertions for switch/dialog roles documented in test output.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Supabase RPC | Admin browser submits toggle requests; RLS + `public.is_staff()` + SECDEF guard enforces authz. SECDEF body owned by 60-01. |
| Browser → Edge Fn (rag-federated-*) | Admin browser POSTs `pull_mode: 'historical'`; session JWT carried; Fn re-validates staff via SECDEF (60-07). |
| Browser DOM ← `last_error` text | Vendor-API error string rendered into Pill. Risk: stored XSS if a federated REST endpoint returns HTML in an error body and 60-07 stores it raw. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-09-01 | Tampering (CSRF) | `set_federated_source_enabled` RPC | mitigate | Supabase RPC uses Authorization Bearer (session JWT) — not cookie-auth — so classic CSRF (cross-origin form POST) does not apply. SECDEF re-checks `public.is_staff()` server-side per 60-01. Plan does NOT add a CSRF token (would be cargo-cult). |
| T-60-09-02 | Elevation of Privilege | Toggle handler / Pull-history handler | mitigate | All writes go through SECDEF RPC / Fn that re-validates `public.is_staff()`. UI gate (page-level no-rows empty state) is defense-in-depth only — never the sole guard. Tested via Task 3 "No access" empty-state path. |
| T-60-09-03 | DoS / Cost runaway | Pull-history button → 60-07 historical pull | mitigate | (1) Inline confirm `Dialog` with explicit cost warning copy gates accidental clicks. (2) `Pull full history` button is `disabled` when `enabled === false` — operator must enable + wait + observe before backfilling. (3) 60-07 Fn owns server-side rate-limit + cost-envelope check; this plan does not duplicate. (4) Optimistic UI does NOT auto-retry on failure — user must re-confirm. |
| T-60-09-04 | Tampering (XSS) | `last_error` Pill render | mitigate | React renders the Pill child via text node (no `dangerouslySetInnerHTML`); React auto-escapes. Truncation to 80 chars happens AFTER escaping (via JS substring on the string, not innerHTML). No HTML-injection vector. |
| T-60-09-05 | Information Disclosure | `list_federated_sources` RPC result | accept | Source enabled state, sync cadence, last-error message are all admin-only data (RLS); leakage requires staff RLS bypass which is out of scope. No PII fields. |
| T-60-09-06 | Repudiation | Toggle action | accept | `federated_sources.updated_at` is the audit trail (60-01 owns). UI does not need to write to a separate audit table; staff-only surface + SECDEF caller-id captured in `updated_at` is sufficient. PostHog `$ai_evaluation` event not applicable (no LLM call here). |
| T-60-09-07 | Spoofing | Page-level access | mitigate | Page is mounted under `/admin/rag/*` which is gated by the existing AdminShell auth wall (verify in execution by following `RagLayout` parent chain). Non-staff users see "No access" empty state due to RLS returning 0 rows. |
| T-60-09-SC | Tampering (supply chain) | npm installs | mitigate | This plan introduces ZERO new npm packages. All primitives (Card, Modal, Pill, Button, useToast, Intl.RelativeTimeFormat) already in deps. No package-legitimacy gate required. Verified via `files_modified` (no package.json edit). |
</threat_model>

<verification>
## Plan-level verification

After all 5 tasks pass, the operator can:

1. Run `cd leanshot && npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/ src/components/admin/rag/__tests__/FederatedSource*` → all green.
2. Run `cd leanshot && npm run build` → no new tsc/eslint errors attributable to this plan (pre-existing baseline failures per STATE.md remain identical — gate by net-new only).
3. Visual smoke (deferred to milestone UAT per [[feedback_milestone_uat_deferral_consolidation]] — federated_sources rows + Fn deployment land in 60-15; this plan ships UI-only against mocks).

## Cross-plan dependencies

- DEPENDS ON 60-01: `federated_sources` table + `list_federated_sources` / `set_federated_source_enabled` RPCs must exist for live render. Until 60-01 ships, this plan is verified via mocks only.
- DEPENDS ON 60-07: `rag-federated-{pubmed,openfda,dailymed}` Fns must accept `{ pull_mode: 'historical' }` POST body. Until 60-07 ships, historical-pull is verified via mocks only.
- LIVE end-to-end verify is OUT OF SCOPE for this plan — it lands in 60-15 close-out HUMAN gate.
</verification>

<success_criteria>
- [ ] All 5 tasks pass their `<automated>` gate.
- [ ] `FederatedSourcesPage.tsx` renders 3 rows in stable alphabetical order (dailymed, openfda, pubmed) with display_name (`PubMed (NLM E-utilities)`, `OpenFDA`, `DailyMed`) — copy matches UI-SPEC §2 verbatim.
- [ ] Toggle uses `role="switch"` + `aria-checked` + `aria-label="Enable {display_name} sync"` (UI-SPEC §2).
- [ ] Pull-history is gated behind a confirm Dialog using existing `Modal` primitive (role="dialog" + aria-modal inherited).
- [ ] Typography 4-size ceiling enforced — grep gate fails on any `text-base` or `text-md` in the 3 new component files (Task 3 verify).
- [ ] Colors are semantic tokens only — no hex literals in the 3 new component files.
- [ ] `npx tsc -p tsconfig.app.json --noEmit` passes (no new errors).
- [ ] `npx eslint` clean on all 5 modified files.
- [ ] Net-new vitest tests: 3 files, ≥12 test cases combined (4 federated-api + 5 FederatedSourceRow + 5 FederatedSourcesPage including a11y).
- [ ] Zero new npm packages added (verified by absence of `package.json` in files_modified).
- [ ] Plan is mounted in `RagLayout.SUB_ROUTES` at `federated` key — visiting `/admin/rag/federated` resolves to FederatedSourcesPage (route resolution by existing `resolveActive` regex; no new routing logic).
</success_criteria>

<output>
Create `leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-09-SUMMARY.md` when done.

The SUMMARY MUST include:
- `affects`: `[admin-rag-federated, admin-rag-shell]`
- `provides`: `[federated-toggle-ui, federated-api-wrapper]`
- `decisions`: `[no-toggle-primitive-built-inline-switch, no-react-router-extends-SUB_ROUTES, optimistic-toggle-with-rollback]`
- `patterns`: `[admin-rag-page-mount-via-SUB_ROUTES, vitest-mock-supabase-rpc, modal-confirm-for-destructive-action]`
- `deferred`: `[live-rpc-verify-to-60-15, end-to-end-federated-pull-to-60-15]`
- `requirements_satisfied`: `[RAG-06 (admin UI control surface)]`
- Carry-over note: live verify is contingent on 60-01 (RPC) + 60-07 (Fn) shipping; UI is mock-verified at this plan.
</output>

## PLAN COMPLETE 60-09-admin-federated-toggle-ui
