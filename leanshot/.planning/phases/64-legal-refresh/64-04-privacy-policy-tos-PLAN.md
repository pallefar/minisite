---
phase: 64-legal-refresh
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/legal/PrivacyPolicy.tsx
  - src/components/legal/TermsOfService.tsx
  - src/components/legal/SubprocessorList.tsx
  - src/components/legal/__tests__/SubprocessorList.test.tsx
  - src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx
autonomous: true
requirements:
  - LEGAL-01
  - LEGAL-04
  - LEGAL-08
user_setup: []

must_haves:
  truths:
    - "PrivacyPolicy renders 5 state-addendum sections with anchored ids #california, #virginia, #colorado, #connecticut, #utah"
    - "PrivacyPolicy shows 'Last updated YYYY-MM-DD' + 'What changed' callout banner at top"
    - "PrivacyPolicy renders <SubprocessorList /> which live-fetches from public.subprocessor_snapshots (Phase 25)"
    - "Table-of-contents nav at top of PrivacyPolicy links to all 5 state anchors (sticky on lg+)"
    - "TermsOfService renders a new UGC section per LEGAL-08 with content license + community-rules cross-link + DMCA takedown cross-reference"
    - "All sizing is text-[11px]/text-[13px]/text-[18px]/text-heading and weights 400/600 per UI-SPEC §Typography"
    - "All colors use defined @theme tokens (NO undefined Tailwind v4 tokens per [[feedback_ui_auditor_catches_undefined_theme_tokens]])"
  artifacts:
    - path: "src/components/legal/PrivacyPolicy.tsx"
      provides: "Extended policy page with 5 state addendums + TOC + What Changed banner + SubprocessorList"
      contains: "id=\"california\""
    - path: "src/components/legal/TermsOfService.tsx"
      provides: "ToS extended with community UGC content license + DMCA cross-ref"
      contains: "User-Generated Content"
    - path: "src/components/legal/SubprocessorList.tsx"
      provides: "Live-fetched subprocessor list from public.subprocessor_snapshots"
      exports: ["SubprocessorList"]
  key_links:
    - from: "src/components/legal/SubprocessorList.tsx"
      to: "public.subprocessor_snapshots (Phase 25)"
      via: ".from('subprocessor_snapshots').select(…).order('captured_at', { ascending:false }).limit(1)"
      pattern: "subprocessor_snapshots"
    - from: "src/components/legal/PrivacyPolicy.tsx"
      to: "src/components/legal/SubprocessorList.tsx"
      via: "import + <SubprocessorList /> render"
      pattern: "import.*SubprocessorList"
---

<objective>
Extend the existing `PrivacyPolicy.tsx` (Phase 22) with five state-privacy addendum sections (CA/VA/CO/CT/UT per D-State-Privacy-Addendums + LEGAL-01) + a live-fetched `<SubprocessorList />` component (LEGAL-04 cross-driven from Phase 25 `subprocessor_snapshots` cron output). Also extend `TermsOfService.tsx` with the community-UGC content-license + DMCA cross-reference section per LEGAL-08.

Purpose: LEGAL-01 + LEGAL-04 + LEGAL-08 — three of the v1.4 launch BLOCKER items. Legal counsel reviews at Phase 70 UAT; this plan delivers the structure + first-draft authored copy that counsel will revise.

Output: PrivacyPolicy.tsx extended with 5 anchored state sections, TOC nav, "What changed" banner. New SubprocessorList component reading from `subprocessor_snapshots`. TermsOfService.tsx extended with UGC section. Two new test files. Verifies state-addendum anchors render + SubprocessorList loads/empties correctly.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/phases/64-legal-refresh/64-UI-SPEC.md

<!-- Reuse targets (named explicitly per [[feedback_planner_prompt_explicit_reuse_targets]]) -->
@src/components/legal/PrivacyPolicy.tsx
@src/components/legal/TermsOfService.tsx
@src/components/legal/LegalLayout.tsx
@src/components/admin/compliance/SubprocessorDiffFeed.tsx
@src/lib/supabase.ts

