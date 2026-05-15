---
phase: 15-page-builder-landing-pages
plan: 06
subsystem: page-builder
tags: [page-builder, embeds, calendly, youtube, tally, iframe, xss, sandbox, tdd]

requires:
  - phase: 15-page-builder-landing-pages
    plan: 03
    provides: BlockType union (`calendly|youtube|tally` literals), BlockNode contract, render.ts switch + escapeHtml/safeHref/blockWrapperStyle/hideOnMobileClass helpers — consumed (mirrored, not imported) by the 3 new renderEmbed* wrappers
  - phase: 15-page-builder-landing-pages
    plan: 04
    provides: PropertyPanel.tsx shell + GenericContentFields renderer + token-bounded style fields — the 3 new `kind: 'number'|'boolean'` arms slot into this existing switch without restructuring
  - phase: 15-page-builder-landing-pages
    plan: 05
    provides: PROPERTY_CONFIGS flat registry (Partial<Record<BlockType, BlockPropertyConfig>>) + FieldKind union — additive merge for the 3 new keys (calendly/youtube/tally); render.ts case-block grouping seam below the 5 core branches; render.test.ts "unimplemented type" assertion pattern (now swapped calendly → lead-form to preserve the fall-through contract)

provides:
  - "leanshot/src/lib/page-builder/embed-src.ts — PURE module exporting buildCalendlySrc / buildYouTubeSrc / buildTallySrc + buildCalendlyIframeHtml / buildYouTubeIframeHtml / buildTallyIframeHtml + EMBED_IFRAME_TITLES. No DOM, no Deno globals, no React, no side effects — importable by both editor and Deno renderer. All 6 builders return null/'' on invalid input (allow-list, never escape-and-pass)."
  - "leanshot/src/components/admin/pages/blocks/{Calendly,YouTube,Tally}Block.tsx — 3 editor preview components, each rendering a sandboxed/title'd <iframe> via the matching buildXSrc OR a safe non-iframe fallback when input is invalid. DS Skeleton overlay until iframe `onLoad`; respects useReducedMotion."
  - "leanshot/src/components/admin/pages/editor/property-configs.ts — PROPERTY_CONFIGS extended with 3 new keys (calendly / youtube / tally); FieldKind union extended with 'number' + 'boolean' (token-bounded; still no color/hex/typography)."
  - "leanshot/src/components/admin/pages/editor/PropertyPanel.tsx — GenericContentFields switch extended with 2 new arms ('number' Input + 'boolean' checkbox)."
  - "supabase/functions/page-render/render.ts — 3 new renderBlock branches (`youtube`, `calendly`, `tally`), each a thin wrapper calling its `buildXIframeHtml` helper from embed-src.ts. NO <iframe ...> template literal in render.ts (BLOCKER 2 iframe-HTML factoring satisfied)."

affects: [15-07, 15-08]

tech-stack:
  added: []
  patterns:
    - "Allow-list + URL-ctor + exact hostname equality (NOT endsWith/includes) for 3rd-party embed validation — defeats look-alike host attacks (calendly.com.evil.com, evil.com/calendly.com)"
    - "Pure validate-and-build seam: ALL iframe `src` strings and the full iframe-HTML strings used by both the editor preview AND the public Deno renderer come from ONE file. Editor and rendered page resolve to byte-identical src per provider."
    - "Sandbox-set + referrerpolicy minimum-necessary posture per provider — YouTube: `allow-scripts allow-same-origin allow-presentation` + `allow=encrypted-media; picture-in-picture`; Calendly: `allow-scripts allow-same-origin allow-popups allow-forms` + `allow=clipboard-write; payment`; Tally: `allow-scripts allow-same-origin allow-forms`. Every iframe carries `referrerpolicy=\"no-referrer\"`, `loading=\"lazy\"`, and a non-empty title."
    - "Skeleton-overlay + opacity-transition iframe-load pattern (reuses Phase 6 `skeleton-shimmer` reduced-motion class; opacity transition gated by `useReducedMotion()`)"
    - "Relative Deno import from supabase/functions/page-render/render.ts → ../../../leanshot/src/lib/page-builder/embed-src.ts. Works because embed-src.ts is dependency-free TypeScript (no React, no DOM, no `Deno.*`); the cross-runtime seam pattern from 15-03's BlockType mirror is supplanted here by direct import for the embed builders."
    - "FieldKind expansion as additive switch arms in GenericContentFields — new field kinds (number, boolean) add one local arm; no restructuring of PROPERTY_CONFIGS or PropertyPanel"

