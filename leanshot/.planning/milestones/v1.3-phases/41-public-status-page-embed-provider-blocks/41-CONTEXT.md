# Phase 41: Public Status Page + Embed-Provider Blocks - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Two parallel workstreams in one phase:

**Workstream A — Public Status Page (POLISH-10)**
1. `status.leanshot.app` live via Better Stack ($12/mo).
2. Hybrid 7-component status shape (4 user-facing + 3 underlying-service, hierarchical).
3. Auto-incident detection from Sentry + Vercel + Supabase via Better Stack heartbeats + integrations (conservative thresholds).
4. Email-only subscriber notifications via Better Stack; maintenance windows scheduled in Better Stack UI (no in-app dashboard in v1.3).

**Workstream B — Page Builder Embed Blocks (EMBED-01..08)**
1. 4 embed block types (Calendly + YouTube + Tally + Custom-iframe) registered in Phase 15 page-builder schema.
2. Cookie-consent-gated lazy-load with branded placeholder fallback + auto-load on consent grant.
3. CSP enforced day-1 with conservative per-provider host allowlist; Custom-iframe hosts allowlisted per-deployment via superadmin UI.
4. iframe sandbox = `allow-scripts allow-same-origin` minimum for Custom-iframe (provider-specific embeds inherit their provider's hardcoded sandbox attribute).
5. Embed blocks also render in helpdesk KB articles (EMBED-06 extends reach to M6 surfaces).
6. Calendly inline preview in PageEditor via popup OAuth (NOT iframe-internal — V13-EMBED pitfall).

**Out of scope (explicitly):**
- In-app status dashboard pulling Better Stack API (v1.4 polish if ops demand surfaces).
- RSS / Slack subscriber channels (v1.4+).
- Per-org custom-iframe allowlist (superadmin-only at deployment scope in v1.3).
- Admin-overridable iframe sandbox flags (locked-down in v1.3; per-provider hardcoded).
- Stripped-down no-cookie preview proxies on consent decline (defer to v1.4; branded placeholder is the fallback).

</domain>

<decisions>
## Implementation Decisions

### Workstream A — Better Stack Status Page (POLISH-10)

- **D-01: Hybrid 7-component shape (hierarchical).** Top-level user-facing: Patient App / Clinic App / Admin / Public Site. Sub-grouped: Auth / Database / Webhooks. Better Stack supports component groups; we use them. Status rolls UP (any sub-service degraded → parent shows degraded).
- **D-02: Conservative auto-incident thresholds.**
  - Sentry error rate >5% over 5min → incident
  - Vercel deploy fail → incident (per-environment; prod-only triggers public-facing incident)
  - Supabase p95 query time >1s over 10min → incident
  - Better Stack heartbeat check every 30s on the 4 user-facing surfaces
  - Defaults shipped in Better Stack admin during setup; admin tunes via Better Stack UI directly (no in-app config in v1.3)
- **D-03: Email-only subscriber notifications via Better Stack form on /status page.** Public visitors subscribe via the embedded Better Stack form. No multi-channel in v1.3 (RSS/Slack deferred). Better Stack handles delivery; LeanShot doesn't store subscriber emails.
- **D-04: Maintenance windows scheduled via Better Stack admin UI directly.** No in-app dashboard. Acceptable for v1.3 ops scale (founder + small team).
- **D-05: DNS — `status.leanshot.app` CNAME to Better Stack endpoint.** New DNS record (paired with existing leanshot.app + app.leanshot.app). Vercel project unchanged.
- **D-06: HUMAN-UAT pre-req.** Founder action before P41 ships: (a) Better Stack account upgrade to paid tier ($12/mo), (b) integrate Sentry + Vercel + Supabase via Better Stack OAuth, (c) configure 7 components per D-01, (d) CNAME setup at registrar. Tracked in PLAN.md as a Task.

### Workstream B — Embed Blocks: Cookie Consent + Per-Provider Category (EMBED-04/05)

- **D-07: Fixed per-provider consent-category mapping.**
  - Calendly → functional + analytics
  - YouTube → analytics + marketing (YT drops marketing cookies even on youtube-nocookie if user is YT-signed-in)
  - Tally → functional (forms only)
  - Custom-iframe → marketing (default; cannot be re-categorized in v1.3 — superadmin-allowlist gate is the real safety)
- **D-08: Branded placeholder fallback on consent decline.** Card with provider logo + headline "Enable [category] cookies to view this [Calendly meeting / YouTube video / Tally form / embed]" + secondary "Manage cookie preferences" link that re-opens the P22 consent banner. Card design respects existing DS Card primitive.
- **D-09: Auto-load on consent grant via P22 consent-state event listener.** When user grants the required category, embed blocks listening to the consent-change event lazy-load immediately. No reload required. Reuses Phase 22 consent-state event-emitter pattern.
- **D-10: Loading UX per EMBED-05.** DS Skeleton placeholder until iframe `onLoad` fires; opacity 0→1 over 200ms; gated by `useReducedMotion()`. Same Phase 15 pattern.

### Workstream B — CSP Allowlist Policy (EMBED-04)

- **D-11: CSP enforced from day 1 + reporting endpoint for ongoing visibility.** No report-only phase. Explicit `frame-src` + `script-src` + `connect-src` entries added to the existing CSP header (vercel.json / next.config.js). Violations routed to a Sentry CSP reporting endpoint for ongoing review.
- **D-12: Conservative per-provider host entries — ONLY the exact hosts each provider's docs require.**
  - **Calendly:** `frame-src calendly.com *.calendly.com`; `script-src assets.calendly.com`; `connect-src api.calendly.com`
  - **YouTube:** `frame-src youtube-nocookie.com www.youtube-nocookie.com`; `script-src www.youtube-nocookie.com s.ytimg.com`; `img-src i.ytimg.com`
  - **Tally:** `frame-src tally.so *.tally.so`; `script-src tally.so`
  - **Custom-iframe:** `frame-src` extended at request-time per the per-deployment allowlist (see D-14)
- **D-13: Monthly CSP-violation review.** Founder/ops reviews Sentry CSP report dashboard monthly; when providers add new CDN hosts, update allowlist via PR. Audit trail in git.
- **D-14: Custom-iframe CSP allowlist is per-deployment + dynamically injected.** Stored in a `iframe_allowlist` table (or env var if simpler — planner picks); rendered into the CSP header at request time by a Vercel middleware. When superadmin adds/removes a hostname, the table updates + Vercel cache invalidates.

### Workstream B — Custom-Iframe Security Model (EMBED-07)

- **D-15: Hostname-exact match against per-deployment allowlist.** Server-side validator extracts URL hostname; checks exact-match against the allowlist. Subdomain match NOT permitted (allowlisted 'meet.example.org' does NOT permit 'sub.meet.example.org'). Reject otherwise.
- **D-16: iframe sandbox flags FIXED for Custom-iframe.** Default sandbox = `'allow-scripts allow-same-origin'`. Admin CANNOT override via UI in v1.3 (locked-down posture). Trade-off accepted: some custom iframes won't work (forms, payments); user adds those provider-specific flags via a v1.4 polish phase if demand emerges. Provider-specific embeds (Calendly/YouTube/Tally) have their own hardcoded sandbox attribute per provider docs.
- **D-17: Superadmin-only allowlist UI at `/admin/embeds/allowlist`.** Add/remove hostnames; UI shows last-used timestamp + which pages reference the host (to prevent accidental removal). Audit log retention 90d via `audit_logs` table (Phase 25 schema).
- **D-18: Custom-iframe blocks live OUTSIDE the Phase 12 ad-free firewall — ad-eligible.** Embeds are in the "embed" bucket per Phase 12 D-02 classification; ad-free `/clinic` routes still don't load ad-network domains, but they CAN load custom-iframe content (the firewall protects the ad bucket, not the embed bucket). Eslint `import-x/no-restricted-paths` zone for `src/lib/native/ads*.ts` is unaffected.

### Workstream B — Calendly Inline Preview (EMBED-08, V13-EMBED pitfall) — Claude's Discretion

- **PageEditor inline preview uses popup OAuth NOT iframe-internal.** When admin places a Calendly block, PageEditor renders a preview thumbnail; click → opens a Calendly OAuth popup window (separate browser window, NOT a nested iframe). Calendly's OAuth flow completes in the popup; popup posts result back to PageEditor via `postMessage`. Avoids the V13-EMBED pitfall of nested-iframe-OAuth-bouncing.
- Planner picks: postMessage origin validation, OAuth token storage shape (in-memory only? per-session sessionStorage?), error UX on popup-blocked.

### Other Claude's Discretion

- **CSP snapshot test extension.** Phase 12 D-10 snapshot test extends to assert new per-provider entries from D-12. Planner picks the test update shape.
- **Embed block schema in page builder.** New block types `embed.calendly` / `embed.youtube` / `embed.tally` / `embed.custom_iframe` (one per block type). Block config JSONB shape per provider. Planner reuses Phase 15 block-schema pattern.
- **Embed render in helpdesk KB articles (EMBED-06).** Same block-render component used in PageBuilder + KB; planner picks composition.
- **dompurify config for admin-pasted HTML.** Reuse existing dompurify 3.2.7 + rehype-sanitize chain from Phase 50 / Phase 15.
- **iframe `loading="lazy"` attribute.** All embed iframes get native lazy-loading. No JS-driven IntersectionObserver path needed.
- **Better Stack integration shape.** Sentry → Better Stack via Better Stack's Sentry-OAuth integration; Vercel via deploy-hook webhook; Supabase via heartbeat ping endpoint. Founder configures during D-06 HUMAN-UAT.

</decisions>

<canonical_refs>
## Canonical References

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 41: Public Status Page + Embed-Provider Blocks" — 5 success criteria
- `.planning/REQUIREMENTS.md` §WS-Embed lines 81–88 — EMBED-01..08 verbatim
- `.planning/REQUIREMENTS.md` §WS-Polish line 241 — POLISH-10 verbatim

### Prior-phase load-bearing
- `.planning/phases/15-*/` — page-builder block schema (embed blocks register as new block types)
- `.planning/phases/22-*/` — cookie consent state + event emitter (D-09 auto-load)
- `.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md` — D-04 ad-free firewall (D-18 ad-eligible interaction); D-10 CSP snapshot test (extends per D-12)
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — `audit_logs` schema (D-17 90d retention)
- `.planning/phases/37-m6-helpdesk-core/37-CONTEXT.md` — D-13 widget surface (EMBED-06 extends embed reach into KB articles)
- `.planning/phases/50-*/` — dompurify / rehype-sanitize wiring (reuse for admin-pasted HTML)

### Codebase
- `leanshot/vercel.json` (or equivalent CSP header config) — extend with per-provider entries from D-12
- `leanshot/tests/csp/csp-snapshot.test.ts` — extend per Phase 12 D-10 pattern
- `leanshot/src/lib/page-builder/blocks/` — new embed block types registered here
- `leanshot/src/lib/cookie-consent/` (Phase 22) — D-09 consent-state event listener
- `leanshot/src/lib/native/` — Phase 12 firewall directories (D-18 does NOT modify these)
- `leanshot/src/components/admin/embeds/` — NEW superadmin allowlist UI (D-17)
- `leanshot/src/lib/org.ts` — `surfaceCheck('admin.embeds.allowlist')` superadmin gate
- Supabase: NEW table `iframe_allowlist(hostname, added_by_user_id, added_at, last_used_at)` (D-14)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STACK.md` — dompurify 3.2.7 + Better Stack already locked

### Memory pointers
- [[reference_supabase_migration_filename_regex]]
- [[reference_supabase_migration_gotchas]]
- [[reference_eslint_import_x_path_gotcha]] — if extending ad-free firewall zones (D-18 does not, but verify)
- [[reference_claude_design_bundle_landmines]] — CSS embed-iframe height/transition gotchas (relevant for D-10)
- [[reference_grep_gate_comment_strip]]
- [[feedback_planner_iter1_anti_patterns]]
- [[reference_vite_static_env_inlining]]

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 15 page-builder block schema + render pipeline — embed blocks register here.
- Phase 22 cookie consent event-emitter — D-09 auto-load on grant.
- Phase 12 CSP snapshot test — extended per D-12.
- Phase 12 firewall zone definitions in `eslint.config.js` — referenced by D-18.
- Phase 50 dompurify / rehype-sanitize chain — admin-pasted HTML sanitization.
- DS Skeleton + Card primitives (v1.2) — D-10 loading state + D-08 placeholder.
- `useReducedMotion` (v1.2) — D-10 opacity transition gate.
- `audit_logs` schema (P25) + `surfaceCheck()` (P27) — D-17 superadmin gate + audit trail.

### Established Patterns
- Block-type registration in `src/lib/page-builder/blocks/` follows Phase 15 pattern.
- New table with RLS deny + service-role insert + admin-only select (D-14 `iframe_allowlist`).
- CSP header configured in vercel.json (or next.config.js if next-forge); snapshot test asserts the exact header content per environment.
- Audit-logged admin actions reuse Phase 25 `log_admin_action` helper (or similar).
- Email subscriber forms embedded in static pages — Better Stack hosts; LeanShot doesn't store.

### Integration Points
- `vercel.json` CSP header — explicit additions per D-12.
- `tests/csp/csp-snapshot.test.ts` — extend assertions per D-11.
- Page builder render — new block render branches (4 new types).
- Helpdesk KB article renderer (P37) — reuses page-builder block render (EMBED-06).
- New DNS record `status.leanshot.app` CNAME → Better Stack endpoint.
- New Edge Fn `embed-allowlist-csp` (or Vercel middleware) — D-14 dynamic CSP frame-src injection.
- New admin module `/admin/embeds/allowlist`.

</code_context>

<specifics>
## Specific Ideas

- Hybrid 7-component status (D-01) deliberately balances technical precision (sub-services) and end-user comprehension (4 user-facing). The roll-up behavior means a clinic admin doesn't see "Database degraded — what does that mean for me" — they see "Clinic App degraded".
- Conservative thresholds (D-02) prefer false-negatives over false-positives. Status page reputation depends on it NOT flickering red. Trust > rapid alerting.
- Per-provider CSP entries (D-12) are deliberately exact-match rather than wildcard. Trade-off accepted: monthly maintenance (D-13) is the cost of tight surface. CSP report-only NOT chosen because we already have Phase 12 snapshot test giving us pre-merge coverage on header changes.
- Superadmin-only Custom-iframe allowlist (D-17) is the strongest XSS protection without going full "no custom iframes ever". Audit-logged + last-used-timestamp + page-reference visibility gives ops the right tools.
- Fixed sandbox flags for Custom-iframe (D-16) trades flexibility for safety. If a v1.4 polish phase needs to allow `allow-forms` for specific use cases, add a per-block override with superadmin approval. Don't open this in v1.3.
- The V13-EMBED pitfall (popup-OAuth not iframe-internal) is Claude's discretion at planner time but worth a callout in the spec: nested-iframe OAuth bouncing causes Calendly's flow to fail; popup is the workaround.
- D-18's ad-free firewall interaction is the load-bearing Phase 12 carryover. The eslint zone for `src/lib/native/ads*.ts` is unaffected — embed blocks DO NOT import from ads, and the firewall doesn't include the embed bucket.

</specifics>

<deferred>
## Deferred Ideas

### In-app status dashboard
v1.3 ships Better Stack standalone. Pulling Better Stack API into an in-app admin dashboard deferred to v1.4 if ops surfaces demand.

### RSS / Slack subscriber channels
Email-only via Better Stack in v1.3. Multi-channel deferred to v1.4 polish.

### Per-org custom-iframe allowlist
Superadmin-only at deployment scope in v1.3. Per-org self-service allowlist is too much audit/security surface for v1.3.

### Admin-overridable iframe sandbox flags
Locked-down in v1.3. Per-block override with superadmin approval is a v1.4 polish if demand surfaces.

### Stripped-down no-cookie preview proxies on consent decline
Branded placeholder is the v1.3 fallback. YouTube oEmbed thumbnail / Calendly static-availability preview would require per-provider engineering; defer.

### Admin maintenance-window scheduling UI
Better Stack admin UI used directly in v1.3. In-app scheduling UI deferred.

### Embed analytics (which blocks get how much view-time)
PostHog event tracking per embed-block-view is a v1.4 polish. v1.3 captures consent grant + iframe-load events only.

### Per-environment CSP report destination
Single Sentry CSP reporting endpoint in v1.3 (D-11). Per-env routing deferred to v1.4 ops polish.

</deferred>

---

*Phase: 41-public-status-page-embed-provider-blocks*
*Context gathered: 2026-05-19*
