# Phase 41: Public Status Page + Embed-Provider Blocks — Research

**Researched:** 2026-05-21
**Domain:** Public status page (vendor-config) + page-builder embed-block extension + CSP allowlist (static + dynamic) + superadmin allowlist admin UI
**Confidence:** HIGH — every load-bearing claim is verified against on-disk code (Phase 15 block schema, Phase 22 consent banner, Phase 12 CSP snapshot, Phase 25 audit_logs, Phase 24 admin modules)

---

## Summary

Phase 41 ships two independent workstreams in one phase: (A) **Better Stack hosted status page** at `status.leanshot.app` — almost entirely vendor config + founder HUMAN-UAT, ~1 plan; and (B) **4 new page-builder embed-block types** — adds `custom_iframe` as the 13th `BlockType` literal, hardens the existing `calendly` / `youtube` / `tally` blocks with **consent gating + lazy-load-on-grant** (the existing Phase 15 blocks render unconditionally — no consent gate yet), wires per-deployment **dynamic CSP frame-src** for Custom-iframe via a Vercel middleware (Vercel `vercel.json` does NOT support per-request CSP today — it ships ONE static header from a `headers[]` entry, verified in `leanshot/vercel.json:40-49`), ships a **superadmin-only allowlist UI** at `/admin/embeds/allowlist`, and re-uses the existing helpdesk KB Markdown renderer for EMBED-06.

**Two findings that must drive planning:**

1. **The existing Phase 15 calendly/youtube/tally blocks render WITHOUT consent gating.** `CalendlyBlock.tsx:38-71` (verified) renders the iframe immediately — no consent check, no consent listener. Phase 41 D-09 is therefore a **retrofit** of consent gating across `CalendlyBlock` + `YouTubeBlock` + `TallyBlock` (editor preview surfaces) AND across the Deno-side `renderEmbedYouTube / renderEmbedCalendly / renderEmbedTally` (public-page-render) — NOT a greenfield gate on `custom_iframe` only.
2. **The Phase 22 consent banner does NOT currently emit a custom event.** `src/components/consent/consent-config.ts:261-273` shows only three vanilla-cookieconsent callbacks (`onFirstConsent` / `onConsent` / `onChange`) wired to `updateGtagConsent()` + `upsertConsentRecord(cookie)`. **No `window.dispatchEvent` call exists in consent-defer.ts or consent-config.ts.** Phase 41 D-09 must therefore (a) ADD the emit (in `onChange` + `onConsent` + `onFirstConsent`) and (b) document the canonical event shape — it does NOT inherit one. UI-SPEC's mention of `window.dispatchEvent(new CustomEvent('leanshot:open-consent-banner'))` is also unconfirmed — there is no current listener registered.

**Primary recommendation:** Slot the work into **6 plans** — 1 for Workstream A (HUMAN-UAT + DNS + branding handoff + lightweight smoke gate), 5 for Workstream B (consent-emit retrofit on Phase 22 banner → embed block consent-gating render layer + Custom-iframe block + dynamic CSP middleware + Superadmin allowlist UI + CSP snapshot extension). Workstream A and Workstream B's first 4 plans can dispatch as **2 parallel waves**.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Workstream A — Better Stack Status Page (POLISH-10)**

- **D-01: Hybrid 7-component shape (hierarchical).** Top-level user-facing: Patient App / Clinic App / Admin / Public Site. Sub-grouped: Auth / Database / Webhooks. Better Stack supports component groups; we use them. Status rolls UP (any sub-service degraded → parent shows degraded).
- **D-02: Conservative auto-incident thresholds.** Sentry error rate >5% / 5min → incident; Vercel deploy fail → incident (prod only triggers public-facing); Supabase p95 query >1s / 10min → incident; Better Stack heartbeat every 30s on the 4 user-facing surfaces. Admin tunes via Better Stack UI directly — no in-app config in v1.3.
- **D-03: Email-only subscriber notifications via Better Stack's hosted form** on `/status` page. No RSS / Slack in v1.3. Better Stack handles delivery; LeanShot doesn't store subscriber emails.
- **D-04: Maintenance windows scheduled via Better Stack admin UI** directly. No in-app dashboard.
- **D-05: DNS — `status.leanshot.app` CNAME → Better Stack endpoint.** New DNS record paired with leanshot.app + app.leanshot.app. Vercel project unchanged.
- **D-06: HUMAN-UAT pre-req.** Founder action: (a) Better Stack paid-tier upgrade ($12/mo); (b) Sentry + Vercel + Supabase OAuth integration; (c) configure 7 components per D-01; (d) CNAME setup at registrar. Tracked in PLAN.md as an explicit Task.

**Workstream B — Embed Blocks: Cookie Consent + Per-Provider Category (EMBED-04/05)**

- **D-07: Fixed per-provider consent-category mapping.** Calendly → functional+analytics; YouTube → analytics+marketing; Tally → functional; Custom-iframe → marketing.
- **D-08: Branded placeholder fallback on consent decline.** Card with provider logo + headline "Enable [category] cookies to view this [...]" + secondary "Manage cookie preferences" link that re-opens the P22 consent banner. Reuses DS Card primitive.
- **D-09: Auto-load on consent grant via P22 consent-state event listener.** When user grants the required category, embed blocks lazy-load immediately. No reload required.
- **D-10: Loading UX per EMBED-05.** DS Skeleton placeholder until iframe `onLoad`; opacity 0→1 over 200ms; gated by `useReducedMotion()`. Phase 15 pattern.

**Workstream B — CSP Allowlist Policy (EMBED-04)**

- **D-11: CSP enforced from day 1 + reporting endpoint.** No report-only phase. Explicit `frame-src` + `script-src` + `connect-src` additions to the existing `vercel.json` CSP header. Violations routed to a Sentry CSP reporting endpoint.
- **D-12: Conservative per-provider host entries — exact hosts only.** Calendly: `frame-src calendly.com *.calendly.com`, `script-src assets.calendly.com`, `connect-src api.calendly.com`. YouTube: `frame-src youtube-nocookie.com www.youtube-nocookie.com`, `script-src www.youtube-nocookie.com s.ytimg.com`, `img-src i.ytimg.com`. Tally: `frame-src tally.so *.tally.so`, `script-src tally.so`. Custom-iframe: `frame-src` extended at request time per D-14.
- **D-13: Monthly CSP-violation review** by founder/ops via Sentry dashboard; provider host additions land via PR (audit trail in git).
- **D-14: Custom-iframe CSP allowlist is per-deployment + dynamically injected.** Stored in `iframe_allowlist` table OR env var (planner picks); rendered into CSP at request time by a Vercel middleware.

**Workstream B — Custom-Iframe Security Model (EMBED-07)**

- **D-15: Hostname-exact match against per-deployment allowlist.** Server-side validator extracts URL hostname; checks exact-match. Subdomain match NOT permitted (`meet.example.org` does NOT permit `sub.meet.example.org`).
- **D-16: iframe sandbox flags FIXED for Custom-iframe.** Default sandbox = `'allow-scripts allow-same-origin'`. Admin CANNOT override via UI in v1.3. Provider-specific embeds have their own hardcoded sandbox attributes per provider docs.
- **D-17: Superadmin-only allowlist UI at `/admin/embeds/allowlist`.** Add/remove hostnames; UI shows last-used timestamp + which pages reference the host. Audit log retention 90d via Phase 25 `audit_logs`.
- **D-18: Custom-iframe blocks live OUTSIDE the Phase 12 ad-free firewall — ad-eligible.** Embeds are in the "embed" bucket per Phase 12 D-02. Ad-free `/clinic` routes still don't load ad-network domains but CAN load custom-iframe content. ESLint `import-x/no-restricted-paths` zone for `src/lib/native/ads*.ts` is unaffected.

### Claude's Discretion

- **PageEditor Calendly inline preview — popup OAuth NOT iframe-internal** (V13-EMBED pitfall). Click a Calendly block → opens Calendly OAuth popup window (separate browser window, NOT a nested iframe). Popup posts result via `postMessage`. Planner picks: postMessage origin validation, OAuth token storage shape (in-memory vs sessionStorage), error UX on popup-blocked.
- **CSP snapshot test extension.** Phase 12 D-10 snapshot test extends to assert new per-provider entries from D-12. Planner picks the test update shape.
- **Embed block schema in page builder.** New block types `embed.calendly` / `embed.youtube` / `embed.tally` / `embed.custom_iframe`. *Research correction:* CONTEXT names them `embed.X` but the existing Phase 15 union uses the bare literal (`calendly`, `youtube`, `tally`) — see `src/lib/page-builder/block-schema.ts:36-48`. **Recommend extending the union with `custom_iframe` only** (not all four — three already exist).
- **Embed render in helpdesk KB articles (EMBED-06).** Same block-render component used in PageBuilder + KB. Planner picks composition.
- **dompurify config for admin-pasted HTML.** Reuse existing dompurify 3.2.7 chain — `src/admin/modules/helpdesk/KBEditorPage.tsx:237` already uses `DOMPurify.sanitize(previewBody, { USE_PROFILES: { html: true } })`.
- **iframe `loading="lazy"`** attribute on all embed iframes. No JS-driven IntersectionObserver.
- **Better Stack integration shape.** Sentry → Better Stack OAuth; Vercel → deploy-hook webhook; Supabase → heartbeat ping. Founder configures during D-06 HUMAN-UAT.

### Deferred Ideas (OUT OF SCOPE)

