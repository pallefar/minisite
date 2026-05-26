---
phase: 64-legal-refresh
plan: 06
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/dsar/DsarPortalPage.tsx
  - src/lib/dsar/state-request-types.ts
  - src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx
  - src/lib/dsar/__tests__/state-request-types.test.ts
autonomous: true
requirements:
  - LEGAL-03
user_setup: []

must_haves:
  truths:
    - "DSAR portal at /settings/privacy/dsar renders a state-residency Select with options CA/VA/CO/CT/UT/OTHER"
    - "Selecting CA shows checkboxes: deletion, access, portability, opt_out, limit_sensitive_use (5 options)"
    - "Selecting VA shows: deletion, access, portability, correction, opt_out (5)"
    - "Selecting CO or CT shows: deletion, access, portability, correction, opt_out, opt_in_sensitive (6)"
    - "Selecting UT shows: deletion, access (2 only — UT-UCPA narrower per D-DSAR-Portal-Extensions)"
    - "Selecting OTHER shows: deletion, access (default base set)"
    - "Submitting the form inserts one row into public.data_rights_requests with the selected state_residency + request_type + auth.uid() user_id"
    - "Cancel CTA copy is 'Keep my data rights pending' (NOT generic 'Cancel' per UI-SPEC §Copywriting + Phase 61 lesson)"
  artifacts:
    - path: "src/lib/dsar/state-request-types.ts"
      provides: "Pure lookup mapping state code → allowed request_type[] for the state-residency dropdown"
      exports: ["STATE_REQUEST_TYPES", "getRequestTypesForState", "type StateCode"]
    - path: "src/components/dsar/DsarPortalPage.tsx"
      provides: "Extended DSAR page with state-residency Select + conditional checkboxes + Insert to data_rights_requests"
      contains: "state_residency"
  key_links:
    - from: "src/components/dsar/DsarPortalPage.tsx"
      to: "src/lib/dsar/state-request-types.ts (lookup table)"
      via: "import { getRequestTypesForState } + render conditional checkboxes"
      pattern: "getRequestTypesForState"
    - from: "src/components/dsar/DsarPortalPage.tsx"
      to: "public.data_rights_requests INSERT"
      via: "supabase.from('data_rights_requests').insert({ user_id, state_residency, request_type[], details })"
      pattern: "data_rights_requests"
---

<objective>
Extend the existing DSAR portal at `src/components/dsar/DsarPortalPage.tsx` (Phase 22) with a state-residency dropdown + conditional state-specific request-type checkboxes per D-DSAR-Portal-Extensions + LEGAL-03. Form submission writes to the new `public.data_rights_requests` table (Plan 64-01 creates the table).

Purpose: LEGAL-03 — extend the GDPR DSAR portal to handle state-rights flavors per CCPA/CDPA/CPA/CTDPA/UCPA. Existing portal handles deletion via `initiate_account_deletion_rpc`; this plan adds the multi-state request-type variant log.

Output: New pure-function lookup module `lib/dsar/state-request-types.ts` + edits to `DsarPortalPage.tsx` adding the Select + conditional checkboxes + data_rights_requests insert + two test files.

NOTE on existing DSAR flow: The current DsarPortalPage.tsx writes to `pending_account_deletions` via `initiate_account_deletion_rpc` (Phase 22 + Phase 35). This plan ADDS a new request-type lane that writes to `data_rights_requests` instead. The two flows COEXIST: "deletion" via the existing RPC AND "access / portability / correction / opt_out / limit_sensitive_use / opt_in_sensitive" via the new table. The deletion checkbox routes to BOTH (legacy RPC + new log row) so operators can see the unified state-flavor request audit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/phases/64-legal-refresh/64-UI-SPEC.md

<!-- Reuse targets named explicitly -->
@src/components/dsar/DsarPortalPage.tsx
@src/components/dsar/DsarStatusCard.tsx
@src/lib/supabase.ts