key-files:
  created:
    - leanshot/src/lib/page-builder/embed-src.ts
    - leanshot/src/lib/page-builder/embed-src.test.ts
    - leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx
    - leanshot/src/components/admin/pages/blocks/YouTubeBlock.tsx
    - leanshot/src/components/admin/pages/blocks/TallyBlock.tsx
    - leanshot/src/components/admin/pages/blocks/blocks.test.tsx
  modified:
    - leanshot/src/components/admin/pages/editor/property-configs.ts
    - leanshot/src/components/admin/pages/editor/PropertyPanel.tsx
    - supabase/functions/page-render/render.ts
    - supabase/functions/page-render/render.test.ts

key-decisions:
  - "Direct relative Deno import (not local mirror) for embed-src.ts. The module is dependency-free TypeScript — no DOM, no `Deno.*`, no React, no `crypto` — so `../../../leanshot/src/lib/page-builder/embed-src.ts` resolves cleanly under Deno's bundler. This is preferable to mirroring (single source of truth for the XSS/clickjacking seam; the 6 builders are tested ONCE in vitest)."
  - "Iframe-HTML builders ALSO live in embed-src.ts (alongside the src builders). This is the BLOCKER 2 factoring from the plan: no `<iframe ...>` template literal in render.ts. Both contracts (src strings AND full HTML strings) are unit-tested in vitest — no Deno test infra needed for the HTML contract."
  - "FieldKind extended with `number` + `boolean` — token-bounded (not color/hex/typography). Forward-compatible: 15-07 (lead-form) can reuse `boolean` for honeypot toggles without further changes."
  - "Existing render.test.ts `unimplemented type returns empty string` test swapped to use `'lead-form'` (15-07's pending case). This preserves the default fall-through contract and is the same forward-contract update 15-05 applied (15-05 swapped `'faq'` → `'calendly'`; we swap `'calendly'` → `'lead-form'`). Not a test deletion — a contract roll-forward."
  - "BlockType literal in render.ts switch is the schema literal (`youtube` / `calendly` / `tally`), per 15-03's BlockType union. The renderer-side marker `// embed-youtube` / `// embed-calendly` / `// embed-tally` comment is preserved on each branch so the cross-plan-grep stays stable. (Plan's `<interfaces>` block explicitly noted this contract.)"
  - "Wrapper CSS classes deliberately renamed away from `block-embed-{youtube,calendly,tally}` to `block-{yt,cal,tally}-wrap` so the `grep -cE \"embed-(youtube|calendly|tally)\"` acceptance count stays at exactly 3 (= the 3 branch-marker comments, not the wrapper class strings). The semantic outer class still identifies the section type."
  - "Per-provider sandbox set is minimum-necessary, NOT a one-size-fits-all string. YouTube doesn't need popups/forms; Calendly needs popups+forms for booking; Tally needs forms only. This reduces the per-iframe blast radius — UI-SPEC Performance Contract row 'sandbox' + Threat T-15-06-02/05."
  - "EMBED_IFRAME_TITLES exports concrete a11y title strings: `'Schedule a meeting'` (calendly), `'YouTube video player'` (youtube), `'Tally form'` (tally). Non-empty per Lighthouse ≥95 a11y gate."

metrics:
  duration: ~22 minutes
  tasks_completed: 3
  completed_date: 2026-05-15

requirements-completed: [PAGE-03]
---

# Phase 15 Plan 06: 3 Embed Blocks (Calendly + YouTube + Tally) — Summary

**Ship the 3 embed-provider blocks as 3 SEPARATE draggable blocks (D-01, D-02), each with its own tailored property editor, plus their 3 `renderBlock()` iframe branches in the public `page-render` renderer.**

## One-liner

Pure `embed-src.ts` exporting 3 validated-src builders + 3 iframe-HTML builders + non-empty a11y titles (allow-list videoId regex + exact-equality hostname check for Calendly/Tally — defeats look-alike hosts and `javascript:`/`data:` schemes); 3 editor block components rendering sandboxed/title'd iframes (or safe non-iframe fallback) with Skeleton loading overlay; 3 tailored PROPERTY_CONFIGS entries with new `number`/`boolean` field kinds; 3 new `renderBlock()` branches in the Deno renderer that CALL the iframe-HTML helpers (no `<iframe` template literal stays in render.ts — BLOCKER 2 factoring satisfied).