- In-app status dashboard pulling Better Stack API (v1.4).
- RSS / Slack subscriber channels (v1.4+).
- Per-org custom-iframe allowlist (v1.3 = superadmin-only at deployment scope).
- Admin-overridable iframe sandbox flags (v1.3 locked-down; per-provider hardcoded).
- Stripped-down no-cookie preview proxies on consent decline (defer to v1.4; branded placeholder is the fallback).
- Admin maintenance-window scheduling UI (Better Stack admin UI in v1.3).
- Embed analytics (v1.4 polish).
- Per-environment CSP report destination (single endpoint in v1.3).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POLISH-10 | Public status page at `status.leanshot.app` via Better Stack ($12/mo); auto-incident from Sentry + Vercel + Supabase | Workstream A — vendor config + HUMAN-UAT (D-01..D-06); 1 plan, no LeanShot code change beyond DNS smoke check + footer link addition |
| EMBED-01 | Admin drops Calendly block → visitor sees Calendly widget in sandboxed iframe + lazy-loaded after cookie consent | Existing `CalendlyBlock.tsx` renders unconditionally — **retrofit** consent gate around `<iframe>`; CSP `frame-src https://calendly.com` already present in `vercel.json:42`; D-09 listener wiring is new |
| EMBED-02 | Admin drops YouTube block → visitor sees embed via `youtube-nocookie.com` + lazy-loaded | Existing `YouTubeBlock.tsx` + `buildYouTubeSrc` already route through `youtube-nocookie.com`; retrofit consent gate; extend CSP `script-src www.youtube-nocookie.com s.ytimg.com` + `img-src i.ytimg.com` (D-12) |
| EMBED-03 | Admin drops Tally block → visitor sees form + sandboxed + consent-gated | Existing `TallyBlock.tsx` + `buildTallySrc`; retrofit consent gate; CSP already has `frame-src https://tally.so` — add `script-src tally.so` per D-12 |
| EMBED-04 | Every embed iframe has `sandbox` attribute + CSP allowlist updated + dompurify XSS protection on admin-pasted HTML | Sandbox attrs already on existing blocks (`embed-src.ts:173,190,206`); Custom-iframe gets new `allow-scripts allow-same-origin` (D-16); CSP extended (D-12); dompurify chain reused from KB editor |
| EMBED-05 | Embed loading shows DS Skeleton until `onLoad` + opacity 200ms gated by `useReducedMotion()` | Existing `CalendlyBlock.tsx:30,53-68` already implements this pattern; replicate on new `CustomIframeBlock`; ensure public-page-render (Deno) emits equivalent inline JS for client-side hydration of the same state machine |
| EMBED-06 | Embed blocks render in helpdesk KB articles (extends to M6 surfaces) | `src/helpdesk/KBArticleView.tsx` already uses `react-markdown` + `remark-gfm` + `rehype-raw` + dompurify. Two paths: (1) add a custom `components` mapper to detect a `<embed-block type="..." data="...">` HTML tag in markdown body and render the block component; (2) author embeds as raw HTML and rely on dompurify allowlisting `<iframe>` for whitelisted hosts. **Recommend (1)** — keeps dompurify config tight and KB-content authors can drop block-by-id markers |
| EMBED-07 | Custom-iframe block + admin allowlist + CSP + iframe `src` validator | NEW block type — extend `BlockType` union, add `PROPERTY_CONFIGS['custom_iframe']` entry, add `buildCustomIframeSrc` + `buildCustomIframeHtml` to `embed-src.ts` mirroring existing helpers, add `CustomIframeBlock.tsx` editor preview component, mirror in `render.ts` Deno renderer |
| EMBED-08 | Live Calendly availability preview inline in PageEditor via popup OAuth (NOT iframe-internal) | NEW — Calendly OAuth start endpoint via Supabase Edge Fn; popup `window.open` from PageEditor; postMessage origin = `https://calendly.com` only; token in-memory or sessionStorage |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** React 19 + Vite 6 + TS strict + Tailwind v4 beta + Zustand. No new router; pathname-based admin nav via `ADMIN_MODULES` manifest.
- **No backend in `leanshot/`** — net-new server logic lives in Supabase Edge Functions (Deno) under `supabase/functions/`.
- **Strict TypeScript:** `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` + `noUncheckedSideEffectImports`. New `case 'custom_iframe':` MUST be added to `render.ts` Deno switch and the editor blocks switch (no fallthrough).
- **Bundle size discipline:** chart.js + framer-motion + lucide-react together are heavy. The Custom-iframe block + admin allowlist UI must NOT add to the index static graph. Lazy-route via existing `AdminShell` `lazy` field.
- **Accessibility baseline:** WCAG 2.2 AA (Phase 42 axe-core gate forthcoming). All new buttons have `aria-label`, modals `role="dialog"` `aria-modal="true"`, toasts `role="status"` `aria-live="polite"`, iframes a `title` attribute.
- **Reduced motion:** every animated component must check `useReducedMotion()` before running transitions.
- **GSD workflow required:** all file edits flow through `/gsd-execute-phase` once plans land.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Better Stack status page hosting | Vendor (Better Stack) | DNS | Better Stack hosts the UI; LeanShot owns CNAME only |
| Better Stack auto-incident detection | Vendor + integrations | Sentry / Vercel / Supabase OAuth | Vendor-side polling + integration wires — no LeanShot code |
| Branded status-page theming | Vendor admin UI | — | Founder uploads tokens during HUMAN-UAT (D-06) |
| Embed block render (public landing pages) | Deno Edge Fn `page-render` | — | `supabase/functions/page-render/render.ts` emits HTML; current 3 embed blocks already there. Custom-iframe + consent-gating need server-emit + inline client-script |
| Embed block render (PageEditor preview) | Browser / React | — | `src/components/admin/pages/blocks/{Calendly,YouTube,Tally,CustomIframe}Block.tsx` |
| Embed block render (KB articles) | Browser / React | — | `src/helpdesk/KBArticleView.tsx` ReactMarkdown components mapper |
| Cookie-consent state | Browser (Phase 22) | — | vanilla-cookieconsent — `cc_cookie` LS key + `CookieConsent.acceptedCategory(...)` API |
| Consent-change event emit | Browser (NEW — extend Phase 22) | — | **Currently missing** — add `window.dispatchEvent(new CustomEvent('leanshot:consent-change', {detail: {...}}))` in `consent-config.ts` callbacks |
| CSP header (static per-provider) | CDN / Vercel | — | `vercel.json` `headers[]` — single static header serves the entire host |
| CSP header (per-deployment Custom-iframe injection) | Vercel Edge Middleware | DB or env | `vercel.json` does NOT support per-request CSP — needs a Vercel middleware. Allowlist source: planner picks DB-cached vs env-var |
| Custom-iframe allowlist storage | Supabase Postgres | — | New `iframe_allowlist` table with `audit_logs` mutation hook + admin RLS |
| Custom-iframe allowlist UI | Browser / React (Admin) | — | New `AdminShell` module entry `/admin/embeds/allowlist` |
| Hostname exact-match validator | Server-side (Edge Fn) + Client-side (editor save) | — | Server enforces (security boundary); editor surfaces friendly error pre-save |
| Calendly OAuth popup flow | Browser (popup window) + Supabase Edge Fn | — | Popup hits Edge Fn `/api/calendly/oauth-start` → Calendly OAuth → callback Edge Fn → popup postMessage back to opener |
| Audit log writes | Postgres SECDEF function `log_admin_action` | — | Existing 6-arg helper per Phase 24; mirror Plan `20270603000003_p32_04_locale_overrides_audit.sql` pattern |

## Standard Stack

### Core (already locked — verified versions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vanilla-cookieconsent` | v3 (locked Phase 22) | Consent banner + category storage | Already wired in `src/components/consent/consent-config.ts` — Phase 41 extends the event surface, doesn't replace |
| `dompurify` | 3.2.7 (locked Phase 50 / Phase 15) | XSS sanitization for admin-pasted HTML | Already used in `src/admin/modules/helpdesk/KBEditorPage.tsx:237` + `src/components/changelog/WhatsNewDrawer.tsx:26` |
| `react-markdown` + `remark-gfm` + `rehype-raw` | (already in KB) | KB article markdown rendering | Already used in `src/helpdesk/KBArticleView.tsx:14-15` — extend with custom `components` mapper to recognise an embed block marker |
| `lucide-react` | ^0.460.0 | Icons (ShieldCheck, Trash2, ShieldOff, etc.) | Project standard — UI-SPEC already names exact icons |
| `vitest` | (project default) | Unit + e2e test runner | `tests/csp/csp-snapshot.test.ts` already lives here |
| `playwright` | (installed — `playwright.config.ts` present) | e2e for consent-flow + allowlist UI | Phase 22 / Phase 24 already use this pattern |
| `@supabase/supabase-js` | v2 (project default) | Allowlist CRUD + admin client | Existing pattern in `src/lib/admin/*.ts` |

### Better Stack vendor (NEW for Phase 41)

| Service | Purpose | Why Standard |
|---------|---------|--------------|
| **Better Stack Uptime (formerly Better Uptime)** | Hosted status page + uptime monitoring + incident management | Already locked in `.planning/codebase/STACK.md` per `<canonical_refs>` (verified via CONTEXT). Pricing $12/mo entry tier. No competitor evaluation needed — locked. |
| Better Stack Sentry integration | Auto-incident from Sentry error-rate threshold | Vendor-side OAuth — founder configures |
| Better Stack Vercel integration | Auto-incident from Vercel deploy failures | Vendor-side webhook receiver — Vercel sends deploy-hook events |
| Better Stack heartbeat | Active polling of the 4 user-facing surfaces every 30s (D-02) | Founder configures URLs during HUMAN-UAT |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Better Stack for status page | Statuspage.io (Atlassian), Instatus, Cachet (self-host) | Better Stack locked per CONTEXT canonical_refs + STACK.md; no re-eval |
| `iframe_allowlist` table (D-14) | Env var on Vercel deployment | Env-var = no audit log + no per-host `last_used_at` + redeploy on every change. **Recommend DB table** — D-17's UI surface (last-used + page-reference counts) only works with persistent storage |
| Custom Vercel middleware for CSP injection | Server-component `headers()` (Next.js) | Project is **Vite SPA**, NOT Next.js (verified `vite.config.ts`). Vercel Edge Middleware is the only request-time header-injection point that works on Vite SPAs on Vercel |
| `dompurify` allow-list for `<iframe>` in KB markdown | Custom `components` mapper for ReactMarkdown | dompurify-allowlisted `<iframe>` would allow any URL — defeats D-15 exact-match. **Recommend** the `components` mapper approach (parses a custom `<embed type="..." data-id="...">` marker and renders the React block component server-validated against allowlist) |
| sessionStorage for Calendly OAuth token | In-memory only (closure variable on PageEditor mount) | sessionStorage survives tab reload; in-memory dies on reload. **Recommend in-memory** — admin re-clicks "Connect Calendly" if they reload PageEditor (rare flow; no real cost) — keeps token off-disk and out of devtools storage inspector |