<interfaces>
<!-- SubprocessorDiffFeed.tsx (admin/compliance, Phase 25) is the canonical reader for public.subprocessor_snapshots -->
<!-- Schema (extracted): subprocessor_snapshots(captured_at timestamptz, vendors jsonb /* [{name,purpose,baa_status,...}] */, …) -->
<!-- The marketing SubprocessorList reads same source but with a public-facing column subset -->

<!-- Existing PrivacyPolicy.tsx (Phase 22) — extracted exports + structure -->
export function PrivacyPolicy(): ReactNode  // uses LegalLayout
// Currently has sections: "How we collect/use", "Storage + retention", "Your rights"
// We extend by appending 5 state sections + TOC + What Changed banner; preserve existing sections verbatim

<!-- Tailwind v4 @theme tokens (verified against src/index.css per [[feedback_ui_auditor_catches_undefined_theme_tokens]]):
  --color-bg, --color-surface, --color-surface-elevated, --color-primary, --color-danger,
  --color-text, --color-text-secondary, --color-text-tertiary,
  --color-warning-soft, --color-rose-soft, --color-border, --color-success
  -- Use bracket syntax: bg-[var(--color-warning-soft)] (NOT bg-warning-soft) since the Phase 60 lesson shows the latter is undefined in some setups.