## Tasks Completed

| # | Name | Commits | Files |
|---|------|---------|-------|
| 1 | embed-src.ts pure validate+build helpers (TDD) | `8609f3b` (RED) + `6597ce6` (GREEN) | `leanshot/src/lib/page-builder/embed-src.ts`, `…/embed-src.test.ts` |
| 2 | 3 embed editor blocks + 3 tailored PropertyPanel field configs (TDD) | `a41acbe` (RED) + `15220cb` (GREEN) | `leanshot/src/components/admin/pages/blocks/{Calendly,YouTube,Tally}Block.tsx`, `…/blocks/blocks.test.tsx`, `…/editor/property-configs.ts`, `…/editor/PropertyPanel.tsx` |
| 3 | 3 embed renderBlock branches in page-render + iframe-HTML contract tests | `811a19c` | `supabase/functions/page-render/render.ts`, `…/render.test.ts`, `leanshot/src/lib/page-builder/embed-src.test.ts` (extended) |

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run src/lib/page-builder/embed-src.test.ts` | **41/41 pass** (31 src-builder + EMBED_IFRAME_TITLES + 10 iframe-HTML contract) |
| `npx vitest run src/components/admin/pages/blocks/blocks.test.tsx` | **15/15 pass** (3 blocks × 3 cases + 2 PROPERTY_CONFIGS test groups) |
| `npx vitest run` (full leanshot suite) | **922 pass / 39 skipped / 0 failed** (80 test files) |
| `npx tsc -b --noEmit` | clean (strict TS) |
| `npx eslint <8 plan files>` | 0 errors, 0 warnings |
| `npm run build` | succeeds in 3.18s |
| `bash scripts/assert-clinic-bundle-budget.sh` | exits 0; `index 14.55 kB gz` (ceiling 50 kB); `admin-bundle 6.13 kB gz` (ceiling 60 kB); `page-builder-runtime 1.20 kB gz` (ceiling 25 kB); `dnd-kit index-leak invariant OK` |
| `grep -cE "embed-youtube\|embed-calendly\|embed-tally" supabase/functions/page-render/render.ts` | **3** (exactly the 3 branch markers) |
| `grep -vE '^\s*//' supabase/functions/page-render/render.ts \| grep -c '<iframe'` | **0** (no `<iframe` template in render.ts — iframe-HTML factoring confirmed) |
| `grep -cE "buildCalendlyIframeHtml\|buildYouTubeIframeHtml\|buildTallyIframeHtml" supabase/functions/page-render/render.ts` | **6** (≥3 — 3 imports + 3 call sites) |
| `grep -nE "hostname ===" src/lib/page-builder/embed-src.ts` | 2 matches (parseAndValidateUrl helper) |
| `grep -nE "hostname.*(includes\|endsWith)" embed-src.ts` | only in comments — no code occurrences |
| `grep frame-src tests/csp/csp-snapshot.txt` | confirms `https://calendly.com https://www.youtube-nocookie.com https://tally.so` (15-02 dependency satisfied) |

## Per-Branch Visual Contract Highlights

### YouTube — `renderEmbedYouTube` + `YouTubeBlock`

Renderer (Deno) and editor (React) both call `buildYouTubeSrc({ videoId, startSeconds, autoplay })` which validates `videoId` against `/^[A-Za-z0-9_-]{1,20}$/`, clamps `startSeconds` via `Math.max(0, Math.floor(n))` (non-finite → 0), and emits `https://www.youtube-nocookie.com/embed/{id}?rel=0[&start=N][&autoplay=1]`. Invalid videoId → null → no iframe.

Iframe-HTML wraps in a 16:9 aspect-ratio container (`aspect-ratio: 16/9`, max-width 960px). Sandbox `allow-scripts allow-same-origin allow-presentation` + `allow=encrypted-media; picture-in-picture`. Title = `"YouTube video player"`.

### Calendly — `renderEmbedCalendly` + `CalendlyBlock`