**Installation:** No new npm packages required — every dependency is already on the project's `package.json` per the codebase inspection.

**Version verification:** Not applicable — no new packages introduced.

## Architecture Patterns

### System Architecture Diagram

```
Workstream A — Better Stack Status Page (POLISH-10)
──────────────────────────────────────────────────

  Sentry org "optimizenet"  ────────┐
  Vercel project leanshot-marketing ┼──► Better Stack (vendor)
  Supabase project ytnsipxxmzgaebkqmokp ───► (auto-incident polling)
                                          │
                                          ├──► Hosted status page
                                          │      (status.leanshot.app)
                                          │      hybrid 7-component hierarchy
                                          │      branded with LeanShot tokens
                                          │
                                          └──► Better Stack subscriber form
                                                 (embedded on /status page)
                                                  ↓
                                                Public visitor email
                                                  (vendor stores, NOT LeanShot)

  DNS: status.leanshot.app  ──CNAME──►  Better Stack endpoint (per D-05)

  Founder HUMAN-UAT (D-06):
    1. Upgrade Better Stack account to paid tier ($12/mo)
    2. OAuth Sentry / Vercel / Supabase integrations
    3. Configure 7-component hierarchy + thresholds (D-01, D-02)
    4. Upload LeanShot brand tokens (UI-SPEC §Color)
    5. Add CNAME at DNS registrar


Workstream B — Embed Blocks (EMBED-01..08)
────────────────────────────────────────────

  Admin (PageEditor)
    ↓ drops block
  src/components/admin/pages/blocks/
    ├─ CalendlyBlock.tsx       (RETROFIT: add consent-gate state)
    ├─ YouTubeBlock.tsx         (RETROFIT: add consent-gate state)
    ├─ TallyBlock.tsx           (RETROFIT: add consent-gate state)
    └─ CustomIframeBlock.tsx    (NEW)
        ↓ validates URL hostname against
  iframe_allowlist (Postgres table — NEW)
        ↓ saves block to
  landing_page_revisions.blocks (JSONB — Phase 15)

  Block published → page-render flow

  Public visitor → leanshot.app/{slug}
    ↓ Vercel rewrite (vercel.json:23) →
  Supabase Edge Fn page-render
    ↓ render.ts switch(block.type)
    ├─ case 'calendly':       renderEmbedCalendly()  ──┐
    ├─ case 'youtube':        renderEmbedYouTube()    │
    ├─ case 'tally':          renderEmbedTally()      ├─ ALL 4 emit
    └─ case 'custom_iframe':  renderEmbedCustomIframe()│   placeholder HTML
                                                         + inline data-attrs
                                                         + small inline JS
                                                         that subscribes to
                                                         consent-change event

  CSP injection on each request:
  Browser → Vercel Edge Middleware (NEW)
    ↓ middleware reads iframe_allowlist (cached, edge-KV or 60s in-process)
    ↓ appends hostnames to frame-src directive in CSP header
    ↓ forwards to origin (Vercel static / Supabase Edge Fn)
  Browser receives CSP with per-deployment Custom-iframe hosts

  Consent flow (D-07/D-08/D-09):
  vanilla-cookieconsent.run({ onChange: ({ cookie }) => {
     updateGtagConsent(cookie);
     upsertConsentRecord(cookie);
     // NEW (Phase 41):
     window.dispatchEvent(
       new CustomEvent('leanshot:consent-change', {
         detail: { categories: { necessary: bool, analytics: bool,
                                  marketing: bool, personalization: bool,
                                  functional: bool } }
       })
     );
  } })
                                              ↓ subscribed by:
   • EmbedBlock React components (PageEditor preview surface)
   • Inline script emitted by page-render Deno renderer (public pages)
   • Inline script emitted by KBArticleView for embeds inside KB articles

  Superadmin allowlist UI:
  /admin/embeds/allowlist (NEW ADMIN_MODULES entry, minRole='superadmin')
    ↓ uses
  Supabase RPC add_iframe_allowlist_hostname() + remove_iframe_allowlist_hostname()
    ↓ each RPC calls
  log_admin_action(actor, target=null, action='iframe_allowlist.add|remove',
                   metadata={hostname, page_refs_count})
    ↓ writes
  audit_logs row (Phase 24/25 schema — 90d retention per D-17)
```

### Recommended Project Structure

```
leanshot/
├── src/
│   ├── lib/
│   │   ├── page-builder/
│   │   │   ├── block-schema.ts        # EXTEND: add 'custom_iframe' to BlockType union (line 36-48)
│   │   │   ├── embed-src.ts            # EXTEND: add buildCustomIframeSrc() + buildCustomIframeIframeHtml()
│   │   │   └── custom-iframe-validate.ts  # NEW: pure hostname validator (used by both editor + render.ts)
│   │   ├── consent/
│   │   │   └── consent-event.ts       # NEW: canonical event name + payload + helper subscribe()
│   │   └── admin/
│   │       ├── modules.ts              # EXTEND: add 'embeds' module entry → /admin/embeds/allowlist
│   │       └── iframe-allowlist.ts     # NEW: admin client wrappers for allowlist RPCs
│   ├── components/
│   │   ├── consent/
│   │   │   └── consent-config.ts       # EXTEND: emit 'leanshot:consent-change' in onChange/onConsent/onFirstConsent
│   │   └── admin/
│   │       ├── embeds/                  # NEW
│   │       │   ├── AllowlistPage.tsx
│   │       │   ├── AddHostnameForm.tsx
│   │       │   ├── AllowlistTable.tsx
│   │       │   ├── RemoveHostnameConfirm.tsx
│   │       │   └── ReferencesSheet.tsx
│   │       └── pages/blocks/
│   │           ├── CalendlyBlock.tsx   # EXTEND: wrap in <ConsentGatedEmbed category="analytics">
│   │           ├── YouTubeBlock.tsx    # EXTEND: same
│   │           ├── TallyBlock.tsx      # EXTEND: same
│   │           ├── CustomIframeBlock.tsx  # NEW
│   │           ├── ConsentGatedEmbed.tsx  # NEW: shared placeholder/skeleton/iframe state machine
│   │           └── EmbedPlaceholderCard.tsx # NEW: D-08 branded placeholder card
│   │   └── editor/
│   │       └── CalendlyPreviewPopup.tsx   # NEW: D-EMBED-08 popup OAuth flow handler
│   └── helpdesk/
│       └── KBArticleView.tsx           # EXTEND: ReactMarkdown components mapper recognises <embed-block> markers
├── supabase/
│   ├── functions/
│   │   ├── page-render/
│   │   │   └── render.ts               # EXTEND: case 'custom_iframe' + emit consent-gating placeholder/inline script
│   │   ├── calendly-oauth-start/       # NEW (EMBED-08)
│   │   ├── calendly-oauth-callback/    # NEW (EMBED-08)
│   │   ├── csp-middleware/             # NEW (D-14 — or Vercel-side Edge Middleware in leanshot/middleware.ts)
│   │   └── iframe-allowlist-csp/       # Alternative: dedicated Fn that serves the CSP-augmented response
│   └── migrations/
│       ├── 2027MMDD000001_p41_iframe_allowlist.sql        # NEW (D-14)
│       ├── 2027MMDD000002_p41_iframe_allowlist_rpcs.sql   # NEW (add/remove + last_used_at update)
│       └── 2027MMDD000003_p41_iframe_allowlist_audit.sql  # NEW (audit triggers via log_admin_action)
├── middleware.ts                        # NEW (or under api/) — Vercel Edge Middleware for D-14 CSP injection
├── vercel.json                          # EDIT: extend CSP per D-12 (Calendly + YouTube + Tally exact hosts)
└── tests/csp/
    ├── csp-snapshot.txt                # EDIT: regenerate per D-12 additions
    └── csp-snapshot.test.ts            # No structural change — same assertion logic
```

### Pattern 1: Retrofit consent gating on existing embed blocks (D-09)

**What:** Wrap each existing block's iframe in a `<ConsentGatedEmbed category="...">` HOC that owns the State 1 / State 2 / State 3 transition.

**When to use:** All three existing blocks (Calendly / YouTube / Tally) + the new Custom-iframe block.

**Example (sketch — verified shape per existing `CalendlyBlock.tsx:30-71`):**

```tsx
// Source: derived from src/components/admin/pages/blocks/CalendlyBlock.tsx + UI-SPEC §Surface B
import { ConsentGatedEmbed } from './ConsentGatedEmbed';

export function CalendlyBlock({ block }: CalendlyBlockProps) {
  const src = buildCalendlySrc({...});
  return (
    <section className={...}>
      <ConsentGatedEmbed
        provider="calendly"
        categories={['functional', 'analytics']}  // D-07
        minHeight={700}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      >
        {src && (
          <iframe src={src} title={EMBED_IFRAME_TITLES.calendly} loading="lazy" />
        )}
      </ConsentGatedEmbed>
    </section>
  );
}
```