<interfaces>
<!-- data_rights_requests table from Plan 64-01 -->
public.data_rights_requests(
  id uuid PK,
  user_id uuid not null FK auth.users(id),
  state_residency text check (state_residency in ('CA','VA','CO','CT','UT','OTHER')),
  request_type text check (request_type in ('deletion','access','portability','correction','opt_out','limit_sensitive_use','opt_in_sensitive')),
  details text,
  status text default 'pending',
  submitted_at timestamptz default now(),
  ...
);

<!-- INSERT policy (Plan 64-01): user_id = auth.uid() — authenticated users only -->
<!-- For multi-checkbox selection: insert one row per checked request_type (simplifies status tracking per checkbox vs jsonb array) -->

<!-- Existing DsarPortalPage exports (Phase 22) -->
import { useStore, supabase, useToast } from '...'; // existing
export function DsarPortalPage(): ReactNode;
// Form currently: name email reason → call initiate_account_deletion_rpc → DsarStatusCard

<!-- Tailwind v4 @theme tokens — same constraints as 64-04/05 -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build state-request-types lookup module + test</name>
  <files>
    src/lib/dsar/state-request-types.ts,
    src/lib/dsar/__tests__/state-request-types.test.ts
  </files>
  <behavior>
    - Test 1: getRequestTypesForState('CA') returns exactly ['deletion','access','portability','opt_out','limit_sensitive_use']
    - Test 2: getRequestTypesForState('VA') returns ['deletion','access','portability','correction','opt_out']
    - Test 3: getRequestTypesForState('CO') returns ['deletion','access','portability','correction','opt_out','opt_in_sensitive']
    - Test 4: getRequestTypesForState('CT') returns same as CO
    - Test 5: getRequestTypesForState('UT') returns ['deletion','access'] (narrower per D-DSAR-Portal-Extensions UT-UCPA)
    - Test 6: getRequestTypesForState('OTHER') returns ['deletion','access']
    - Test 7: getRequestTypesForState('XX') throws "Unknown state" (defensive)
    - Test 8: The exported STATE_REQUEST_TYPES const is shaped { CA: [...], VA: [...], CO: [...], CT: [...], UT: [...], OTHER: [...] } and is `as const` (TS readonly)
  </behavior>
  <action>
    Create pure-function module `src/lib/dsar/state-request-types.ts`:

    ```text (PROSE — write as TS, do not copy text into a fenced block in action)
    StateCode union: 'CA' | 'VA' | 'CO' | 'CT' | 'UT' | 'OTHER'
    RequestType union: 'deletion' | 'access' | 'portability' | 'correction' | 'opt_out' | 'limit_sensitive_use' | 'opt_in_sensitive'

    export const STATE_REQUEST_TYPES: { readonly [K in StateCode]: readonly RequestType[] } per D-DSAR-Portal-Extensions:
      CA → deletion / access / portability / opt_out / limit_sensitive_use
      VA → deletion / access / portability / correction / opt_out
      CO → deletion / access / portability / correction / opt_out / opt_in_sensitive
      CT → same as CO
      UT → deletion / access ONLY (no portability or correction — UCPA narrower)
      OTHER → deletion / access (default base set)

    export function getRequestTypesForState(state: StateCode): readonly RequestType[] — throws if unknown state
    ```

    Test file uses `vitest` + `describe`/`it`/`expect`. Pure function, no mocks needed. Verify the exact arrays per behavior block.

    Per [[feedback_planner_silent_scope_reduction_patterns]]: do NOT omit `opt_in_sensitive` for CO/CT or `limit_sensitive_use` for CA — these are explicit in D-DSAR-Portal-Extensions and the data_rights_requests CHECK constraint accepts them.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      test -f src/lib/dsar/state-request-types.ts &amp;&amp;
      test -f src/lib/dsar/__tests__/state-request-types.test.ts &amp;&amp;
      grep -q "export function getRequestTypesForState" src/lib/dsar/state-request-types.ts &amp;&amp;
      grep -q "limit_sensitive_use" src/lib/dsar/state-request-types.ts &amp;&amp;
      grep -q "opt_in_sensitive" src/lib/dsar/state-request-types.ts &amp;&amp;
      npx vitest run src/lib/dsar/__tests__/state-request-types.test.ts --reporter=basic --run --config vite.config.ts &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    Lookup module ships 5 state arrays + OTHER fallback; 8 tests pass; types are `as const`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend DsarPortalPage with state-residency Select + conditional checkboxes + data_rights_requests insert</name>
  <files>
    src/components/dsar/DsarPortalPage.tsx,
    src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx
  </files>
  <behavior>
    - Test 1: Rendered page contains a state-residency Select with 6 options (CA/VA/CO/CT/UT/OTHER)
    - Test 2: Initially no state selected → no request-type checkboxes visible
    - Test 3: Select CA → 5 request-type checkboxes visible with labels matching `getRequestTypesForState('CA')` mapped to human-readable strings
    - Test 4: Select UT → only 2 checkboxes visible (deletion, access) — verifies narrower set
    - Test 5: Submit with state=VA + checked ['deletion','access'] → mocks `supabase.from('data_rights_requests').insert(...)` and asserts 2 rows inserted (one per request_type) with state_residency='VA' and user_id=mocked auth.uid()
    - Test 6: Cancel CTA copy is exactly "Keep my data rights pending"
    - Test 7: Submitting deletion ALSO triggers `initiate_account_deletion_rpc` (legacy flow preservation per CONTEXT)
    - Test 8: Successful insert renders DsarStatusCard with `request_id` from latest data_rights_requests row OR existing pending_account_deletions row (whichever the deletion path returned)
  </behavior>
  <action>
    Edit `src/components/dsar/DsarPortalPage.tsx` preserving existing behavior:

    1. Import `getRequestTypesForState` + `STATE_REQUEST_TYPES` + types from `@/lib/dsar/state-request-types`.
    2. Add new state hooks: `const [stateResidency, setStateResidency] = useState&lt;StateCode | ''&gt;('');` and `const [selectedRequestTypes, setSelectedRequestTypes] = useState&lt;RequestType[]&gt;([]);`
    3. Render Select at top of form (BEFORE existing name/email/reason fields):
       - Use `&lt;Select&gt;` primitive if present in `src/components/ui/`, else use native `&lt;select&gt;` with bracket-syntax @theme color tokens
       - Label "Which state do you reside in?"
       - Help text 11/400 tertiary: "Different state laws grant different data rights. We tailor your request options based on residency."
       - 6 `&lt;option&gt;` entries (CA, VA, CO, CT, UT, OTHER) with state-name labels
    4. Render request-type checkboxes conditionally — `{stateResidency &amp;&amp; getRequestTypesForState(stateResidency).map(rt =&gt; ...)}` — using Checkbox primitive or native `&lt;input type="checkbox"&gt;` with state-managed checked state
       - Labels human-readable (deletion → "Delete my data", access → "Access my data", portability → "Export my data in portable format", correction → "Correct inaccurate data about me", opt_out → "Opt out of sale, sharing, or targeted advertising", limit_sensitive_use → "Limit use of my sensitive personal information", opt_in_sensitive → "Opt in to sensitive data processing")
    5. Preserve existing details/reason textarea
    6. Cancel CTA copy exactly: "Keep my data rights pending" (NOT generic "Cancel" per [[feedback_planner_silent_scope_reduction_patterns]] + UI-SPEC §Copywriting)
    7. Submit CTA: keep existing primary copy OR rename to "Submit data rights request" (verb+noun per UI-SPEC). Submit handler:
       - Validate state_residency selected + at least one request_type checked
       - For each selected request_type, INSERT row into `data_rights_requests` (one row per type — simplifies status tracking; per CONTEXT extension of enum)
       - If 'deletion' is among selected types, ALSO call existing `initiate_account_deletion_rpc` (legacy flow per CONTEXT)
       - Toast success / error via existing `useToast` hook
    8. Apply UI-SPEC §1 tokens: `bg-[var(--color-surface)]`, `text-[var(--color-text)]`, `border-[var(--color-border)]` — NO undefined Tailwind v4 tokens
    9. Typography ceiling 11/13/18/text-heading + weights 400/600

    Test file mocks `supabase.from` + `supabase.rpc` + `useStore` for `user.id`. Wraps in HelmetProvider + sensible test-store provider matching existing DSAR test setup if present (check `src/components/dsar/__tests__/` for analog).
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q "getRequestTypesForState\|STATE_REQUEST_TYPES" src/components/dsar/DsarPortalPage.tsx &amp;&amp;
      grep -q "data_rights_requests" src/components/dsar/DsarPortalPage.tsx &amp;&amp;
      grep -q "state_residency\|stateResidency" src/components/dsar/DsarPortalPage.tsx &amp;&amp;
      grep -q "Keep my data rights pending" src/components/dsar/DsarPortalPage.tsx &amp;&amp;
      grep -q "initiate_account_deletion_rpc" src/components/dsar/DsarPortalPage.tsx &amp;&amp;
      ! grep -E "text-text-primary|bg-surface-card|border-border-subtle|bg-warning-subtle|text-accent" src/components/dsar/DsarPortalPage.tsx &amp;&amp;
      npx vitest run src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx --reporter=basic --run --config vite.config.ts &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    DsarPortalPage renders state-residency Select + conditional checkboxes + writes to data_rights_requests + preserves legacy deletion RPC path + Cancel copy "Keep my data rights pending"; vitest + tsc clean; no undefined Tailwind tokens.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| authenticated user → /settings/privacy/dsar form submit → data_rights_requests INSERT | RLS policy enforces user_id = auth.uid() |
