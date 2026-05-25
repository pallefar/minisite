---
phase: 41-public-status-page-embed-provider-blocks
plan: 05
subsystem: public-embeds + helpdesk-kb
tags:
  - ui
  - embeds
  - consent-gating
  - retrofit
  - kb-articles
requires:
  - 41-01 (CONSENT_CHANGE_EVENT + subscribeToConsentChange)
  - 41-02 (validateCustomIframeUrl + listHostnames + BlockType custom_iframe)
  - 41-03 (server-side consent-gating already retrofit)
provides:
  - ConsentGatedEmbed HOC owning Surface B State 1/2/3
  - EmbedPlaceholderCard with verbatim per-provider copy (D-08)
  - CustomIframeBlock with allowlist fetch + 3-error UX
  - PROPERTY_CONFIGS["custom_iframe"] (3 fields)
  - KB-article ReactMarkdown components mapper for <embed-block>
affects:
  - Calendly / YouTube / Tally / CustomIframe blocks (consent-gated end-to-end)
  - Helpdesk KB articles (embed-block render with consent-gating)
tech-stack:
  added: []
  patterns:
    - HOC over per-block iframe to centralize Surface B state machine
    - Synchronous mount-time CookieConsent.acceptedCategory read (defends mount-race T-41-05-02)
    - Iframe UNMOUNT on revoke (never src='' anti-pattern)
    - dompurify ADD_TAGS/ADD_ATTR tight allowlist for custom marker tag
key-files:
  created:
    - leanshot/src/components/admin/pages/blocks/ConsentGatedEmbed.tsx
    - leanshot/src/components/admin/pages/blocks/EmbedPlaceholderCard.tsx
    - leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx
    - leanshot/src/components/admin/pages/blocks/__tests__/ConsentGatedEmbed.test.tsx
    - leanshot/src/components/admin/pages/blocks/__tests__/CustomIframeBlock.test.tsx
    - leanshot/src/helpdesk/__tests__/KBArticleView.embed-block.test.tsx
  modified:
    - leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx
    - leanshot/src/components/admin/pages/blocks/YouTubeBlock.tsx
    - leanshot/src/components/admin/pages/blocks/TallyBlock.tsx
    - leanshot/src/components/admin/pages/editor/property-configs.ts
    - leanshot/src/helpdesk/KBArticleView.tsx
    - leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx
decisions:
  - D-07 per-provider categories implemented at call site, not block content
  - D-16 FIXED sandbox literal hardcoded in CustomIframeBlock (no admin override)
  - D-08 placeholder copy verbatim from UI-SPEC §Copywriting Contract
  - EMBED-06: KB embed-block uses hand-written <embed-block type=... data-url=...> in v1.3 (rich-text drop-in deferred to v1.4)
metrics:
  duration_minutes: 12
  commits: 5
  tasks_completed: 3
  tests_added: 20
  files_modified: 12
completed: 2026-05-24
requirements_covered:
  - EMBED-01
  - EMBED-02
  - EMBED-03
  - EMBED-04
  - EMBED-05
  - EMBED-06
  - EMBED-07
---

# Phase 41 Plan 05: ConsentGatedEmbed HOC + retrofit blocks + KB integration Summary

ConsentGatedEmbed HOC + EmbedPlaceholderCard + new CustomIframeBlock + 3-block retrofit + KB article render — full Surface B consent-gating + Surface C custom-iframe authoring + EMBED-06 helpdesk reach.

## What shipped

### 1. ConsentGatedEmbed HOC public API + state machine

`ConsentGatedEmbed.tsx` (new file) owns the entire Surface B state machine:

```ts
interface ConsentGatedEmbedProps {
  provider: 'calendly' | 'youtube' | 'tally' | 'custom_iframe';
  categories: ReadonlyArray<'analytics' | 'marketing' | 'functional' | 'personalization'>;
  minHeight?: number;
  aspectRatio?: string;
  sandbox: string;       // hardcoded by caller — admin cannot override
  title: string;
  src: string;
  allow?: string;        // optional iframe `allow=` attribute
}
```