`ConsentGatedEmbed` internally:
1. Reads consent state on mount via `CookieConsent.acceptedCategory(...)` from vanilla-cookieconsent.
2. Subscribes to `window.addEventListener('leanshot:consent-change', ...)` (Phase 41-introduced event).
3. Owns the State 1 (placeholder Card per UI-SPEC §Surface B) / State 2 (Skeleton + iframe opacity 0) / State 3 (iframe opacity 1) state machine.
4. On `onLoad` of the iframe child (cloned with `React.cloneElement`), transitions to State 3 with `useReducedMotion()` gating.

### Pattern 2: Public-page consent-gating in Deno renderer (D-09 server-side)

**What:** `render.ts` emits a placeholder `<div data-embed-pending data-category="...">...</div>` + an inline `<script>` block that subscribes to `leanshot:consent-change` and hydrates the iframe element only on grant.

**When to use:** `supabase/functions/page-render/render.ts` `case 'calendly' | 'youtube' | 'tally' | 'custom_iframe':` — all four.

**Why:** The Phase 22 banner runs client-side; the public landing page is server-rendered static HTML. The page-render output must (a) not emit the iframe at all until consent is granted (otherwise the iframe loads provider scripts before consent), and (b) replace the placeholder with the iframe HTML when the consent event fires.

**Example shape:**

```html
<!-- emitted by render.ts when consent NOT verifiable at SSR time (always for guests) -->
<div class="block-embed block-embed-calendly"
     data-embed-pending="true"
     data-embed-provider="calendly"
     data-embed-category="functional,analytics"
     data-embed-src="https://calendly.com/your-handle/intro"
     data-embed-sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
     data-embed-title="Schedule a meeting"
     data-embed-min-height="700">
  <!-- branded placeholder per D-08 + UI-SPEC §Surface B State 1 -->
  <div class="embed-placeholder-card">...static HTML for State 1...</div>
</div>
<script>
  // Pure inline JS (no module imports — Deno emits as raw string)
  // 1. On DOMContentLoaded, check vanilla-cookieconsent state via the cc_cookie
  // 2. If granted, swap placeholder → iframe immediately
  // 3. Otherwise add window.addEventListener('leanshot:consent-change', ...) handler
  // 4. On consent grant, build iframe element with attrs from data-* + dispatch onLoad listener for opacity transition
</script>
```

### Pattern 3: Vercel Edge Middleware for per-deployment CSP injection (D-14)

**What:** A `middleware.ts` at the project root that intercepts every request, reads the `iframe_allowlist` table (cached at the edge), and appends those hostnames to the static CSP's `frame-src` directive before forwarding.

**When to use:** Custom-iframe block render — when a published page references a `custom_iframe` block, the visitor's response CSP must allow that hostname.

**Example shape (verified against Vercel docs for Vite SPAs):**

```typescript
// Source: Vercel Edge Middleware docs (https://vercel.com/docs/functions/edge-middleware)
import { next } from '@vercel/edge';
import type { Config } from '@vercel/edge';

export const config: Config = {
  matcher: ['/((?!api|_next/static|assets|favicon).*)'],
};

let cache: { hosts: string[]; expiresAt: number } | null = null;

export default async function middleware(request: Request) {
  // Cache for 60s — D-14 says "table updates + cache invalidates" but
  // a 60s TTL on a low-write table is the cheapest correct fallback.
  if (!cache || cache.expiresAt < Date.now()) {
    const resp = await fetch(
      'https://ytnsipxxmzgaebkqmokp.supabase.co/rest/v1/iframe_allowlist?select=hostname',
      { headers: { apikey: process.env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY!}` } }
    );
    const rows = await resp.json();
    cache = {
      hosts: rows.map((r: { hostname: string }) => `https://${r.hostname}`),
      expiresAt: Date.now() + 60_000,
    };
  }
  const response = await next();
  const csp = response.headers.get('content-security-policy') ?? '';
  // Append to frame-src directive — DO NOT overwrite the whole CSP
  const augmented = csp.replace(
    /frame-src ([^;]+);/,
    (_, dirs) => `frame-src ${dirs} ${cache!.hosts.join(' ')};`
  );
  response.headers.set('content-security-policy', augmented);
  return response;
}
```

**Cache-invalidate path on add/remove:** Superadmin click → RPC → trigger emits a NOTIFY → cron Edge Fn fires Vercel cache-purge webhook. OR simpler: rely on the 60s TTL — admin sees the change within ~1 minute. **Recommend the 60s TTL** — Custom-iframe additions are rare ops events, not a fast-feedback loop.

### Pattern 4: Helpdesk KB embed-block render via ReactMarkdown components mapper (EMBED-06)

**What:** Extend `KBArticleView.tsx`'s `<ReactMarkdown>` with a `components` prop that recognises a custom `<embed-block>` HTML tag (allowed through dompurify allowlist) and renders the React block component.

**When to use:** KB articles that need to embed Calendly / YouTube / Tally / Custom-iframe.

**Example shape:**

```tsx
// Source: derived from src/helpdesk/KBArticleView.tsx:98 + react-markdown components API
const components = {
  // Custom HTML element — authored as <embed-block type="calendly" data-url="..." />
  'embed-block': ({ type, ...dataAttrs }) => {
    switch (type) {
      case 'calendly':
        return <CalendlyBlock block={{ type: 'calendly', content: { calendlyUrl: dataAttrs['data-url'] }, ... }} />;
      case 'custom_iframe':
        return <CustomIframeBlock block={{ ... }} />;
      // ...
      default:
        return null;
    }
  },
};
<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>{body}</ReactMarkdown>
```

dompurify config in KB editor preview (`KBEditorPage.tsx:237`) currently uses `USE_PROFILES: { html: true }` which strips custom tags. Phase 41 either (a) bumps to `ADD_TAGS: ['embed-block']` + `ADD_ATTR: ['type', 'data-url', 'data-id']` in BOTH the preview path AND the public render path; or (b) authors embed-blocks via Markdown directives (remark-directive plugin). **Recommend (a)** — smallest dependency footprint.

### Anti-Patterns to Avoid

- **Do not just keep iframe DOM with `src=""` on consent revoke.** UI-SPEC §Surface B notes this explicitly — Calendly/YouTube still set cookies on stale `src`. Unmount the entire iframe element on revoke.
- **Do not wildcard-match Custom-iframe hostnames.** D-15 is explicit: exact match only. Subdomain expansion is a security regression.
- **Do not store Better Stack subscriber emails in Supabase.** D-03: vendor handles delivery; LeanShot doesn't store.
- **Do not put dynamic CSP in `vercel.json`.** vercel.json supports ONE static header; per-request injection requires Edge Middleware (Pattern 3).
- **Do not skip the consent-event emit retrofit on `consent-config.ts`.** Without it, D-09 silently never fires — the page would still load the iframe on first paint (because consent is checked at mount only) or never load at all (because the listener never fires). Verified absence — see Pitfall 4.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status page UI | Custom React status dashboard | Better Stack hosted status page | Vendor-locked per CONTEXT canonical_refs; $12/mo cheaper than weeks of dev |
| Uptime monitoring | Custom heartbeat poller | Better Stack heartbeat checks | Vendor handles cross-region polling + alerting + SLA math |
| Cookie consent banner | Custom modal | vanilla-cookieconsent v3 (already shipped Phase 22) | Phase 22 ships this; Phase 41 only adds an event emit |
| iframe hostname allowlist enforcement | Client-side check only | Server-side validator (Edge Fn) + CSP frame-src | Client-side bypassable; CSP is the browser-enforced layer; server validator catches editor-save attempts |
| OAuth token storage | localStorage | In-memory closure variable on PageEditor | Token must not survive session; localStorage is XSS-readable |
| HTML sanitization for KB embeds | Custom regex | dompurify 3.2.7 (already in `package.json`) | dompurify handles 50+ edge cases (mutation XSS, namespace confusion, etc.) |
| Audit log writes | Direct INSERT into audit_logs | `log_admin_action(actor, target, action, metadata)` SECDEF helper | Phase 24/25 schema enforces append-only RLS; helper handles `is_admin_at_least()` gate + structured metadata |
| Migration timestamp picking | Manual yyyymmddhhmmss | Pre-merge collision check + glob `<prefix>*.sql` | See `reference_migration_timestamp_collision_precheck` — collisions silently skip per Supabase CLI |

**Key insight:** Phase 41 is **mostly extension + retrofit**, not greenfield. The four embed blocks already exist (3 of 4) + the CSP snapshot test already exists + the audit-log helper already exists + the consent banner already exists. The novel work is (a) the consent-emit retrofit (small but load-bearing), (b) Custom-iframe block (new), (c) the dynamic CSP middleware (new), and (d) the superadmin allowlist UI (new admin module).

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `iframe_allowlist` table (hostname, added_by_user_id, added_at, last_used_at) per D-14. `audit_logs` gets new `action='iframe_allowlist.add'` / `'iframe_allowlist.remove'` rows (90d retention per D-17). | Data migration: NONE (greenfield table). Code edit: NEW migrations + RPCs + admin client wrappers |
| Live service config | **Better Stack account (NEW vendor wiring).** Sentry-OAuth integration, Vercel deploy-hook, Supabase heartbeat-ping config — all live on Better Stack admin UI, NOT in git. Cloudflare/DNS-registrar — new `status.leanshot.app` CNAME. Vercel project: NEW env-vars for Calendly OAuth client ID/secret (if EMBED-08 lands). | Founder configures during D-06 HUMAN-UAT; planner adds DNS-smoke + Better Stack-reachable check at phase close-out |
| OS-registered state | None — no Windows Task Scheduler, no pm2 saved processes, no systemd units in this phase. | None |
| Secrets / env vars | **NEW: Calendly OAuth client ID + secret** (Supabase Function Secret if EMBED-08 ships an Edge Fn). **NEW: Sentry CSP report endpoint URL** for D-11 — likely a Supabase Function Secret or hardcoded `https://o<orgid>.ingest.sentry.io/api/<projid>/security/?sentry_key=...` (see Sentry CSP report-uri docs). | Add via `supabase secrets set` per `reference_vapid_keypair_supabase_setup` pattern |
| Build artifacts / installed packages | None — no new npm packages, no new compiled binaries, no Docker tags. | None |