| authenticated user → initiate_account_deletion_rpc | existing Phase 22 RPC; trust boundary preserved |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-06-01 | Tampering | client submits state=VA but uses request_type='opt_in_sensitive' (not allowed for VA) | mitigate | Plan 64-01 data_rights_requests CHECK constraint accepts ANY value in the union — server does not enforce state-specific subsetting. Mitigation: client-side gate is UX-only; staff operators reviewing requests at Phase 70 can reject misaligned types. Accept residual: a user "asking" for an inapplicable right is harmless — operator simply replies "not applicable to your state". |
| T-64-06-02 | Information Disclosure | other users read this user's DSAR requests | mitigate | Plan 64-01 RLS SELECT policy restricts to `user_id = auth.uid() OR is_staff()` |
| T-64-06-03 | Repudiation | user denies submission | mitigate | data_rights_requests records submitted_at; staff-only UPDATE for status changes |
| T-64-06-04 | Information Disclosure | undefined Tailwind v4 token renders DSAR form INVISIBLE → silent CCPA non-compliance | mitigate | grep gate against Phase 60 BLOCKER list (text-text-primary, bg-surface-card, etc.) in verify |
| T-64-06-SC | Tampering | npm/pip/cargo installs | accept | No new packages |
</threat_model>

<verification>
- vitest passes for state-request-types lookup test (8 cases) + DsarPortalPage state-residency test (8 cases)
- tsc passes
- Legacy `initiate_account_deletion_rpc` still triggered when 'deletion' selected (preserves Phase 22 + Phase 35 flow)
- Cancel copy is "Keep my data rights pending" (per Phase 61 lesson)
- No undefined Tailwind v4 tokens
</verification>

<success_criteria>
- DSAR portal renders state-residency Select with 6 options
- Conditional request-type checkboxes per state match D-DSAR-Portal-Extensions exactly (incl. UT narrower set, CO/CT widest set including opt_in_sensitive)
- Submission inserts one row per request_type into data_rights_requests with state_residency tagged
- Legacy deletion RPC preserved
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-06-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