-->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build SubprocessorList component + test</name>
  <files>
    src/components/legal/SubprocessorList.tsx,
    src/components/legal/__tests__/SubprocessorList.test.tsx
  </files>
  <behavior>
    - Test 1: Render → fetches latest subprocessor_snapshots row → renders a table with columns Vendor / Purpose / BAA Status / Region
    - Test 2: Empty snapshot (no rows) → renders empty state "Subprocessor list updating — check back shortly" (NEVER hard-coded fallback that masks data outage; matches Phase 22 D-Subprocessor-List-Source no-static-duplication rule)
    - Test 3: Fetch error → renders error fallback "Unable to load subprocessor list. Email privacy@leanshot.app for the latest list." (Phase 60 lesson: errors must include solution path)
    - Test 4: Loading state → renders Skeleton placeholder
  </behavior>
  <action>
    Mirror data-fetch pattern from `src/components/admin/compliance/SubprocessorDiffFeed.tsx` BUT scoped to public-facing column subset (no internal BAA-renewal-date column, no NDA timestamps — public surface only).

    Component shape:
    `export function SubprocessorList(): ReactNode`
    `useEffect` on mount: `supabase.from('subprocessor_snapshots').select('captured_at, vendors').order('captured_at', { ascending:false }).limit(1).maybeSingle()`.
    Render the latest snapshot's `vendors` array as a `&lt;table&gt;` with cols Vendor / Purpose / BAA Status / Region (or N/A) — each row from vendors[i].

    Styling per UI-SPEC §1: 13px body, 11px meta, font-semibold for table headers (600), font-normal for body (400). Use `bg-[var(--color-surface-elevated)]` for header row, `border-[var(--color-border)]` for cell dividers, `text-[var(--color-text)]` for body. NO undefined tokens like `bg-warning-subtle` or `text-text-primary` (Phase 60 BLOCKER lesson).

    Footer caption (11px tertiary): "Captured: {captured_at formatted YYYY-MM-DD} · Live from subprocessor_diff snapshot pipeline (Phase 25)". This makes Plan 64-04 audit-traceable at render time.

    Empty / Error / Loading states per behavior block. All error copy includes `privacy@leanshot.app` per Phase 60 specificity rule.

    Test file uses `@testing-library/react` + `vitest`; mocks `@/lib/supabase`'s `supabase` export via vi.mock. The vitest project include MUST scope to this file only per [[feedback_vitest_project_include_too_broad]] — DO NOT modify the project-wide vitest config.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      test -f src/components/legal/SubprocessorList.tsx &amp;&amp;
      test -f src/components/legal/__tests__/SubprocessorList.test.tsx &amp;&amp;
      grep -q "export function SubprocessorList" src/components/legal/SubprocessorList.tsx &amp;&amp;
      grep -q "subprocessor_snapshots" src/components/legal/SubprocessorList.tsx &amp;&amp;
      grep -q "privacy@leanshot.app" src/components/legal/SubprocessorList.tsx &amp;&amp;
      ! grep -E "(text-text-primary|bg-surface-card|border-border-subtle|bg-warning-subtle)" src/components/legal/SubprocessorList.tsx &amp;&amp;
      npx vitest run src/components/legal/__tests__/SubprocessorList.test.tsx --reporter=basic --run --config vite.config.ts
    </automated>
  </verify>
  <done>
    SubprocessorList loads + renders rows from latest subprocessor_snapshots; empty/error/loading states present; uses only @theme-defined tokens (verified by grep gate against the Phase 60 undefined-token list).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend PrivacyPolicy with 5 state addendums + TOC + What Changed banner + SubprocessorList</name>
  <files>
    src/components/legal/PrivacyPolicy.tsx,
    src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx
  </files>
  <behavior>
    - Test 1: Rendered page contains `id="california"`, `id="virginia"`, `id="colorado"`, `id="connecticut"`, `id="utah"` (anchor link targets)
    - Test 2: Rendered page contains a `&lt;nav&gt;` (or list) with 5 anchor `&lt;a href="#california"&gt; …` style links
    - Test 3: Page contains a banner with text matching `/Last updated/i` AND `/What changed/i` AND the version date in YYYY-MM-DD format
    - Test 4: Page contains `&lt;SubprocessorList /&gt;` (verified by mocking SubprocessorList and asserting it was called)
    - Test 5: California section text mentions CCPA + "right to delete" + "right to opt out of sale" + "right to limit sensitive personal information use"
    - Test 6: Virginia section text mentions CDPA + "right to portability"
    - Test 7: Utah section text mentions UCPA + acknowledges NO portability right (per D-DSAR-Portal-Extensions UT-specific list)
  </behavior>
  <action>
    Edit `src/components/legal/PrivacyPolicy.tsx`. Preserve all existing sections verbatim. Append AFTER existing content + BEFORE the LegalFooter:

    1. **Sticky banner at top** (insert as first child inside LegalLayout's children slot):
       - Background `bg-[var(--color-warning-soft)]` (a defined token)
       - Padding 16px, rounded
       - Text content: `<strong>Last updated:</strong> 2026-05-27` (use the planned ship date — close-out can update this constant if shipping later) + ` · ` + `<strong>What changed:</strong>` + a 2-line summary: "Added state-specific privacy disclosures for California, Virginia, Colorado, Connecticut, and Utah residents. Updated subprocessor list to include OpenRouter, Cohere, Mux, Stripe Connect, Sentry, and the pgvector recommender. New Do Not Sell or Share opt-out page."
       - Closing CTA link `&lt;a href="#what-changed"&gt;See full change log →&lt;/a&gt;` (anchors to a new section at the bottom of the policy)

    2. **Table of contents** (right below the banner, sticky on lg+ via `lg:sticky lg:top-4`):
       - Heading 13/600 "Jump to:"
       - Unordered list of links: Privacy overview, Information we collect, How we use your info, Subprocessors, **California (CCPA/CPRA)**, **Virginia (CDPA)**, **Colorado (CPA)**, **Connecticut (CTDPA)**, **Utah (UCPA)**, What changed, Contact us
       - Each link 11/400 with hover underline

    3. **Subprocessor section** (replace any existing static vendor list — if present — with):
       - `&lt;section id="subprocessors"&gt;&lt;h2 className="text-[18px] font-semibold mb-4"&gt;Subprocessors&lt;/h2&gt; &lt;SubprocessorList /&gt; &lt;/section&gt;`
       - Import `SubprocessorList` from `./SubprocessorList` (built in Task 1)

    4. **Five state-addendum sections** appended in order, each with this template:
       - `&lt;section id="california" className="mt-12 pt-8 border-t border-[var(--color-border)]"&gt; &lt;h2 className="text-[18px] font-semibold mb-4"&gt;California (CCPA / CPRA)&lt;/h2&gt; …`
       - Each section: 3 subsections — "Your rights", "How to exercise these rights", "State-specific contact procedure"
       - **Your rights** content must cite the statute (CCPA/CPRA, CDPA, CPA, CTDPA, UCPA) by name and enumerate the rights granted to that state's residents. For California include: right to know, right to delete, right to correct, right to opt out of sale/sharing, right to limit sensitive personal information use, right to non-discrimination. For Virginia: right to access, delete, correct, portability, opt-out of targeted advertising/sale/profiling. For Colorado: same as Virginia + universal opt-out signals (GPC). For Connecticut: same as Colorado. For Utah: access + deletion only (NO portability/correction — narrower per UCPA).
       - **How to exercise** content directs to `/account/data-rights` (DSAR portal, extended by Plan 64-06) and `/privacy/do-not-sell` (Plan 64-05 Do-Not-Sell form). Mentions 45-day response timeline (statutory).
       - **State-specific contact**: `privacy@leanshot.app` with subject prefix `[CA Privacy]` / `[VA Privacy]` / etc.
       - **Authoritative tone but clearly draft**: include inline italic disclaimer at the top of the state-addendum section block: `&lt;em&gt;This addendum is in draft pending legal counsel review (Phase 70 UAT).&lt;/em&gt;` — this is Claude's discretion per D-Legal-Copy-Source "external legal review at staging".

    5. **"What changed" section** anchored as `id="what-changed"`: chronological change log starting with 2026-05-27 entry summarizing the Phase 64 changes (state addendums added, subprocessor list refreshed, Do-Not-Sell page launched).

    All typography uses ONLY: `text-[11px]`, `text-[13px]`, `text-[18px]`, `text-heading` (28px H1 — preserve existing); font weights ONLY `font-normal`, `font-semibold` per UI-SPEC §Typography ceiling. Verified by grep gate.

    All colors via `var(--color-*)` defined in `src/index.css` per [[feedback_ui_auditor_catches_undefined_theme_tokens]]. Use bracket syntax `bg-[var(--color-warning-soft)]` etc.

    Test file mocks `./SubprocessorList` to a stub `vi.fn(() =&gt; null)`; asserts the 7 behavior tests via `screen.getByRole`, `screen.getByText` matchers.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q 'id="california"' src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q 'id="virginia"' src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q 'id="colorado"' src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q 'id="connecticut"' src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q 'id="utah"' src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q 'id="what-changed"' src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q "SubprocessorList" src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q "Last updated" src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      grep -q "What changed" src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      ! grep -vE '^\s*//|^\s*\*' src/components/legal/PrivacyPolicy.tsx | grep -E "text-\[(?!11|13|18)" &amp;&amp;
      ! grep -E "text-text-primary|bg-surface-card|border-border-subtle|bg-warning-subtle|text-accent" src/components/legal/PrivacyPolicy.tsx &amp;&amp;
      npx vitest run src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx --reporter=basic --run --config vite.config.ts
    </automated>
  </verify>
  <done>
    PrivacyPolicy renders banner + TOC + Subprocessors section (with live SubprocessorList) + 5 state addendums + What Changed log. All anchors present. Vitest passes.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extend TermsOfService with community-UGC content-license + DMCA cross-reference</name>
  <files>src/components/legal/TermsOfService.tsx</files>
  <action>
    Edit `src/components/legal/TermsOfService.tsx`. Preserve existing sections. Append a new section `&lt;section id="community-ugc"&gt;&lt;h2 className="text-[18px] font-semibold mb-4"&gt;Community Content &amp; User-Generated Content&lt;/h2&gt;…&lt;/section&gt;` covering LEGAL-08 requirements:

    - **Content license clause**: User retains ownership; user grants LeanShot a non-exclusive, worldwide, royalty-free, sublicensable license to host/display/distribute the content for the purpose of operating the Community Spaces feature (Phase 44-49 surfaces). License terminates on user account deletion / content removal.
    - **Community Rules cross-link**: link to `#/legal/terms#community-rules` (anchored sub-section listed below) covering acceptable use, hate-speech / harassment ban, no medical advice from users-to-users, no PHI sharing of identifiable third parties, no spam/promotion.
    - **Community Rules sub-section** (`id="community-rules"` anchored): bullet list of 8 rules (no medical advice, no PHI, no harassment, no spam, no impersonation, no off-topic, no illegal activity, no copyrighted material without permission). Each rule one short line.
    - **Takedown procedure cross-reference**: link to `#/legal/dmca` (DMCA page from Plan 64-05) — "For copyright takedown notices, see our DMCA page."
    - **Reservation of moderation rights**: LeanShot reserves the right to remove content + suspend accounts violating these terms.

    All typography 11/13/18 + font weights 400/600 ONLY. All colors via `var(--color-*)`. Add inline draft disclaimer at section top: `&lt;em&gt;This UGC section is in draft pending legal counsel review (Phase 70 UAT).&lt;/em&gt;`

    Update the page-level "Last updated" date string (search for existing `Last updated` literal in TermsOfService.tsx — if absent, add one at the top mirroring PrivacyPolicy.tsx banner pattern).
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q 'id="community-ugc"' src/components/legal/TermsOfService.tsx &amp;&amp;
      grep -q 'id="community-rules"' src/components/legal/TermsOfService.tsx &amp;&amp;
      grep -q "/legal/dmca\|#/legal/dmca" src/components/legal/TermsOfService.tsx &amp;&amp;
      grep -q "User-Generated Content\|user-generated content" src/components/legal/TermsOfService.tsx &amp;&amp;
      ! grep -E "text-text-primary|bg-surface-card|border-border-subtle|bg-warning-subtle|text-accent" src/components/legal/TermsOfService.tsx &amp;&amp;
      npx tsc -p tsconfig.app.json --noEmit
    </automated>
  </verify>
  <done>
    TermsOfService renders new UGC section + Community Rules + DMCA cross-reference. tsc clean. No undefined Tailwind tokens.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → supabase.from('subprocessor_snapshots') anon read | RLS must allow anon SELECT on this table (verified — Phase 25 made it publicly readable per HIPAA-12 disclosure requirement) |
| browser → PrivacyPolicy / TermsOfService render | static React render, no untrusted input |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-04-01 | Information Disclosure | subprocessor_snapshots leaks internal BAA renewal date | mitigate | SubprocessorList SELECTs only `captured_at, vendors` and renders public-facing subset (vendor name, purpose, BAA status — NOT renewal date, NDA stamps) |
| T-64-04-02 | Tampering | XSS via vendors jsonb content | mitigate | React auto-escapes JSX text; vendor data is staff-authored from compliance dashboard — no untrusted writers |
| T-64-04-03 | Information Disclosure | undefined Tailwind v4 token renders state-addendum block INVISIBLE shipping LEGAL violation to prod | mitigate | grep gate against the Phase 60 BLOCKER list (text-text-primary, bg-surface-card, border-border-subtle, bg-warning-subtle, text-accent) in verify automated; also enforce only `var(--color-*)` syntax for colors |
| T-64-04-04 | Tampering | regulator / counsel reads draft copy as final, ships compliance violation | mitigate | Inline `&lt;em&gt;This addendum is in draft pending legal counsel review (Phase 70 UAT).&lt;/em&gt;` disclaimer per state section + ToS UGC section; Phase 70 UAT step explicitly gates counsel-approval before production flag |
| T-64-04-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed in this plan |
</threat_model>

<verification>
- vitest passes for SubprocessorList + PrivacyPolicy.state-addendums tests
- tsc passes for TermsOfService
- All 5 state anchor ids present in PrivacyPolicy
- No undefined Tailwind v4 tokens (grep gate matches Phase 60 BLOCKER list)
- Typography stays within 11/13/18/heading + 400/600 ceiling
</verification>

<success_criteria>
- PrivacyPolicy.tsx renders 5 state addendums + TOC + What Changed banner + live SubprocessorList
- TermsOfService.tsx renders new UGC content-license + Community Rules + DMCA cross-reference
- SubprocessorList reads live from `public.subprocessor_snapshots` (Phase 25 source of truth)
- All copy includes draft disclaimer pending Phase 70 counsel review
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-04-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