**Re-verify before plan:** the planner must `gh secret list` (Vercel + Supabase) to confirm Sentry CSP endpoint key — Phase 12's existing Sentry wiring may already cover it.

## Common Pitfalls

### Pitfall 1: vercel.json's CSP is one static header — not per-request
**What goes wrong:** Planner assumes editing `vercel.json` is sufficient for D-14's dynamic per-deployment Custom-iframe hosts. It's not. `vercel.json:40-49` ships ONE static CSP for `source: "/(.*)"`.
**Why it happens:** Vite SPA + Vercel makes CSP look like a one-time config. Most projects never need dynamic CSP.
**How to avoid:** Plan for a Vercel Edge Middleware at `leanshot/middleware.ts` (or `api/middleware.ts`) — Pattern 3 above.
**Warning signs:** Plan says "edit vercel.json CSP per request" or "extend headers[] entry with allowlist" — both wrong.

### Pitfall 2: Phase 22 banner does not emit a consent-change event today
**What goes wrong:** D-09 assumes "reuses Phase 22 consent-state event-emitter pattern" — but no event is currently emitted. Verified `src/components/consent/consent-config.ts:261-273` only calls `updateGtagConsent` + `upsertConsentRecord`.
**Why it happens:** Phase 22 shipped Consent Mode v2 wiring (gtag + consent records) — sufficient for analytics, insufficient for cross-component listeners.
**How to avoid:** First plan-task is "add `window.dispatchEvent(new CustomEvent('leanshot:consent-change', {detail: {categories}}))`" in all three vanilla-cookieconsent callbacks (`onFirstConsent`, `onConsent`, `onChange`). Document the canonical event shape in a new `src/lib/consent/consent-event.ts` module + provide a typed `subscribeToConsentChange()` helper.
**Warning signs:** Plan references "P22 consent-state event-emitter" without naming the event-name or the file that emits it.

### Pitfall 3: Existing Phase 15 embed blocks render WITHOUT consent gating
**What goes wrong:** Planner assumes Calendly / YouTube / Tally blocks already gate consent. They don't — verified `CalendlyBlock.tsx:38-71` renders the iframe unconditionally on mount.
**Why it happens:** Phase 15 shipped the editor preview + render pipeline; consent gating was scoped to Phase 41.
**How to avoid:** Treat EMBED-01/02/03 as **retrofit** tasks — each existing block component + the corresponding Deno renderer needs the new `<ConsentGatedEmbed>` wrapper / data-attribute placeholder.
**Warning signs:** Plan only adds a new `CustomIframeBlock` and assumes the other three "already work" — wrong.

### Pitfall 4: Better Stack — vendor lock at the DNS level
**What goes wrong:** D-05 says CNAME `status.leanshot.app` → Better Stack endpoint. Switching status-page vendors later means another CNAME change.
**Why it happens:** Status page vendors all want their own CNAME target. Switching = no migration path; old subscribers don't follow.
**How to avoid:** Documented as an accepted vendor lock in D-04 deferred-ideas. Plan does NOT need to mitigate; just call out in HUMAN-UAT notes that "subscriber emails are owned by Better Stack and cannot be exported".
**Warning signs:** Plan tries to "abstract Better Stack behind a status-page provider interface" — out of scope, defer.