State machine:
- **State 1 (`placeholder`)** — `EmbedPlaceholderCard` rendered; **no iframe in DOM**.
- **State 2 (`loading`)** — `Card aria-busy=true` + `Skeleton` overlay + iframe with `opacity-0`. Reduced-motion gates `transition-opacity`.
- **State 3 (`loaded`)** — same `Card` (no Skeleton), iframe `opacity-100`.

Transitions:
- Mount → reads `CookieConsent.acceptedCategory(c)` synchronously for every required category. If all granted → State 2 immediately (defends T-41-05-02 mount-race).
- `subscribeToConsentChange` → on each event, re-reads `acceptedCategory` for every required category (defense-in-depth vs spoofed events per T-41-05-06).
- Grant → `placeholder` → `loading`.
- iframe `onLoad` → `loading` → `loaded`.
- Revoke → any state → `placeholder` (iframe UNMOUNTS via conditional render — T-41-05-01 mitigation; never `src=''`).

### 2. Per-provider D-07 + D-16 mapping (enforced at call sites)

| Provider | Categories | Sandbox flags | min-height / aspect |
|----------|-----------|---------------|---------------------|
| calendly | `['functional','analytics']` | `allow-scripts allow-same-origin allow-popups allow-forms` | minHeight 700 |
| youtube | `['analytics','marketing']` | `allow-scripts allow-same-origin allow-presentation` | aspectRatio 16/9 |
| tally | `['functional']` | `allow-scripts allow-same-origin allow-forms` | minHeight 500 |
| custom_iframe | `['marketing']` | `allow-scripts allow-same-origin` (D-16 FIXED) | minHeight 400 |

Sandbox strings are HARDCODED at each block's `<ConsentGatedEmbed sandbox="...">` call — `block.content` carries no sandbox field, so admin cannot override (T-41-05-07 mitigation). CustomIframeBlock additionally has NO sandbox PROPERTY_CONFIGS entry, so the field cannot leak in via JSON.

### 3. CustomIframeBlock validation flow

`CustomIframeBlock.tsx` (new file) wires Plan 41-02's `validateCustomIframeUrl` + `listHostnames`:

1. `useEffect` calls `listHostnames(supabase)` once on mount → cached in module state. Failure → fails closed (treated as empty allowlist).
2. While `allowlist === null`, renders a Skeleton (no error, no iframe).
3. Once loaded, runs `classifyError()`:
   - `embedUrl.trim() === ''` → **"Embed URL is required"**
   - URL unparseable OR `protocol !== 'https:'` → **"URL must start with https://"**
   - `parsed.hostname` not in allowlist → **"Hostname [host] is not on the allowlist. Ask a superadmin to add it at /admin/embeds/allowlist."**
4. On valid → `<ConsentGatedEmbed provider="custom_iframe" categories={['marketing']} minHeight={400} sandbox="allow-scripts allow-same-origin" title={iframeTitle || 'Embedded content'} src={validated}>`.

Error UX renders inside a `Card` with `aria-invalid={true}` + `border-2 border-[--color-danger]` + `--color-danger` text (UI-SPEC §Surface C inline error).

`widthMode=false` constrains the inner wrapper to `max-w-[900px] mx-auto` per UI-SPEC §Surface C.

### 4. PROPERTY_CONFIGS["custom_iframe"]

Added verbatim to `property-configs.ts`:

```ts
custom_iframe: {
  contentFields: [
    {
      key: 'embedUrl',
      label: 'Embed URL',
      kind: 'text',
      placeholder: 'https://meet.example.com/page',
      hint: 'Full URL of the page to embed. Hostname must be on the per-deployment allowlist — contact a superadmin if you need a new host added.',
    },
    {
      key: 'iframeTitle',
      label: 'Accessible title',
      kind: 'text',
      hint: 'Required for screen readers. Describes what the embed contains, e.g. "Patient intake form".',
    },
    { key: 'widthMode', label: 'Full-width', kind: 'boolean' },
  ],
},
```

Mirrors the existing `tally` entry shape (same `kind` values; no new field types; D-05 token-bounded preserved).

### 5. KB article + editor dompurify retrofit (EMBED-06)

