# Phase 37: M6 Helpdesk Core - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the M6 helpdesk stack end-to-end on web:

1. Schema (8+ tables): tickets + ticket_messages + ticket_attachments + ticket_tags + kb_articles + kb_article_versions + csat_responses + agent_macros; RLS isolates user-side from agent-side.
2. In-app widget on every authenticated screen + KB-only on marketing pages; KB-search-first typeahead + always-visible "Still need help?" ticket form.
3. Inbound email → ticket: `support@app.leanshot.app` for new; HMAC-tokenized `reply+<HMAC>@app.leanshot.app` for reply-threading via Resend Inbound webhook.
4. AI assist (Claude): auto-tag + auto-route per admin rules; draft replies require agent send (HELP-04 verbatim).
5. KB articles in markdown via react-markdown + dompurify; Postgres `tsvector` + GIN full-text search (EN + ES dictionaries); article versioning.
6. SLA per priority tier + `pg_cron` breach alerts; admin per-tag-cluster volume dashboard.
7. CSAT auto-sent after ticket close via the established `_shared/email-router.ts` (SES for PHI, Resend for non-PHI per P25 D-03).
8. Realtime updates (Supabase Realtime) for typing indicator + live message arrival (reuses Phase 9 patterns).
9. Admin macros, routing rules, SLA-targets, sentiment-alert thresholds, tag-cluster trend dashboard.

**Out of scope (explicitly deferred):**
- Mobile native helpdesk (covered later via v1.4 mobile-shell phase).
- Voice/phone support channel — text + email + KB only in v1.3.
- AI auto-SEND replies without agent review — explicit decision below (D-08). Agent always sends.
- ES KB content beyond the i18n schema scaffolding — content waits on [[32-CARRY-OVER]].
- Typesense / Meilisearch upgrade — Postgres tsvector + GIN only in v1.3 per HELP-11 explicit deferral.
- Admin sentiment-threshold UI in v1.3 — hardcoded thresholds, admin UI in a v1.4 polish phase (D-12).

</domain>

<decisions>
## Implementation Decisions

### PHI Routing (HIPAA-critical — inherits P25 D-03)

- **D-01: Clinician-actor → phi=true; patient-actor → phi=false (by default).** Every `tickets` row carries a `phi boolean default false`. Set to `true` automatically when the submitting user's role is in any clinician role (per `src/lib/org.ts` `surfaceCheck` resolution at ticket-create time). Patient-side tickets are treated as user-content; the patient discussing their own data is NOT a covered-entity exchange.
- **D-02: ticket.phi carries end-to-end.** `_shared/email-router.ts` honors the flag for CSAT, reply notifications, agent reply-send, breach alerts — every outbound. PHI=true → AWS SES (BAA-covered). PHI=false → Resend (faster, better deliverability). Mirrors the P25 D-03 split exactly.
- **D-03: Claude AI assist on phi=true tickets uses the BAA-allowlist credential (P25 D-13/D-14).** Same `_shared/anthropic-baa-allowlist.ts` guard module from P25 enforces. AI assist on phi=false tickets uses the consumer credential. Refusal path tested per the P25 SC#1 pattern (existing test corpus extended with helpdesk scenarios).
- **D-04: Ticket attachments inherit ticket.phi.** Attachment storage path includes the phi flag in the RLS predicate. Cross-clinic attachment leak prevented by the existing `org_id` RLS axis.
- **D-05: Audit-log every PHI ticket access by clinician.** Reuses `log_phi_access` SECURITY DEFINER RPC from P25 Plan 25-02. Agent opening a PHI ticket = PHI access event logged with ticket_id + user_id.

### AI Assist Scope + Auto-Action Policy