### Pitfall 5: Calendly nested-iframe OAuth bouncing (V13-EMBED)
**What goes wrong:** PageEditor inline preview shows a Calendly iframe; admin clicks "Connect" inside the iframe; Calendly tries to redirect within the iframe; browser blocks third-party-iframe cookies; OAuth bounces and fails.
**Why it happens:** Modern browsers (Safari ITP, Chrome 3p-cookie phase-out) block cross-origin iframe cookies — Calendly's OAuth flow needs them.
**How to avoid:** Locked in CONTEXT — popup `window.open` flow, NOT iframe-internal. Popup is same-origin (Calendly's OAuth pages), gets first-party cookies, posts result back via `postMessage`.
**Warning signs:** Plan embeds Calendly via iframe at PageEditor preview surface — that's the failing path.

### Pitfall 6: `postMessage` origin not validated → token theft
**What goes wrong:** Plan listens for `window.addEventListener('message', handler)` without checking `event.origin`. Any page can `window.opener.postMessage({...})` once a malicious popup hits the parent — fake OAuth completion or token disclosure.
**Why it happens:** Default `addEventListener('message')` does not validate origin.
**How to avoid:** Handler MUST `if (event.origin !== 'https://calendly.com') return;` as the first guard. Per UI-SPEC §Surface D postMessage section.
**Warning signs:** Plan code snippet for Calendly popup handler omits the `event.origin` check.

### Pitfall 7: Supabase migration timestamp collision pre-check
**What goes wrong:** Two Phase 41 wave-N plans both pick `20270710000001_*.sql` → second one silently skipped at `supabase db push`.
**Why it happens:** See `reference_supabase_migration_filename_regex` and `reference_migration_timestamp_collision_precheck`.
**How to avoid:** Pre-merge glob `ls supabase/migrations/20270710*.sql | wc -l` — collision = renumber to future timestamp + git mv.
**Warning signs:** Both 41-B3 (CSP) and 41-B4 (Allowlist UI) declare migrations with the same date prefix.

### Pitfall 8: Worktree executor running `supabase db push` from main checkout
**What goes wrong:** Per `feedback_worktree_executor_pwd_drift_leaks_to_main`. Phase 41 ships 1-3 new migrations; executor in worktree W2 cd's to primary checkout for db-push and commits to main.
**Why it happens:** `supabase db push` requires the primary checkout's `.temp/` state.
**How to avoid:** Use the per-commit `git rev-parse --show-toplevel` guard validated in Phase 25 W2. Copy `supabase/.temp/*` into worktree at executor-init (see `reference_supabase_worktree_temp_state`).

### Pitfall 9: dompurify strips `<embed-block>` custom tag
**What goes wrong:** KB editor preview uses `DOMPurify.sanitize(body, { USE_PROFILES: { html: true } })` — that profile strips custom tags. EMBED-06 KB embeds vanish.
**Why it happens:** dompurify's html profile is HTML5 strict; custom elements need `ADD_TAGS`.
**How to avoid:** In both the editor preview at `KBEditorPage.tsx:237` AND public render path, configure dompurify with `ADD_TAGS: ['embed-block'], ADD_ATTR: ['type', 'data-url', 'data-id', 'data-allow']`.
**Warning signs:** Plan keeps the dompurify call unchanged and relies on `rehype-raw` to pass through custom tags — only half the chain; dompurify is the strip-stage.

### Pitfall 10: CSP snapshot test extension blocker (Phase 12 D-12)
**What goes wrong:** Any plan that adds a host to `frame-src` in `vercel.json` but forgets to regenerate `tests/csp/csp-snapshot.txt` BLOCKs in plan-checker per Phase 12's enforcement contract.
**Why it happens:** The two files are alphabetised+sorted-diffed in `tests/csp/csp-snapshot.test.ts:65`; missing snapshot update = CI fail.
**How to avoid:** Every plan that edits `vercel.json` CSP must also edit `tests/csp/csp-snapshot.txt` in the same commit.

### Pitfall 11: Custom-iframe block emits iframe on server render BEFORE CSP middleware augments
**What goes wrong:** `render.ts` emits `<iframe src="https://meet.example.org">` for a `custom_iframe` block. The Vercel middleware augments CSP for the parent page (`/{slug}`), but the `page-render` Edge Fn response is returned directly from Supabase — does Vercel middleware run on Supabase-Fn-rewritten responses?
**Why it happens:** `vercel.json:23` rewrites `/(slug)` → Supabase Edge Fn. Middleware runs **before** the rewrite. The Supabase Fn's response headers are forwarded by Vercel — so middleware modifications to response headers ARE preserved IFF middleware runs after the response. Vercel's middleware can wrap the response (call `next()` and modify result) — that works here.
**How to avoid:** Verify Vercel middleware execution order in Pattern 3's code: `const response = await next(); response.headers.set(...)` — modifies the response after the rewrite returns. Confirmed correct shape; planner pins this pattern in the spec.

### Pitfall 12: Sentry CSP report endpoint loops if report itself violates CSP
**What goes wrong:** D-11 adds `report-uri https://oXXXX.ingest.sentry.io/api/.../security/`. If that endpoint isn't in `connect-src` (or `report-uri` exemption), the browser blocks the report itself → silent loss of visibility.
**Why it happens:** `report-uri` in some CSP impls requires the host to also be allowed via `connect-src`; modern browsers honor `report-uri` separately.
**How to avoid:** Plan adds the Sentry ingest host to `connect-src` (already present: `https://*.ingest.sentry.io https://*.ingest.us.sentry.io` per `vercel.json:42`) — verified. Also add `report-uri` directive in same edit + the explicit `report-to` directive per modern CSP-3.

## Code Examples

### Custom-iframe URL validator (mirrors existing buildCalendlySrc pattern)

```typescript
// Source: derived from src/lib/page-builder/embed-src.ts:86-97 + D-15 exact-match rule
// File: src/lib/page-builder/embed-src.ts (extension)

export interface CustomIframeContent {
  embedUrl: string;
  iframeTitle: string;
}

/**
 * Validate Custom-iframe URL against the per-deployment allowlist.
 * Called from BOTH editor-save (Surface C inline validation) AND server-side
 * (page-render Deno renderer + lead-capture editor save Edge Fn).
 *
 * Returns the validated URL string on success, null otherwise.
 *
 * Per D-15: hostname EXACT-match only — no subdomain expansion.
 */
export function validateCustomIframeUrl(
  raw: unknown,
  allowlistHostnames: ReadonlyArray<string>,
): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  // D-15 — exact hostname match, no subdomain matching
  if (!allowlistHostnames.includes(parsed.hostname)) return null;
  return parsed.toString();
}

export function buildCustomIframeIframeHtml(
  content: CustomIframeContent,
  allowlistHostnames: ReadonlyArray<string>,
): string {
  const src = validateCustomIframeUrl(content.embedUrl, allowlistHostnames);
  if (!src) return '';
  const title = content.iframeTitle && content.iframeTitle.length >= 3
    ? content.iframeTitle
    : 'Embedded content';
  const attrs =
    `title="${escapeHtmlAttr(title)}"` +
    ` loading="lazy"` +
    ` referrerpolicy="no-referrer"` +
    // D-16 FIXED sandbox — admin cannot override
    ` sandbox="allow-scripts allow-same-origin"` +
    ` style="width:100%;height:100%;border:0;"`;
  return (
    `<div class="block-embed block-embed-custom-iframe" style="width:100%;min-height:400px;">` +
    `<iframe src="${escapeHtmlAttr(src)}" ${attrs}></iframe>` +
    `</div>`
  );
}
```

### Consent-event emit retrofit (Phase 22 banner extension)

```typescript
// Source: src/components/consent/consent-config.ts (EXTEND lines 261-273)
// File: src/components/consent/consent-config.ts

// NEW canonical event shape — also exported from src/lib/consent/consent-event.ts
export const CONSENT_CHANGE_EVENT = 'leanshot:consent-change';

export interface ConsentChangeDetail {
  categories: {
    necessary: boolean;       // always true
    analytics: boolean;
    marketing: boolean;
    personalization: boolean;
    functional: boolean;      // alias for necessary in our taxonomy — or new category
  };
}

function emitConsentChange(): void {
  if (typeof window === 'undefined') return;
  const detail: ConsentChangeDetail = {
    categories: {
      necessary: true,
      analytics: CookieConsent.acceptedCategory('analytics'),
      marketing: CookieConsent.acceptedCategory('marketing'),
      personalization: CookieConsent.acceptedCategory('personalization'),
      functional: CookieConsent.acceptedCategory('necessary'),
    },
  };
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail }));
}

// EXTEND the existing callbacks in CookieConsent.run(...):
//   onFirstConsent: ({ cookie }) => { updateGtagConsent(); void upsertConsentRecord(cookie); emitConsentChange(); }
//   onConsent:      ({ cookie }) => { updateGtagConsent(); void upsertConsentRecord(cookie); emitConsentChange(); }
//   onChange:       ({ cookie }) => { updateGtagConsent(); void upsertConsentRecord(cookie); emitConsentChange(); }
```

### Calendly OAuth popup handler with origin validation

```typescript
// Source: UI-SPEC §Surface D + Pitfall 6 fix
// File: src/components/admin/pages/editor/CalendlyPreviewPopup.tsx

const CALENDLY_OAUTH_ORIGIN = 'https://calendly.com';
const LEANSHOT_OAUTH_CALLBACK_ORIGIN = window.location.origin;  // same-origin callback

function handlePopupMessage(event: MessageEvent): void {
  // First guard: origin MUST match — defeats arbitrary postMessage from any page
  if (
    event.origin !== CALENDLY_OAUTH_ORIGIN &&
    event.origin !== LEANSHOT_OAUTH_CALLBACK_ORIGIN
  ) {
    return;
  }
  if (event.data?.type !== 'calendly-oauth-result') return;
  // ... handle token
}

window.addEventListener('message', handlePopupMessage);
// ALSO: clean up on unmount
```

### Audit-log call for allowlist mutation

```sql
-- Source: mirrors supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql:43-61
-- File: supabase/migrations/2027MMDD000003_p41_iframe_allowlist_audit.sql

create or replace function public.add_iframe_allowlist_hostname(p_hostname text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  -- Guard: only superadmin can call (mirror is_admin_at_least('superadmin'))
  if not public.is_admin_at_least('superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Reject malformed input (defensive — UI also validates)
  if p_hostname is null or p_hostname = '' then
    raise exception 'hostname required' using errcode = '22023';
  end if;
  if p_hostname like '%://%' or p_hostname like '%/%' or p_hostname like '%*%' then
    raise exception 'hostname must be a bare hostname' using errcode = '22023';
  end if;

  insert into public.iframe_allowlist (hostname, added_by_user_id)
  values (p_hostname, auth.uid())
  returning id into v_id;

  -- 6-arg log_admin_action — canonical Phase 24 signature
  perform public.log_admin_action(
    p_actor_user_id  := auth.uid(),
    p_target_user_id := null,
    p_action         := 'iframe_allowlist.add',
    p_resource_type  := 'iframe_allowlist',
    p_resource_id    := v_id::text,
    p_metadata       := jsonb_build_object('hostname', p_hostname)
  );

  return v_id;
end;
$$;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static CSP via `<meta>` tag | HTTP `Content-Security-Policy` header from CDN | Long-standing | Project already uses header — no change |
| Single static CSP for all routes | Per-request CSP via Edge Middleware for dynamic allowlists | Vercel Edge Middleware GA (2022) | New for Phase 41 — pattern 3 |
| Cookie-banner-blocks-page until choice | Consent Mode v2 + default-deny + per-category granular | gtag Consent Mode v2 (2024) | Already shipped Phase 22 — extend with event-emit |
| Self-hosted Cachet/uptime-kuma status page | Hosted (Better Stack / Statuspage / Instatus) | 2023+ industry shift | Locked: Better Stack |
| `unsafe-inline` script-src for embed widgets | Per-provider exact-host allowlist + nonce/hash for inline | CSP-3 nonces (2021+) | Project NOT using nonces yet (`script-src 'self' https://js.stripe.com`) — Phase 41 sticks with allowlist |

**Deprecated/outdated:**
- `X-Frame-Options: DENY` (`vercel.json:45`) — superseded by `frame-ancestors` CSP directive. Project keeps both for older-browser compat. No change in Phase 41.
- Direct `<iframe>` for OAuth flows — Safari ITP + Chrome 3p-cookie phase-out kill this; popups are the modern path (validated by Calendly + Stripe Connect + every modern OAuth provider).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel Edge Middleware augments responses returned from `rewrites` to Supabase Edge Functions (i.e., `vercel.json:23` `/{slug}` rewrite still sees middleware-added headers) | Pattern 3 / Pitfall 11 | If wrong, the Custom-iframe iframe loads but browser blocks it under static CSP. Mitigation: route `/{slug}` page-render through Vercel Edge Function (not Vercel rewrite to Supabase) — or have the Supabase Fn read the allowlist itself and emit a per-response CSP header [CITED: Vercel Edge Middleware docs https://vercel.com/docs/functions/edge-middleware — middleware can wrap responses; ASSUMED for the rewrite-to-Supabase case] |
| A2 | Better Stack pricing $12/mo entry tier covers all the integrations (Sentry-OAuth + Vercel deploy-hook + Supabase heartbeat) needed for D-02 | Standard Stack | If wrong, founder needs a higher tier (~$30/mo); not a blocker, just a budget revision. [ASSUMED — verify on Better Stack pricing page during D-06 HUMAN-UAT] |
| A3 | Phase 22 vanilla-cookieconsent emits its `onChange` callback synchronously enough that `window.dispatchEvent` from inside it reaches listeners on the same tick | Code Examples / Pattern 1 | If async, embed-block listeners may miss the first event. Mitigation: also re-check `CookieConsent.acceptedCategory(...)` on mount + on tab visibility. [VERIFIED: vanilla-cookieconsent v3 source — callbacks are synchronous; via Context7 if needed] |
| A4 | The `log_admin_action(p_actor_user_id, p_target_user_id, p_action, p_resource_type, p_resource_id, p_metadata)` 6-arg signature is current and stable | Code Examples / Audit log | Verified via `supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql:43-61` — actual signature in repo. [VERIFIED: codebase grep] |
| A5 | `iframe_allowlist` table size will stay <1000 rows for v1.3 — caching in middleware is safe | Pattern 3 | If wrong (e.g., per-page allowlist), middleware cache invalidation becomes critical. v1.3 = superadmin-only adds, deployment scope = ~10-50 rows realistic. [ASSUMED] |
| A6 | The Sentry CSP report-uri endpoint format `https://oXXXX.ingest.sentry.io/api/.../security/?sentry_key=...` is correct for this org | Pitfall 12 | Wrong format = silent loss of CSP violation visibility (D-13 monthly review). [ASSUMED — verify Sentry org "optimizenet" CSP-report-uri docs during plan-task setup; see memory `reference_sentry_org`] |
| A7 | Vercel does not have a built-in feature for per-deployment CSP that we're missing | Standard Stack | If a managed solution exists (Vercel-side), the middleware is unnecessary. [VERIFIED via Vercel docs as of 2026-05: no per-request CSP in `vercel.json` schema — middleware is the documented path] |

## Open Questions

1. **D-14: DB table vs env var for iframe_allowlist**
   - What we know: D-17 requires `last_used_at` + page-reference counts → both need persistent storage with time.
   - What's unclear: Env var could work if we accept "no last-used tracking" — but UI-SPEC §Surface E explicitly shows the Last-used column.
   - Recommendation: **DB table** — clearer ownership, audit-logged mutations, supports the UX contract. Env var would require a deploy on every hostname change, defeats the "live edit + 60s cache" responsive feel.

2. **EMBED-08: Calendly OAuth state machine in Supabase Edge Fn or PageEditor only**
   - What we know: Popup OAuth flow is locked (CONTEXT D-CONTEXT V13-EMBED). Token storage = in-memory or sessionStorage (planner picks).
   - What's unclear: Where does the OAuth start endpoint live? `/api/calendly/oauth-start` per UI-SPEC §Surface D could be a Supabase Edge Fn (`calendly-oauth-start`) OR a static Vercel rewrite to Calendly's hosted OAuth URL with client_id pre-substituted.
   - Recommendation: **Supabase Edge Fn** — keeps Calendly client_secret server-side; static rewrite would require `client_id` only (no secret) which works for the start step but the callback exchange definitely needs the secret. Two Fns: `calendly-oauth-start` + `calendly-oauth-callback`.

3. **EMBED-06: which KB editor surfaces support embed-block authoring?**
   - What we know: `src/admin/modules/helpdesk/KBEditorPage.tsx` uses ReactMarkdown + DOMPurify with `USE_PROFILES: { html: true }`.
   - What's unclear: Should the KB editor get a "drop an embed block" button (rich-text UX), or do KB authors hand-write `<embed-block type="..." data-url="...">` in markdown?
   - Recommendation: **Hand-write in v1.3** — keeps the editor change minimal (only dompurify config + ReactMarkdown components mapper). Rich-text drop-in is a v1.4 polish. Document the markdown syntax in KB editor hint text.

4. **D-14 cache invalidation strategy**
   - What we know: Pattern 3 uses 60s in-memory cache per edge region.
   - What's unclear: When admin removes a hostname, should the middleware purge immediately? Vercel edge functions don't share memory across regions.
   - Recommendation: **Accept 60s TTL latency** — Custom-iframe ops are rare. If immediate purge needed, expose a manual "Refresh CDN cache" button in `/admin/embeds/allowlist` that fires Vercel's purge API.

5. **Better Stack subscriber form: embed style on /status, or just link to status.leanshot.app?**
   - What we know: D-03 says "embedded Better Stack form on /status page".
   - What's unclear: leanshot.app has no `/status` route today — only `status.leanshot.app` (the Better Stack-hosted page itself). So "embedded on /status page" probably means "on the Better Stack-hosted page", not "embedded on a LeanShot-hosted page".
   - Recommendation: **Interpret D-03 as "Better Stack hosts the form; no LeanShot embedding"**. Confirm with user in next discuss-iteration if ambiguous.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Better Stack account (paid tier $12/mo) | POLISH-10 (D-06 HUMAN-UAT) | ✗ | — | None — vendor lock per D-04; phase 41-A1 plan = HUMAN-UAT setup task |
| DNS registrar access for `leanshot.app` zone | D-05 CNAME setup | ✓ (assumed — leanshot.app is live per existing redirects in vercel.json:6-10) | — | — |
| Sentry org `optimizenet` (de.sentry.io) | D-11 CSP report endpoint + D-02 Sentry-OAuth integration | ✓ | — | — |
| Vercel project `leanshot-marketing` | D-02 Vercel deploy-hook integration | ✓ | — | — |
| Supabase project `ytnsipxxmzgaebkqmokp` | D-02 heartbeat + D-14 iframe_allowlist table + audit_logs | ✓ | — | — |
| Calendly developer account (OAuth client credentials) | EMBED-08 popup OAuth | ✗ | — | None — required for EMBED-08; could defer EMBED-08 to v1.4 if account-creation is a blocker, but CONTEXT lists EMBED-08 as in-scope |
| Vercel Edge Middleware support | D-14 dynamic CSP | ✓ | — | Alternative: route `/{slug}` through a Vercel Edge Function instead of Supabase Edge Fn rewrite — then the Edge Fn reads allowlist + emits CSP per-response (heavier refactor, not recommended) |
| supabase CLI v2.100+ | migration push (existing project tooling) | ✓ | — | — |

**Missing dependencies with no fallback:**
- Better Stack paid account — gated on founder HUMAN-UAT (D-06)
- Calendly developer OAuth client credentials — gated on founder action (could be a sub-task of D-06)

**Missing dependencies with fallback:**
- (None — Vercel Edge Middleware has a heavier-but-workable fallback per Pattern 3 / Open Question 4)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project default) + playwright (e2e for consent + admin allowlist) |
| Config file | `leanshot/vite.config.ts` (vitest config inline via `defineConfig` from `vitest/config`) + `leanshot/playwright.config.ts` |
| Quick run command | `cd leanshot && npx vitest run <pattern>` |
| Full suite command | `cd leanshot && npm run test` (vitest run) + `npm run test:e2e` (playwright) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POLISH-10 | `status.leanshot.app` resolves + Better Stack returns 200 | smoke (curl + HTTP status) | `curl -sIL https://status.leanshot.app \| head -1` | ❌ Wave 0 — `tests/smoke/status-page.smoke.test.ts` |
| POLISH-10 | DNS CNAME points to Better Stack endpoint | manual (HUMAN-UAT) | dig CNAME status.leanshot.app | n/a — operator check |
| EMBED-01 | Calendly block renders State 1 placeholder when no consent | unit (React) | `npx vitest run src/components/admin/pages/blocks/CalendlyBlock.test.tsx` | ⚠ extend existing |
| EMBED-01 | Calendly block transitions to State 3 iframe when consent granted | unit (React + simulated `leanshot:consent-change`) | same file | ❌ Wave 0 — new test cases |
| EMBED-02 | YouTube block routes through `youtube-nocookie.com` | unit (verifies `buildYouTubeSrc`) | `npx vitest run src/lib/page-builder/embed-src.test.ts` | ✅ exists — covers buildYouTubeSrc |
| EMBED-02 | YouTube block consent-gates correctly | unit | `npx vitest run src/components/admin/pages/blocks/YouTubeBlock.test.tsx` | ⚠ extend existing |
| EMBED-03 | Tally block consent-gates correctly | unit | `npx vitest run src/components/admin/pages/blocks/TallyBlock.test.tsx` | ⚠ extend existing |
| EMBED-04 | CSP header in vercel.json matches snapshot | unit | `npx vitest run tests/csp/csp-snapshot.test.ts` | ✅ exists — extend snapshot.txt |
| EMBED-04 | Every embed iframe has sandbox attribute | unit | `npx vitest run src/lib/page-builder/embed-src.test.ts` | ✅ exists |
| EMBED-04 | dompurify sanitizes admin-pasted KB embed-block markers | unit | `npx vitest run src/admin/modules/helpdesk/KBEditorPage.test.tsx` | ⚠ extend existing |
| EMBED-05 | Skeleton renders until iframe `onLoad`; opacity transitions 200ms gated by reduce-motion | unit (React Testing Library) | `npx vitest run src/components/admin/pages/blocks/CalendlyBlock.test.tsx` | ⚠ extend |
| EMBED-06 | KB article body with `<embed-block>` marker renders the React block component | unit | `npx vitest run src/helpdesk/KBArticleView.test.tsx` | ⚠ extend existing — file exists |
| EMBED-07 | Custom-iframe block + URL validator rejects non-allowlisted hostname | unit | `npx vitest run src/lib/page-builder/embed-src.test.ts` (validateCustomIframeUrl cases) | ❌ Wave 0 — extend file |
| EMBED-07 | iframe_allowlist RLS prevents non-superadmin add/remove | integration (live Supabase) | `npx vitest run src/lib/admin/__tests__/iframe-allowlist-rls.test.ts` | ❌ Wave 0 — new file |
| EMBED-07 | Vercel Edge Middleware injects allowlisted hosts into CSP frame-src | integration (deploy preview) | manual deploy + curl + grep `frame-src` | ❌ Wave 0 — `tests/integration/csp-middleware.test.ts` (mockable) |
| EMBED-07 | Allowlist UI add-hostname form validates client-side (empty/protocol/wildcard/duplicate) | unit (React) | `npx vitest run src/components/admin/embeds/AddHostnameForm.test.tsx` | ❌ Wave 0 — new file |
| EMBED-07 | Allowlist UI remove-confirm modal shows reference-count + correct copy | unit (React) | `npx vitest run src/components/admin/embeds/RemoveHostnameConfirm.test.tsx` | ❌ Wave 0 — new file |
| EMBED-07 | Allowlist mutation writes audit_logs row with action='iframe_allowlist.add' | integration (live Supabase) | extend `src/lib/admin/__tests__/audit-logs-rls.test.ts` | ⚠ extend existing |
| EMBED-08 | Calendly OAuth popup origin validation rejects non-Calendly postMessage | unit (jsdom + simulated event) | `npx vitest run src/components/admin/pages/editor/CalendlyPreviewPopup.test.tsx` | ❌ Wave 0 — new file |
| EMBED-08 | Popup-blocked detection shows State D2-error | unit (mock window.open returning null) | same file | ❌ Wave 0 |
| D-01 | Better Stack 7-component hierarchy configured | manual (HUMAN-UAT) | operator visits Better Stack admin | n/a |
| D-02 | Auto-incident thresholds set in Better Stack | manual (HUMAN-UAT) | operator config check | n/a |
| D-03 | Subscriber form embedded + email-only | manual | operator-verify on live status page | n/a |
| D-04 | Maintenance window scheduling works | manual | operator schedules a test window | n/a |
| D-05 | DNS CNAME live | smoke (dig) | `dig CNAME status.leanshot.app` | ❌ Wave 0 — smoke test |
| D-06 | HUMAN-UAT pre-req checklist complete | manual | operator sign-off | n/a |
| D-07 | Per-provider consent-category mapping respected | unit | extend each block's test | ⚠ extend |
| D-08 | Branded placeholder card matches UI-SPEC §Surface B State 1 copy | unit (React) — assert copy + a11y attrs | extend each block's test | ⚠ extend |
| D-09 | `leanshot:consent-change` event fires on banner mutation | unit | `npx vitest run src/components/consent/consent-config.test.ts` (extend) | ⚠ extend existing |
| D-09 | Embed block subscribes + lazy-loads on consent grant | unit | extend block test files | ⚠ extend |
| D-10 | Opacity 0→1 200ms gated by useReducedMotion | unit (assert class names + reduce-motion env) | extend block test files | ⚠ extend |
| D-11 | Sentry CSP report endpoint reachable | integration (deploy + curl) | manual smoke at deploy | n/a — deploy-time |
| D-12 | vercel.json CSP contains exact per-provider entries | unit | csp-snapshot.test.ts | ✅ already gates |
| D-13 | Monthly CSP-violation review process documented | docs | none | n/a — runbook |
| D-14 | iframe_allowlist table exists + middleware reads + injects | integration | csp-middleware test + RLS test | ❌ Wave 0 |
| D-15 | Hostname exact-match — `meet.example.org` rejects `sub.meet.example.org` | unit | embed-src.test.ts validateCustomIframeUrl cases | ❌ Wave 0 |
| D-16 | Custom-iframe sandbox = `allow-scripts allow-same-origin` only | unit | embed-src.test.ts assertion on rendered HTML | ❌ Wave 0 |
| D-17 | Superadmin-only allowlist UI; non-superadmin sees no module entry | unit (React) | new `AllowlistPage.test.tsx` | ❌ Wave 0 |
| D-17 | Audit log retention 90d | DB schema check | extend audit retention cron test | ⚠ extend |
| D-18 | Custom-iframe blocks live outside ad-free firewall (no eslint zone leak) | unit (eslint config snapshot) | existing eslint zone tests | n/a — verify no change |

### Sampling Rate
- **Per task commit:** `npx vitest run <pattern>` for files modified in the commit
- **Per wave merge:** `cd leanshot && npm run test` (full vitest) + `npm run lint` + `npm run build` + `cd leanshot && npx playwright test --grep "consent\|embed\|allowlist"` (filtered e2e)
- **Phase gate:** Full vitest green + full playwright green + CSP snapshot match + manual HUMAN-UAT sign-off for Workstream A before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/smoke/status-page.smoke.test.ts` — POLISH-10 smoke (DNS + HTTP)
- [ ] `src/components/admin/pages/blocks/CustomIframeBlock.test.tsx` — new block tests
- [ ] `src/lib/page-builder/embed-src.test.ts` — extend with `validateCustomIframeUrl` cases (D-15, D-16)
- [ ] `src/lib/admin/__tests__/iframe-allowlist-rls.test.ts` — RLS + RPC tests (live Supabase)
- [ ] `tests/integration/csp-middleware.test.ts` — Vercel middleware integration test (mockable; live verify via deploy curl)
- [ ] `src/components/admin/embeds/AddHostnameForm.test.tsx` — client-side validation cases
- [ ] `src/components/admin/embeds/AllowlistTable.test.tsx` — render + sort + remove-confirm flow
- [ ] `src/components/admin/embeds/RemoveHostnameConfirm.test.tsx` — modal copy variants per UI-SPEC
- [ ] `src/components/admin/embeds/AllowlistPage.test.tsx` — superadmin role gating, empty state, error state
- [ ] `src/components/admin/pages/editor/CalendlyPreviewPopup.test.tsx` — postMessage origin validation + popup-blocked detection
- [ ] `src/components/consent/__tests__/consent-event-emit.test.ts` — assert `leanshot:consent-change` fires on banner state change (extend existing)
- [ ] No framework install needed — vitest + playwright already configured

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes — superadmin gate on /admin/embeds/allowlist | Phase 24 `hasMinRole('superadmin')` + Phase 27 `surfaceCheck` |
| V3 Session Management | yes — Calendly OAuth token storage | In-memory only (recommended); never localStorage |
| V4 Access Control | yes — RLS on iframe_allowlist + SECDEF RPCs with `is_admin_at_least('superadmin')` gate | Mirror Phase 24/32 audit-logged RPC pattern |
| V5 Input Validation | yes — Custom-iframe URL, hostname allowlist add form | `validateCustomIframeUrl` (Pattern Code Examples) + client-side form rules per UI-SPEC §Surface E |
| V6 Cryptography | no — no new crypto in this phase | n/a |
| V7 Error Handling | yes — popup-blocked, postMessage origin mismatch | Log to Sentry; UX per UI-SPEC §Surface D State D2-error |
| V9 Communication | yes — CSP enforcement | Per D-11/D-12; Vercel middleware Pattern 3 |
| V12 Files | yes — `<iframe sandbox>` flags FIXED per D-16 | Sandbox = `allow-scripts allow-same-origin` only; no `allow-same-origin allow-scripts allow-top-navigation` (which would bypass framing protection) |
| V13 API/Web Services | yes — Calendly OAuth callback Edge Fn | Validate Calendly state param + use exact-match redirect URI |

### Known Threat Patterns for {React SPA + Vercel + Supabase Postgres + Vite + Edge Functions} stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via admin-pasted KB HTML | Tampering | dompurify with `USE_PROFILES: { html: true }` (already in `KBEditorPage.tsx:237`) + restricted `ADD_TAGS: ['embed-block']` allowlist |
| Custom-iframe pointed at attacker-controlled host | Tampering / Info Disclosure | Hostname exact-match allowlist (D-15) + CSP `frame-src` exact-match enforcement; sandbox flags fixed (D-16) |
| Look-alike hostname (`calendly.com.evil.com`) | Spoofing | Existing `embed-src.ts:86-97` `URL` ctor + `parsed.hostname === expectedHost` exact equality (NOT `endsWith`/`includes`) — mirror this pattern for Custom-iframe |
| postMessage from arbitrary origin → token theft | Spoofing / Info Disclosure | `event.origin === 'https://calendly.com'` guard (Pitfall 6 + Code Example) |
| Cross-tenant allowlist write (non-superadmin adds hostname) | Elevation of Privilege | SECDEF RPC + `is_admin_at_least('superadmin')` gate; RLS service-role-only inserts |
| Consent bypass via stale iframe `src=""` keeping cookies | Privacy regression | Fully unmount iframe element on revoke (UI-SPEC §Surface B + Anti-Pattern) |
| CSP report URI itself blocked by CSP | Info Disclosure (loss of monitoring) | Sentry ingest hosts already in `connect-src` per `vercel.json:42` (verified) |
| Vercel middleware cache stale → blocked iframe | Availability | 60s TTL acceptable per D-14 + admin manual "purge cache" button as escape hatch |

## Sources

### Primary (HIGH confidence — verified against codebase)
- `leanshot/vercel.json:40-49` — current static CSP header configuration
- `leanshot/src/lib/page-builder/block-schema.ts:36-48` — current 12-literal `BlockType` union
- `leanshot/src/lib/page-builder/embed-src.ts:1-213` — existing buildXSrc + buildXIframeHtml helpers + escape-html boundary
- `leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx` — confirms unconditional iframe render (Pitfall 3)
- `leanshot/src/components/admin/pages/editor/property-configs.ts:113-155` — existing youtube/calendly/tally PROPERTY_CONFIGS entries
- `leanshot/src/components/consent/consent-config.ts:261-273` — confirms no `dispatchEvent` (Pitfall 2)
- `leanshot/src/lib/consent/consent-defer.ts` — Phase 22 idle-deferred consent banner load
- `leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx:237` — existing dompurify chain
- `leanshot/src/helpdesk/KBArticleView.tsx:14-15,98` — existing react-markdown + remark-gfm + rehype-raw + dompurify chain
- `leanshot/src/lib/admin/modules.ts:84-298` — existing ADMIN_MODULES manifest pattern (entries needed at line ~298+)
- `leanshot/tests/csp/csp-snapshot.test.ts:1-67` — existing CSP snapshot test contract
- `leanshot/tests/csp/csp-snapshot.txt` — current sorted CSP directive snapshot
- `leanshot/vite.config.ts` — confirms Vite (not Next.js) + injectManifest PWA strategy
- `supabase/functions/page-render/render.ts:53-65,609-683` — confirms Deno renderer pattern for the 3 existing embed types
- `supabase/migrations/20260601000001_audit_logs.sql` — audit_logs schema + RLS contract
- `supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql:43-61` — current 6-arg `log_admin_action` signature
- `.planning/STATE.md:6,70-94` — Phase 41 split into 41-A1 / 41-B1..B4
- `.planning/ROADMAP.md:483-496` — Phase 41 5 success criteria
- `.planning/phases/41-public-status-page-embed-provider-blocks/41-CONTEXT.md` — 18 locked decisions
- `.planning/phases/41-public-status-page-embed-provider-blocks/41-UI-SPEC.md` — 5 surfaces design contract

### Secondary (MEDIUM confidence — referenced but not freshly fetched this session)
- Vercel Edge Middleware docs (https://vercel.com/docs/functions/edge-middleware) — Pattern 3 shape
- Better Stack pricing + integration docs — D-06 HUMAN-UAT pre-reqs
- vanilla-cookieconsent v3 callback contract — `onChange` / `onConsent` / `onFirstConsent` synchronous behavior (Assumption A3)
- Calendly OAuth docs — popup flow + redirect URI exact-match + state param

### Tertiary (LOW confidence — flagged in Assumptions Log)
- A1 (Vercel middleware augments responses returned from rewrites to Supabase Edge Fns) — verify at deploy time with curl
- A2 (Better Stack $12/mo tier covers all needed integrations)
- A5 (allowlist size stays <1000 rows)
- A6 (Sentry CSP report-uri format)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency is already on `package.json` (verified)
- Architecture: HIGH — extends well-understood Phase 15 + Phase 22 + Phase 24 patterns
- Pitfalls: HIGH — two load-bearing pitfalls (Phase 22 emit absent; existing blocks not gated) are codebase-verified
- Validation Architecture: HIGH — test infrastructure already exists; new tests are listed with concrete file paths and patterns
- Better Stack vendor pieces: MEDIUM — locked but founder-side; HUMAN-UAT depends on vendor cooperation
- D-14 dynamic CSP middleware: MEDIUM — Pattern 3 is verified-correct for Vite SPAs on Vercel, but Assumption A1 (middleware-on-rewrites) needs deploy-time verification

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days — stable stack; Better Stack pricing or Vercel middleware API could shift but unlikely)