`KBArticleView.tsx`:
- `DOMPurify.sanitize(body, { USE_PROFILES: { html: true }, ADD_TAGS: ['embed-block'], ADD_ATTR: ['type','data-url','data-id','data-allow'] })`. Tight 4-attribute allowlist — no event handlers, no style (T-41-05-04 mitigation).
- `<ReactMarkdown components={{ 'embed-block': ... }}>` resolves the custom tag to the matching React block by `type` attribute. `buildBlockFromEmbedAttrs(type, dataUrl)` synthesizes a `BlockNode` payload for each provider (calendly/youtube/tally/custom_iframe — each block's existing content shape).
- YouTube extraction: handles both `youtube.com/watch?v=ID` and `youtube.com/embed/ID` URL shapes via `extractYouTubeId`.

`KBEditorPage.tsx` line 237 (preview path):
- Same dompurify config extension so editor preview matches consumer render exactly.

KB authors hand-write `<embed-block type="youtube" data-url="https://www.youtube.com/embed/abc"></embed-block>` syntax in v1.3 (per RESEARCH Open Question 3 recommendation; rich-text drop-in deferred to v1.4).

## Test inventory

### Task 1 — ConsentGatedEmbed HOC + EmbedPlaceholderCard (7 cases)
1. State 1 — no consent → placeholder only, no iframe.
2. State 1 → State 2/3 — dispatch event + mock acceptedCategory=true → iframe with `opacity-0` → onLoad → `opacity-100`.
3. State 3 → State 1 — revoke unmounts iframe (`querySelector('iframe') === null`).
4. Mount-race — sync `acceptedCategory=true` at mount → State 2 without event.
5. Reduced motion — iframe className has NO `transition-opacity`.
6. A11y — `aria-busy="true"` on wrapping Card; iframe has `title`.
7. Placeholder copy — calendly heading verbatim + Manage cookie preferences link.

### Task 2 — CustomIframeBlock (7 cases)
1. Allowlisted hostname → iframe with sandbox=`allow-scripts allow-same-origin` and src containing hostname.
2. Non-allowlisted → exact error string with hostname interpolated.
3. Empty embedUrl → "Embed URL is required".
4. Non-https → "URL must start with https://".
5. PROPERTY_CONFIGS["custom_iframe"] has the three fields.
6. Category prop `['marketing']` (asserted via the iframe rendering through the HOC's category gate).
7. Empty iframeTitle → iframe `title="Embedded content"` (D-16 fallback).

### Task 3 — KBArticleView embed-block (6 cases)
1-4. Each provider type (`youtube`/`calendly`/`tally`/`custom_iframe`) renders to the matching React block with `data-provider` attr set.
5. Adjacent `<script>` stripped; `window.__pwned` undefined; no `<script>` in `<article>`.
6. `onerror="alert(1)"` on `<embed-block>` stripped (ADD_ATTR tight).

**Total: 20 tests, all green; tsc strict clean; lint clean on plan files.**

## Deviations from Plan

None — plan executed exactly as written. Lint auto-fix (`import-x/order`) ran across all touched files alongside the Task 3 commit; cosmetic only.

## Self-Check: PASSED

- ✅ `leanshot/src/components/admin/pages/blocks/ConsentGatedEmbed.tsx` exists
- ✅ `leanshot/src/components/admin/pages/blocks/EmbedPlaceholderCard.tsx` exists
- ✅ `leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx` exists
- ✅ `leanshot/src/components/admin/pages/blocks/__tests__/ConsentGatedEmbed.test.tsx` exists
- ✅ `leanshot/src/components/admin/pages/blocks/__tests__/CustomIframeBlock.test.tsx` exists
- ✅ `leanshot/src/helpdesk/__tests__/KBArticleView.embed-block.test.tsx` exists
- ✅ commits 561369bc, d42151b3, aa69ec6a, af652175, eb20e514 all present in `git log`
- ✅ all 20 unit tests green
- ✅ `npx tsc -p tsconfig.app.json --noEmit` exits 0
- ✅ `grep -q "custom_iframe" property-configs.ts` → present
- ✅ `grep -q "ADD_TAGS.*embed-block"` in both KBArticleView.tsx and KBEditorPage.tsx
- ✅ all 3 retrofit blocks (Calendly/YouTube/Tally) import ConsentGatedEmbed