- **D-06: Auto-tag + auto-route on ticket create.** Claude classifies on `ticket_messages` insert (Edge Fn extends current email-router pattern). Tags applied at ≥0.75 confidence; admin-configurable routing rules pick agent based on tag(s).
- **D-07: Below 0.75 confidence — suggestion only, no auto-apply.** Side-pane in agent inbox shows the suggested tag(s) + suggested route; agent picks. Confidence score visible.
- **D-08: Draft replies ALWAYS require agent send.** HELP-04 verbatim ("agent reviews + edits + sends"). No auto-send path in v1.3 even for high-confidence FAQ tickets. Future auto-send for routine tickets explicitly deferred.
- **D-09: Macro suggestion based on Claude classification.** When Claude tag confidence ≥0.75, side-pane also suggests the top 3 most-relevant macros (from `agent_macros`) for one-click insert into the composer.
- **D-10: Sentiment-alert at ≤-0.6 negative score.** Claude classifies sentiment of each user message; tickets accumulating a message with sentiment ≤-0.6 (or 3 messages ≤-0.3 in a single ticket) land in admin's "Needs attention" queue (new view in admin shell).
- **D-11: Thresholds hardcoded in v1.3 (Claude's discretion in planner).** No admin UI for tuning 0.75 / -0.6 in v1.3 — planner picks reasonable initial values; admin UI is a v1.4 polish-phase concern.
- **D-12: PII scrub-before-Claude is NOT used.** D-03 BAA-allowlist credential handles PHI tickets directly; regex scrub creates false-sense-of-safety and is explicitly rejected.

### Widget Surface + KB-First UX

- **D-13: Widget renders on every authenticated screen + marketing pages with auth-aware fallback.**
  - Authenticated: full widget (KB search + ticket form + active-ticket list + macro chat for agents).
  - Marketing/anonymous: KB-only mode (search + read; "Email support@app.leanshot.app for help" footer line, no in-widget ticket submit).
- **D-14: KB-first via typeahead-immediate.** Widget open → search box focused, KB typeahead populates on keystroke. "Still need help? Create a ticket" button visible from second 1 — no forced delay, no friction gate. Matches Intercom/Crisp ethical default.
- **D-15: Anonymous-user submission via `support@` email ONLY.** No in-widget anon ticket form. Cleanest schema (every `tickets` row has a `user_id`; inbound email matches to existing user OR Edge Fn prompts for signup via outbound email). Lower spam surface; no reCAPTCHA needed in widget.
- **D-16: Widget lazy-loaded into `helpdesk-widget` chunk ≤ 25 kB gz** (Phase 24 D-18..20 ceiling). `sync-defer` pattern; chunk only fetched on widget open, not on initial page load.
- **D-17: Widget hidden on PHI-sensitive screens NOT yet decided per route — Claude's discretion.** Planner reads existing PHI route regex (Phase 25 HIPAA-17 + Phase 24 D-13 PostHog-disable list); same regex hides widget OR widget renders in PHI-mode (no Claude AI in side-pane). Planner picks the cleaner UX.

### Inbound Email + Reply-Threading

- **D-18: Address pattern.** New tickets: `support@app.leanshot.app`. Replies: `reply+<HMAC>@app.leanshot.app` (plus-addressing). Resend Inbound receives both at the same MX. Existing `app.leanshot.app` Resend domain (Phase 16 verified) is reused.
- **D-19: Per-ticket non-expiring HMAC.** Token = `base64url(hmac_sha256(secret, "${ticket_id}:${user_id}"))`. Stored secret in Supabase vault. No expiry per token — ticket lifetime is the natural bound. Secret rotation invalidates all outstanding reply tokens (acceptable; users use widget instead).
- **D-20: Attachments — accept up to 10MB each, ClamAV-scanned in Edge Fn, stored in `ticket-attachments` Supabase storage bucket with RLS.** Inbound webhook fetches Resend-stored attachment → ClamAV scan (`npm:clamav-client` in Edge Fn) → upload to private bucket → row in `ticket_attachments` with phi flag inherited from ticket. Max 10 attachments per inbound email (drop overflow with logged warning).
- **D-21: Auto-create vs require email match.** Inbound from a known user email → ticket created under that user_id. Inbound from unknown email → Edge Fn sends "Thanks for reaching out — please sign up to track your ticket: link" auto-reply; NO ticket created. Trade-off: surfaces signup CTA at help-seeking moment; the unknown email is logged for spam analysis.
- **D-22: HMAC verification fails → bounce with auto-reply, NOT silent drop.** Invalid reply token → Edge Fn sends "We couldn't match your reply to a ticket. Please reply via the helpdesk widget at app.leanshot.app." Bounce traffic surfaces token corruption / spoofing attempts.

### Claude's Discretion

- **SLA tiers + breach-alert channels.** Per ROADMAP SC#5; planner picks initial tier shape (P1 = 4h response / 24h resolution; P2 = 24h / 72h; P3 = 72h / 7d) and breach-alert channel (email to agent + on-call list configurable via env var).
- **KB authoring UX.** Markdown editor — recommend CodeMirror 6 with markdown mode + side-by-side preview. Version diff UI from `kb_article_versions`. ES localization workflow scaffolded but unblocked by [[32-CARRY-OVER]].
- **Realtime UX details.** Typing indicators, live message arrival via Supabase Realtime per HELP-09. Reuses Phase 9 patterns (presence channels, broadcast). Planner picks debounce / throttle values.
- **Macro slash-command UX.** `/macro` in reply composer opens a typeahead. Planner picks fuzzy-match library, sort order, per-agent vs per-team filter UI.
- **Per-tag-cluster trend dashboard.** Admin module (`/admin/helpdesk/trends`); planner picks chart library (likely reuses Phase 33 admin-CAC dashboard pattern with Chart.js).
- **Admin routing rules editor.** Form per HELP-12; planner picks if/then condition builder shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 37: M6 Helpdesk Core" — 5 success criteria
- `.planning/REQUIREMENTS.md` §WS17 lines 203–215 — HELP-01..13 verbatim

### Prior-phase load-bearing decisions
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — D-03 (Resend NO BAA → SES for PHI), D-13/D-14 (dual-Anthropic credential split), D-09 (CI lint), Plan 25-02 (`log_phi_access` RPC)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — D-13 server-side PostHog; D-18..20 bundle ceilings (helpdesk-widget 25 kB gz); admin shell manifest
- `.planning/phases/27-modular-admin-shell-extensions/` — admin shell module extension pattern
- `.planning/phases/16-*/` — `app.leanshot.app` domain + Resend verified subdomain (HMAC reply addresses depend on this)
- Phase 9 — Supabase Realtime patterns (HELP-09 reuses)

### Codebase
- `supabase/functions/_shared/email-router.ts` — phi-aware SES/Resend split (D-02)
- `supabase/functions/_shared/anthropic-baa-allowlist.ts` (P25 Plan 25-04) — BAA scope guard (D-03)
- `supabase/functions/_shared/log-phi-access.ts` (P25 Plan 25-02 RPC wrapper) — D-05 audit hook
- `leanshot/src/lib/org.ts` — `surfaceCheck()` for actor-role detection (D-01)
- `leanshot/src/lib/sync-defer.ts` — helpdesk-widget chunk lazy-load (D-16)
- `leanshot/src/lib/analytics/events.ts` — extend with `ticket_created`, `ticket_assigned`, `ticket_replied`, `ticket_closed`, `kb_article_viewed`, `kb_search_performed`, `csat_submitted`, `sentiment_alert_fired` events

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STACK.md` — Resend Inbound, dompurify 3.2.7, react-markdown 9.x, remark-gfm, rehype-sanitize already locked
- `.planning/codebase/INTEGRATIONS.md` — Supabase Realtime + Resend + Claude wiring

### Memory pointers
- [[reference_supabase_migration_filename_regex]]
- [[reference_supabase_migration_gotchas]] (RLS deny, SECDEF search_path)
- [[reference_resend_phase9_wiring]] — sandbox vs prod domain caveats
- [[reference_vendor_gated_send_health_check]] — SES wraps in startup health-check no-op
- [[feedback_planner_missed_status_enum_widening]] — tickets.status, csat_responses.rating CHECK constraints
- [[reference_supabase_functions_deploy_no_linked_flag]] — omit `--linked` from `functions deploy`
- [[feedback_planner_iter1_anti_patterns]]
- [[reference_grep_gate_comment_strip]] — any CI lint for PHI keywords inherits the comment-strip pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_shared/email-router.ts` — phi-aware routing; just pass `ticket.phi` through.
- `_shared/anthropic-baa-allowlist.ts` — BAA credential guard; helpdesk AI assist calls this for phi=true tickets.
- `log_phi_access` SECDEF RPC (P25 Plan 25-02) — D-05 hook.
- Existing `app.leanshot.app` Resend verified domain (Phase 16) — reused for inbound MX.
- `sync-defer.ts` — wraps the helpdesk-widget chunk to keep it off the index static graph.
- Phase 24 `captureServer` + events.ts pattern — extend with helpdesk events.
- `surfaceCheck()` in `org.ts` — `helpdesk.*` permission surfaces for agent / admin / superadmin distinctions.

### Established Patterns
- Append-only ledger pattern for `ticket_messages` (parallels v1.2 audit_logs); RLS = user-side ticket-owner select + agent-side org-membership select.
- Two-axis RLS — user_id AND org_id where applicable (clinic-side tickets inherit org_id from the clinician's primary_org_id).
- pg_cron + SECDEF + vault.decrypted_secrets pattern (per [[reference_supabase_pg_cron_vault_service_role_pattern]]) for SLA breach cron.
- Bundle chunk-cap discipline — helpdesk-widget chunk holds widget + ticket form + KB search + reply composer; AI side-pane (Claude UI) MAY be a sub-chunk (planner picks).
- Phase 24 D-13 server-side PostHog for every helpdesk event (`ticket_created`, etc. — adblock-immune).

### Integration Points
- App.tsx — Mount the lazy-loaded helpdesk widget (single component, auth-aware internal branching) at root.
- Admin shell — new `/admin/helpdesk` module (inbox + macros + KB editor + routing rules + SLA targets + sentiment queue + trend dashboard).
- Supabase storage — `ticket-attachments` private bucket (10MB / file, RLS, ClamAV scan in inbound Edge Fn).
- Edge Fns: `helpdesk-inbound` (Resend Inbound webhook receiver), `helpdesk-ai-assist` (Claude tagging + drafting), `helpdesk-csat-send` (post-close CSAT), `helpdesk-sla-breach-cron` (pg_cron'd).
- Existing `_uat-resend` Edge Fn pattern (referenced in `_shared/`) — extend for the inbound smoke probe.

</code_context>

<specifics>
## Specific Ideas

- The phi flag (D-01..D-05) is the load-bearing HIPAA decision for this entire phase. Plan-checker must enforce that every email send + every Claude call references the ticket.phi flag — no silent default routes.
- HMAC token (D-19) is per-ticket-non-expiring deliberately — slow-resolving tickets (some helpdesk chains span weeks) shouldn't break reply-threading on a sliding 7d window. Secret rotation as the safety valve is acceptable since rotation is rare.
- Anonymous email-only submission (D-15) creates a natural signup CTA at the help-seeking moment (D-21 auto-reply). Conversion-flavored without being a hostile signup wall.
- ClamAV inline scan (D-20) is a real moderate engineering item. Recommend planner uses `npm:clamav-client` in a Deno-compat layer; if friction, consider deferring scan to a v1.4 polish (and add a P0 deferred-items entry to fix the unscanned-attachment safety gap).
- The 0.75 / -0.6 thresholds (D-06, D-10) are best-guess starting points; we'll learn the right values from production traffic. Plan should log threshold-hit metrics so a v1.4 admin-UI ships with data-informed defaults.

</specifics>

<deferred>
## Deferred Ideas

### AI auto-SEND for high-confidence routine tickets
Explicitly considered + rejected for v1.3 (D-08). HELP-04 verbatim requires agent send. Could revisit in a v1.4 polish phase if production data shows a clear FAQ-only-bot-replyable cohort with low risk.

### Admin sentiment-threshold UI
v1.3 hardcoded thresholds (D-11). Admin UI deferred to a v1.4 polish phase.

### Mobile native helpdesk
v1.4 with the Capacitor mobile shell. v1.3 ships web-only per ROADMAP "Web Only" naming convention for the M3/M6 cluster.

### Voice / phone channel
v1.3 = text + email + KB only. Voice belongs in a future enterprise/B2B-tier phase.

### Typesense / Meilisearch
HELP-11 explicit deferral. Postgres tsvector + GIN only in v1.3. Revisit at v1.5+ if relevance complaints surface.

### Spanish KB content
Schema + localization scaffolding ships; native ES content waits on [[32-CARRY-OVER]] contractor delivery.

### Macro-version-history / changelog
v1.3 ships current-version macro only. Version-history UI for macros is v1.4 polish.

### Per-clinic / per-org branding on the helpdesk widget
v1.3 uses LeanShot brand throughout. White-label widget extensions per org would extend Phase 31; deferred.

</deferred>

---

*Phase: 37-m6-helpdesk-core*
*Context gathered: 2026-05-19*