`buildCalendlySrc({ calendlyUrl, prefillEmail })` parses with `new URL()` in try/catch, requires `protocol === 'https:'` AND `hostname === 'calendly.com'` (exact equality, NOT `endsWith`/`includes`). Re-serializes via `URL.toString()` so any embedded user characters are percent-encoded. `prefillEmail` does NOT change the static src — it only governs editor-side widget config (D-01 reads); the origin stays locked.

Iframe-HTML emits a 600px min-height container. Sandbox `allow-scripts allow-same-origin allow-popups allow-forms` (popups are needed for the Calendly booking confirmation step) + `allow=clipboard-write; payment`. Title = `"Schedule a meeting"`.

### Tally — `renderEmbedTally` + `TallyBlock`

`buildTallySrc({ tallyFormUrl, hideTitle })` same exact-equality `hostname === 'tally.so'` check as Calendly. Appends `hideTitle=1` to the search string when `hideTitle === true`, otherwise deletes the param via `URLSearchParams.delete` (so re-edits stay clean).

Iframe-HTML emits a 400px min-height container. Sandbox `allow-scripts allow-same-origin allow-forms` — minimum needed for a form widget; no popups. Title = `"Tally form"`.

### Editor preview UX (all 3 blocks)

- Each block component takes `{ block: BlockNode }` (HeroBlock shell).
- Narrows `block.content` to the per-provider shape with defensive `typeof` checks (BlockNode.content is `Record<string, unknown>`; the JSONB store can hand us anything).
- Calls the matching `buildXSrc`. When null → renders a DS `Card` fallback ("Add a valid {provider} link to preview the embed.") — NEVER an iframe with an unvalidated src.
- When the builder returns a src → renders the `<iframe>` with `referrerPolicy="no-referrer"`, `loading="lazy"`, the same `sandbox` set the renderer uses, and `title={EMBED_IFRAME_TITLES[provider]}`.
- DS `Skeleton` absolute-positioned over the iframe slot until `onLoad` fires; iframe opacity transitions 0 → 1 over 200ms (gated by `useReducedMotion()`).
- Token-bounded style classes from `block.style` exactly as HeroBlock does (`backgroundTone` via `backgroundToneClass`, `spacingDensity` via `paddingForDensity`, `hideOnMobile` → `hidden md:block`). No raw hex.

## PropertyPanel — D-02 tailored editors delivered

- `PROPERTY_CONFIGS.youtube.contentFields`: `videoId` (text), `startSeconds` (number, hint "0 = play from the beginning"), `autoplay` (boolean).
- `PROPERTY_CONFIGS.calendly.contentFields`: `calendlyUrl` (text, placeholder "https://calendly.com/your-handle/intro"), `prefillEmail` (boolean).
- `PROPERTY_CONFIGS.tally.contentFields`: `tallyFormUrl` (text, placeholder "https://tally.so/r/your-form-id"), `hideTitle` (boolean).
- New FieldKind values `'number'` + `'boolean'` are token-bounded (no color/hex/typography); the FAQBlock.test.tsx defensive assertion (`expect(field.kind).not.toBe('color' | 'hex' | 'typography')`) continues to pass since none of the new kinds are flagged.
- `GenericContentFields` gets 2 new switch arms: `'number'` renders a `<Input type="number">` with finite-number coercion + non-empty-string-required-or-default-0 contract; `'boolean'` renders a checkbox.

## render.ts switch — 3 new branches, additive only

```ts
case 'youtube':
  // embed-youtube
  return renderEmbedYouTube(block);
case 'calendly':
  // embed-calendly
  return renderEmbedCalendly(block);
case 'tally':
  // embed-tally
  return renderEmbedTally(block);
```

Each `renderEmbed*` wrapper is ~10 lines: narrow content, call the matching `buildXIframeHtml`, wrap the result in the standard `blockWrapperStyle` + `hideOnMobileClass` section wrapper. The entire iframe HTML — including the `<iframe ...></iframe>` itself — comes from `embed-src.ts`. The BLOCKER 2 "iframe-HTML factoring is MANDATORY" requirement is enforced by `grep -vE '^\s*//' render.ts | grep -c '<iframe' == 0`.

## block.type literals 15-03 actually shipped (downstream alignment note)

Per the plan's `<interfaces>` Note on render.ts case literals: 15-03's `BlockType` union uses bare `calendly` / `youtube` / `tally` for the schema discriminant. The renderer switch keys directly on those bare literals; the `// embed-youtube` / `// embed-calendly` / `// embed-tally` comment markers are appended to each branch so downstream greps stay stable. The acceptance-criteria `grep -cE` returns exactly **3** because the 3 markers are the only `embed-{provider}` occurrences (wrapper CSS classes intentionally use the shorter `block-{yt,cal,tally}-wrap` namespace to keep the marker count tight).

## Iframe-HTML lives in embed-src.ts, NOT render.ts (BLOCKER 2 fix confirmed)

`embed-src.ts` exports `buildCalendlyIframeHtml`, `buildYouTubeIframeHtml`, `buildTallyIframeHtml` — pure exported helpers that return either a complete `<iframe>`-wrapped HTML string OR an empty string when the matching src builder returned null. `render.ts` imports these 3 helpers and calls them as one-liners inside the 3 new wrappers. Verification: `grep -vE '^\s*//' render.ts | grep -c '<iframe'` returns `0`.

## CSP frame-src dependency satisfied

`tests/csp/csp-snapshot.txt` `frame-src` line already contains all 3 origins (15-02 / 15-04 owns this file):
```
frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://calendly.com https://www.youtube-nocookie.com https://tally.so;
```
This plan did NOT modify `tests/csp/csp-snapshot.txt` or any CSP source.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Auto-fix blocking issue] `leanshot/node_modules` missing in worktree**

- **Found during:** Task 1 first `npx vitest run` invocation.
- **Issue:** Worktree had no `leanshot/node_modules`; vitest startup error.
- **Fix:** Ran `cd leanshot && npm install --prefer-offline --no-audit --no-fund` (848 packages, 7s). Verified per memory `feedback_worktree_executor_npm_install_leak` that the install did NOT leak into main (`git status --short leanshot/package.json leanshot/package-lock.json` → clean).
- **Files modified:** None tracked — `leanshot/node_modules/**` is gitignored.
- **Commit:** N/A — environment setup only.

**2. [Rule 2 — Auto-add missing critical functionality] Existing `unimplemented type returns empty string` test required updating**

- **Found during:** Task 3 — `renderBlock` switch now handles `'calendly'`.
- **Issue:** 15-05's `render.test.ts` `renderBlock: unimplemented type returns empty string` test asserted `block.type='calendly'` returns `''`. After this plan, `'calendly'` is implemented and returns real HTML; the test would have failed as a false-negative on the next `deno test` run.
- **Fix:** Swapped to `'lead-form'` (15-07's pending case). Preserves the contract: the `default:` fall-through still returns `''` for not-yet-implemented types. This is the same forward-contract roll-forward pattern 15-05 applied (15-05 swapped `'faq'` → `'calendly'`).
- **Files modified:** `supabase/functions/page-render/render.test.ts` (one assertion + one comment).
- **Commit:** Folded into Task 3 commit (`811a19c`).
- **Threat-model justification:** None — forward contract update.

**3. [Rule 2 — Auto-add missing critical functionality] FieldKind union extended with `'number'` + `'boolean'`**

- **Found during:** Task 2 — implementing the 3 tailored property editors.
- **Issue:** YouTube's `startSeconds` is numeric and `autoplay`/`prefillEmail`/`hideTitle` are booleans. 15-05's `FieldKind` only had string-flavored kinds (`text`/`textarea`/`text-list`/`*-items`/`image-url+alt`). Without extending the union, either (a) the property editor would mis-render numbers as text strings (breaking the contract that `startSeconds` is a number) or (b) the booleans would be edited as `'true'/'false'` strings (breaking the builder's `autoplay === true` check).
- **Fix:** Added `'number'` + `'boolean'` to `FieldKind`. Both are token-bounded — they take no color/hex/typography input. Added matching switch arms in `GenericContentFields`: number renders `<Input type="number">` with finite-coerce + default-0; boolean renders a `<input type="checkbox">` label.
- **Files modified:** `property-configs.ts`, `PropertyPanel.tsx`.
- **Commit:** Folded into Task 2 commit (`15220cb`).
- **Threat-model justification:** None — the new kinds add token-bounded form controls; they do NOT widen the styling surface.

**4. [Rule 1 — Bug] Wrapper CSS classes triggered unintended grep marker count**

- **Found during:** Task 3 acceptance-criteria verification (`grep -cE` was returning 9 instead of 3).
- **Issue:** Initial draft named the section-wrapper classes `block-embed-youtube-wrap` / `block-embed-calendly-wrap` / `block-embed-tally-wrap`. Each appeared twice per branch (className + child class), totalling 9 marker hits (3 comments + 6 class strings) — failing the acceptance "returns exactly 3" assertion.
- **Fix:** Renamed wrapper classes to `block-yt-wrap` / `block-cal-wrap` / `block-tally-wrap`. The marker comments (`// embed-youtube`, `// embed-calendly`, `// embed-tally`) on each `case` branch remain the canonical grep target; class strings are now a separate namespace. Marker count is now exactly **3**.
- **Files modified:** `supabase/functions/page-render/render.ts` (3 wrapper functions only — no behavior change).
- **Commit:** Folded into Task 3 commit (`811a19c`).
- **Threat-model justification:** None — CSS class renaming with zero behavior change.

**5. [Rule 1 — Bug] Unused `screen` import in blocks.test.tsx**

- **Found during:** Task 2 pre-commit `eslint` invocation.
- **Issue:** `@testing-library/react`'s `screen` was imported but never used; `@typescript-eslint/no-unused-vars` flagged it.
- **Fix:** Removed the unused import. (Tests use `container.querySelector` directly — no top-level screen query needed.)
- **Files modified:** `blocks.test.tsx`.
- **Commit:** Folded into Task 2 commit (`15220cb`).
- **Threat-model justification:** None — import hygiene fix.

### Deferred Items

None — every plan acceptance criterion is satisfied.

## Known Stubs

| Surface | File | Reason |
|---------|------|--------|
| `prefillEmail` toggle has no visible effect on the iframe src | `embed-src.ts` (`buildCalendlySrc`) | Calendly's prefill is driven via JS widget configuration (`window.Calendly.initInlineWidget` with `prefill` opts), NOT a query-param on the embed src. Phase 15 published pages ship ZERO JS (D-17), so an iframe-only embed cannot wire up prefill. The toggle is reserved for a future plan that pairs the embed with an opt-in JS bundle, OR for the editor-side preview only. Documented but visually inert on the public page; the static src origin stays locked regardless. |
| `autoplay` toggle is honored on the embed src but blocked by most browsers without user gesture | `embed-src.ts` (`buildYouTubeSrc`) | YouTube/Chrome/Safari block autoplay-with-sound for embedded iframes on cold load. Setting `autoplay=1` is a contract-correct signal from the editor, but visitors will typically still see a click-to-play poster. This is YouTube/browser policy, not a Phase 15 limitation. |

Neither stub prevents the plan's goal (PAGE-03's 3 embed blocks ship). They are documented browser/provider limitations.

## Cross-Plan Dependencies for Later Phase 15 Plans

- **15-07 (lead-form) MUST:**
  - ADD one new `case 'lead-form':` branch to `renderBlock()` in `supabase/functions/page-render/render.ts` directly below this plan's 3 new cases (or in its own grouped block — same seam).
  - ADD one new key (`'lead-form'`) to `PROPERTY_CONFIGS` in `property-configs.ts`. The registry is FLAT — additive merge.
  - Update `render.test.ts`'s `unimplemented type returns empty string` test to use a NEW not-yet-implemented type (or remove the test if all 12 BlockType literals are now implemented). Same forward-contract pattern this plan applied.
- **15-08 (SEO cascade) MUST:**
  - Replace ONLY the body of `renderSeoHead` (still untouched here). The embed branches do not interact with the SEO seam.

## Threat Surface Scan

All `<threat_model>` items ship mitigated as documented in the plan:

| Threat | Mitigation in this commit |
|--------|---------------------------|
| T-15-06-01 (Tampering — iframe src from untrusted content) | `embed-src.ts` allow-list. YouTube videoId regex `/^[A-Za-z0-9_-]{1,20}$/`. Calendly + Tally URLs validated via `URL` ctor + exact `protocol === 'https:'` + exact `hostname ===` equality. Unit-tested with hostile inputs (`'../evil'`, `'a b'`, `'"><script>'`, `https://calendly.com.evil.com/x`, `javascript:`, `data:`, look-alike subdomain prefix). Invalid → `null` → no iframe. |
| T-15-06-02 (Info disclosure — referrer / parent leak to third party) | Every iframe carries `referrerpolicy="no-referrer"`. YouTube uses `youtube-nocookie.com` (no tracking cookie on cold load). Verified by `grep -c "www\.youtube\.com" render.ts == 0` (no bare youtube.com URL escapes). |
| T-15-06-03 (Spoofing — look-alike domains) | Exact `hostname ===` equality, never `endsWith`/`includes`. Tested with `calendly.com.evil.com`, `evil.com/calendly.com`, `tally.so.evil.com`, `app.calendly.com` (subdomain — rejected by exact-equality). Acceptance grep confirms NO `includes`/`endsWith` on hostname in CODE (comments are explanatory). |
| T-15-06-04 (Tampering — origin drift from CSP allow-list) | The 3 builder origins are PINNED to the 3 origins in `tests/csp/csp-snapshot.txt` `frame-src`: `calendly.com`, `www.youtube-nocookie.com`, `tally.so`. Confirmed present (read-only — this plan does NOT touch CSP). |
| T-15-06-05 (EoP via embedded frame — clickjacking) | `sandbox` attribute restricts each iframe to minimum-necessary capabilities. No `allow-top-navigation`, no `allow-modals`. Per-provider sandbox set is tuned to the minimum needed for the provider to function. Residual risk accepted (UI-SPEC: published pages ship ZERO app JS; rendered surface has no user-session context). |
| T-15-06-06 (DoS — hostile startSeconds) | `startSeconds` coerced via `Number.isFinite` + `Math.max(0, Math.floor(n))`. Negative → 0. NaN/Infinity → 0. Fractional → floored. Unit-tested. |

No new threat flags beyond the documented register. The 6 plan threats are all mitigated; T-15-06-05 is the only accept-with-mitigation, and the mitigation is unchanged from the plan.

## Performance

- **Duration:** ~22 minutes (Task 1: ~8 min — embed-src.ts RED+GREEN with 31 tests; Task 2: ~9 min — 3 block components + property-configs/PropertyPanel updates + 15 tests; Task 3: ~5 min — render.ts wrappers + 10 iframe-HTML contract tests + render.test.ts forward-contract update)
- **Tasks:** 3/3
- **Files created:** 6 (embed-src.ts + embed-src.test.ts + 3 block components + blocks.test.tsx)
- **Files modified:** 4 (property-configs.ts + PropertyPanel.tsx + render.ts + render.test.ts)

## Self-Check: PASSED

- [x] Task 1 RED commit `8609f3b` exists; Task 1 GREEN commit `6597ce6` exists — verified `git log`
- [x] Task 2 RED commit `a41acbe` exists; Task 2 GREEN commit `15220cb` exists
- [x] Task 3 commit `811a19c` exists
- [x] `leanshot/src/lib/page-builder/embed-src.ts` exports all 6 builders + `EMBED_IFRAME_TITLES`
- [x] `leanshot/src/components/admin/pages/blocks/{CalendlyBlock,YouTubeBlock,TallyBlock}.tsx` all exist
- [x] `leanshot/src/components/admin/pages/blocks/blocks.test.tsx` exists with 15 cases
- [x] `leanshot/src/components/admin/pages/editor/property-configs.ts` has 3 new keys (calendly/youtube/tally) + 2 new FieldKind values
- [x] `leanshot/src/components/admin/pages/editor/PropertyPanel.tsx` has 2 new switch arms (`number` + `boolean`)
- [x] `supabase/functions/page-render/render.ts` has 3 new `case` branches with `// embed-{provider}` markers — verified by grep (returns 3)
- [x] `supabase/functions/page-render/render.ts` non-comment lines contain NO `<iframe` substring — verified (BLOCKER 2 factoring)
- [x] CSP snapshot `frame-src` contains all 3 origins — verified (read-only, 15-02 owns)
- [x] All vitest tests (922/922 pass), tsc strict clean, lint clean on 8 plan files, build succeeds, bundle ceilings green
- [x] No modification to STATE.md / ROADMAP.md / REQUIREMENTS.md (orchestrator owns those writes)
- [x] No `supabase functions deploy` run — left to orchestrator
