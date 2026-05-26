---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 12
type: execute
wave: 3
depends_on: [60-01, 60-02]
files_modified:
  - supabase/functions/rag-newsletter-sender/index.ts
  - supabase/functions/rag-newsletter-sender/templates/rag-newsletter.html
  - supabase/functions/rag-newsletter-sender/deno.json
  - supabase/functions/rag-newsletter-sender/__tests__/sender.test.ts
  - supabase/functions/rag-newsletter-unsubscribe-1click/index.ts
  - supabase/functions/rag-newsletter-unsubscribe-1click/deno.json
  - supabase/functions/rag-newsletter-unsubscribe-1click/__tests__/unsubscribe.test.ts
  - supabase/functions/_shared/email-templates/rag-newsletter.html
  - supabase/functions/_shared/newsletter-token.ts
  - supabase/functions/_shared/__tests__/newsletter-token.test.ts
  - src/components/dashboard/settings/NewsletterSettings.tsx
  - src/components/dashboard/settings/SettingsPage.tsx
  - src/components/onboarding/steps/NewsletterOptInStep.tsx
  - src/components/onboarding/OnboardingFlow.tsx
  - src/lib/rag/newsletter-api.ts
  - src/lib/rag/__tests__/newsletter-api.test.ts
  - src/components/dashboard/settings/__tests__/NewsletterSettings.test.tsx
  - leanshot/public/locales/en/rag.json
  - tests/e2e/newsletter-opt-in.spec.ts
autonomous: true
requirements:
  - RAG-08
user_setup:
  - service: resend
    why: "Newsletter HTML send + open-rate webhook (existing v1.3 Phase 22 integration; only verify secret presence)"
    env_vars:
      - name: RESEND_API_KEY
        source: "Supabase project secrets (set via `supabase secrets set RESEND_API_KEY=... --project-ref <ref>`); existing from v1.3 Phase 22"
    dashboard_config:
      - task: "Verify Resend webhook for email.opened points to PostHog event ingestion (rag-newsletter-opened-webhook will land in 60-15 close-out — Phase 60 ships PostHog event emitter wiring only)"
        location: "Resend Dashboard → Webhooks"
  - service: supabase-vault
    why: "newsletter_unsubscribe_signing_key vault secret for HMAC token signing (stored token compare is primary auth per [[feedback_rls_stored_token_verification_pattern]]; signing key is defense-in-depth for token shape integrity)"
    env_vars:
      - name: NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY
        source: "Generate via `openssl rand -hex 32` then `supabase secrets set NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY=<value> --project-ref <ref>`"

must_haves:
  truths:
    - "Per D-22/D-26 + CONTEXT.md newsletter decisions: weekly Sunday 9am ET digest sends to opted-in subscribers; payload = top-3 newly-curated tier-A chunks (last 7d) + 1 retrieval-popular evergreen chunk + admin-editable intro paragraph"
    - "RFC 8058 List-Unsubscribe-Post: per CONTEXT.md decisions, every newsletter email MUST include both `List-Unsubscribe: <https://...>, <mailto:...>` AND `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers — one-click POST from Gmail/Apple Mail/Outlook flips opted_in=false without confirmation page"
    - "CAN-SPAM affirmative opt-in: Settings toggle + onboarding checkbox BOTH default UNCHECKED/OFF (per UI-SPEC §11-12 Critical UI Invariant #9 + CONTEXT.md D-26 override `default OFF` per CAN-SPAM affirmative opt-in over the legacy 50-09 `default ON for paid users` rule)"
    - "Stored-token RLS pattern per [[feedback_rls_stored_token_verification_pattern]]: unsubscribe token stored in `newsletter_subscribers.unsubscribe_token` (read-only RLS allow anon SELECT, deny anon UPDATE); Fn fetches stored token + constant-time compares before flipping opted_in"
    - "PostHog telemetry: `newsletter_sent` (per-recipient at send time), `newsletter_opened` (Resend webhook → PostHog ingestion in 60-15), `newsletter_unsubscribed` (1click POST handler emits server-side via _shared/posthog-rag-events.ts from 60-02)"
    - "EN-only at MVP: rag.json locale file shipped EN-only; ES queued v1.5 per CONTEXT.md i18n decisions"
    - "Resend send Fn: GET /healthz returns 200; POST /run (cron-triggered) selects opted_in subscribers + retrieves chunks via shared rag-retrieve helper (60-02) + composes HTML from template + invokes Resend API + records last_sent_at + emits PostHog event per subscriber + logs cost ($0.0001/send) to $ai_generation"
    - "Unsubscribe Fn: GET shows confirmation page (defense-in-depth UX, but List-Unsubscribe-Post header allows POST for Gmail/Apple Mail one-click); POST flips opted_in=false + emits PostHog newsletter_unsubscribed event; returns HTML success page with Resubscribe link"
    - "PHARMA-02 carveout (per [[feedback_3_layer_must_never_invariant_pattern]]): newsletter body generation MUST pass through existing PHARMA-02 ESLint AST rule + runtime helper + CI grep gate — no dosing numbers, prescriptive verbs (`take`, `increase`, `start`), or compounded-equivalence claims in any chunk summary surfaced in email body"
    - "Tests: vitest unit (constant-time-compare token verify + UPSERT subscription + Resend mock + opted_in default-false assertion) + Playwright onboarding opt-in flow + Deno function tests guarded by import.meta.main per [[reference_deno_test_top_level_serve_trap]]"
    - "Per-Fn deno.json import map per [[reference_supabase_functions_deploy_import_map_flag]] — CLI v2.101.0+ ignores --import-map flag"
    - "Functions DEPLOY in 60-15 (not this plan) per [[feedback_fn_deploy_before_cron_db_push]] — this plan ships source + tests only; 60-15 owns atomic 9-Fn deploy + cron migration push"
  artifacts:
    - path: "supabase/functions/rag-newsletter-sender/index.ts"
      provides: "Resend send Edge Fn — cron-triggered + healthz endpoint"
      exports: ["default serve handler"]
    - path: "supabase/functions/rag-newsletter-sender/templates/rag-newsletter.html"
      provides: "Single-column 600px Resend HTML template per UI-SPEC §13"
      contains: "List-Unsubscribe-Post"
    - path: "supabase/functions/rag-newsletter-unsubscribe-1click/index.ts"
      provides: "RFC 8058 one-click POST + GET unsubscribe handler"
      exports: ["default serve handler"]
    - path: "supabase/functions/_shared/newsletter-token.ts"
      provides: "HMAC sign + constant-time-compare helpers"
      exports: ["mintUnsubscribeToken", "verifyUnsubscribeToken", "constantTimeEqual"]
    - path: "src/components/dashboard/settings/NewsletterSettings.tsx"
      provides: "Settings page Research-newsletter toggle (default OFF)"
      min_lines: 50
    - path: "src/components/onboarding/steps/NewsletterOptInStep.tsx"
      provides: "Optional onboarding step with unchecked-by-default checkbox"
      min_lines: 30
    - path: "src/lib/rag/newsletter-api.ts"
      provides: "Client-side wrapper for subscribe/unsubscribe via PostgREST"
      exports: ["getNewsletterSubscription", "setNewsletterOptIn"]
    - path: "leanshot/public/locales/en/rag.json"
      provides: "EN newsletter copy keys per UI-SPEC §Copywriting Contract"
      contains: "newsletter"
  key_links:
    - from: "cron Sunday 09:00 ET (scheduled in 60-15)"
      to: "supabase/functions/rag-newsletter-sender"
      via: "pg_cron net.http_post with vault service_role_key per [[reference_supabase_pg_cron_vault_service_role_pattern]]"
      pattern: "rag-newsletter-sender"
    - from: "supabase/functions/rag-newsletter-sender"
      to: "newsletter_subscribers + kb_chunks + ragRetrieve"
      via: "shared rag-retrieve helper from 60-02 + PostgREST SELECT on opted_in subscribers"
      pattern: "newsletter_subscribers.*opted_in"
    - from: "supabase/functions/rag-newsletter-sender"
      to: "Resend API"
      via: "fetch with RESEND_API_KEY + List-Unsubscribe + List-Unsubscribe-Post headers"
      pattern: "List-Unsubscribe-Post"
    - from: "Resend recipient inbox one-click unsubscribe"
      to: "supabase/functions/rag-newsletter-unsubscribe-1click POST handler"
      via: "stored-token fetch + constantTimeEqual + UPDATE opted_in=false"
      pattern: "constantTimeEqual"
    - from: "src/components/dashboard/settings/NewsletterSettings.tsx"
      to: "newsletter_subscribers via PostgREST UPSERT"
      via: "src/lib/rag/newsletter-api.ts setNewsletterOptIn"
      pattern: "setNewsletterOptIn"
    - from: "src/components/onboarding/steps/NewsletterOptInStep.tsx"
      to: "newsletter_subscribers via PostgREST UPSERT (on onboarding completion if checked)"
      via: "OnboardingFlow.tsx persists state via setNewsletterOptIn"
      pattern: "NewsletterOptInStep"
    - from: "unsubscribe POST + newsletter send"
      to: "PostHog _shared/posthog-rag-events.ts (from 60-02)"
      via: "captureRagEvent('newsletter_unsubscribed'|'newsletter_sent')"
      pattern: "newsletter_(sent|unsubscribed|opened)"
---

<objective>
Ship the Resend newsletter sender + RFC 8058 one-click unsubscribe Edge Functions and the CAN-SPAM-compliant opt-in surfaces (Settings toggle + onboarding checkbox), reusing 50-09 Tasks 2-3 as the structural starting point. Per CONTEXT.md newsletter decisions (Sunday 9am ET; top-3 tier-A 7d + 1 popular evergreen + admin intro), the digest is composed and sent to opted-in subscribers; per UI-SPEC §11-13 the opt-in default is OFF everywhere (CAN-SPAM affirmative opt-in) and the 1-click unsubscribe uses RFC 8058 `List-Unsubscribe-Post` headers verified via stored-token-and-constant-time-compare per [[feedback_rls_stored_token_verification_pattern]].

Purpose: closes RAG-08 — the weekly Resend newsletter capability with opt-in/opt-out parity across email + Settings + onboarding. Telemetry wires into PostHog via the 60-02 shared event emitter. Functions deploy + cron registration are deferred to 60-15 per [[feedback_fn_deploy_before_cron_db_push]] — this plan ships source + tests only.

Output: 2 Edge Fns (sender + unsubscribe-1click) + Resend HTML template + shared HMAC token helper + 2 React surfaces (NewsletterSettings + onboarding step) + client API wrapper + EN locale strings + vitest + Deno tests + Playwright onboarding E2E.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@leanshot/.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-09-PLAN.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-01-data-layer-migrations-PLAN.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-02-shared-edge-helpers-PLAN.md

<interfaces>
<!-- Key contracts the executor needs. Extracted from 60-01 + 60-02 + existing v1.4 codebase. -->
<!-- Executor MUST use these directly — no codebase exploration required. -->

From `supabase/migrations/20281201000001_phase60_kb_tables.sql` (60-01 ships this table):
```sql
create table public.newsletter_subscribers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  opted_in boolean not null default false,
  topic_tags text[] not null default '{}',
  email text not null,
  unsubscribe_token text not null default encode(gen_random_bytes(32), 'base64'),
  last_sent_at timestamptz null,
  opted_in_at timestamptz null,
  opted_out_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: anon SELECT (unsubscribe_token, opted_in) by user_id only (read-only token lookup);
--      authenticated UPSERT (user_id = auth.uid()); service_role full
```

From `supabase/functions/_shared/rag-retrieve.ts` (60-02 ships this — shared HTTP client):
```typescript
export interface RetrievedChunk {
  chunk_id: string;
  chunk_title: string;
  verbatim_quote: string;
  source_name: string;
  canonical_url: string;
  tier: 'A' | 'B' | 'C';
  topic_tag: string;
  published_at: string; // ISO
  approved_at: string;  // ISO
}
export function retrieveTopChunks(opts: {
  query?: string;
  topic_tag?: string;
  tier?: 'A' | 'B' | 'C';
  k?: number;
  newer_than_iso?: string; // for "last 7d" filter
}): Promise<RetrievedChunk[]>;
```

From `supabase/functions/_shared/posthog-rag-events.ts` (60-02 ships this):
```typescript
export function captureRagEvent(
  distinctId: string,
  event: 'newsletter_sent' | 'newsletter_opened' | 'newsletter_unsubscribed' | 'rag_cost_envelope_breach',
  properties: Record<string, unknown>
): Promise<void>;
```

From `supabase/functions/_shared/slack-guardrail-alert.ts` (60-02 ships this):
```typescript
export function alertSlack(payload: { severity: 'info' | 'warn' | 'error'; surface: string; message: string }): Promise<void>;
```

From `src/components/onboarding/OnboardingFlow.tsx` (v1.4 existing pattern — multi-step controlled flow):
```typescript
// Existing pattern: each step is a child component receiving { onNext, onBack, state, setState }
// New step insertion: planner picks slot AFTER personalization step + BEFORE final review/submit step
// Rationale: by personalization time, user has indicated interest; place before final commit so
// checkbox is part of the "ready to start" gesture, not the welcome moment.
```

From `src/components/dashboard/settings/SettingsPage.tsx` (v1.4 existing):
```typescript
// Existing pattern: sectioned drawer with notifications section already present.
// Mount NewsletterSettings as a sibling section AFTER the existing Phase 54 push-notification-categories section.
```

From `_shared/email-router.ts` if present, else direct Resend fetch:
```typescript
// If supabase/functions/_shared/email-router.ts (Phase 22/25) exists with sendEmail({phi, to, subject, html, headers}):
//   use it (preferred — handles deliverability + suppression list)
// Else: direct `fetch('https://api.resend.com/emails', { headers: { Authorization: `Bearer ${RESEND_API_KEY}` }, body: { ... } })`
// Both paths MUST set custom headers including List-Unsubscribe + List-Unsubscribe-Post per RFC 8058.
```

From CONTEXT.md PHARMA-02 carveout (per [[feedback_3_layer_must_never_invariant_pattern]]):
```typescript
// Existing 3-layer invariant from Phase 39 39-02 D-06:
//   Layer 1: ESLint AST rule (rejects dosing-number + prescriptive-verb patterns)
//   Layer 2: Runtime helper `assertPharma02Safe(text: string): void` — throws on violation
//   Layer 3: CI grep gate
// Newsletter body composition MUST call assertPharma02Safe() on each chunk summary BEFORE template substitution.
```

From `src/lib/i18n/` (v1.4 existing Phase 58 wiring):
```typescript
// t('rag.newsletter.subject_format') etc — keys land in leanshot/public/locales/en/rag.json
// EN-only at MVP per CONTEXT.md; ES file NOT shipped this plan (v1.5)
```
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Recipient inbox → unsubscribe-1click POST | RFC 8058 one-click POST from email client (Gmail/Apple Mail/Outlook auto-trigger); token is the only credential — no session, no JWT |
| Recipient inbox → unsubscribe-1click GET | Manual click-through fallback (defense-in-depth UX); same token surface |
| pg_cron (60-15 scheduled) → rag-newsletter-sender | Service-role-key from vault; trusted invoker |
| Browser (authenticated user) → Settings/Onboarding → newsletter_subscribers UPSERT | Authenticated PostgREST; auth.uid() = user_id RLS guard |
| rag-newsletter-sender → Resend API | RESEND_API_KEY from Supabase secrets; outbound only |
| Resend webhook → PostHog (out of scope; 60-15) | Future ingestion path, noted for completeness |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-12-01 | Tampering | unsubscribe-1click token verification | mitigate | Stored-token RLS pattern per [[feedback_rls_stored_token_verification_pattern]]: anon SELECT(unsubscribe_token, opted_in) gated by user_id; Fn fetches stored token + `constantTimeEqual` compare (NOT `===`); reject on mismatch with generic 400 (no token-shape leak in error body) |
| T-60-12-02 | Tampering | RFC 8058 List-Unsubscribe-Post token replay | mitigate | Token is stable per-subscriber (DB-stored, not time-windowed) BUT rotation on opted_in flip prevents replay of stale tokens against a re-subscribed user: `UPDATE newsletter_subscribers SET unsubscribe_token = encode(gen_random_bytes(32),'base64'), opted_out_at = now(), opted_in = false WHERE user_id = $1 AND constantTimeEqual(unsubscribe_token, $2)` — single-statement atomic |
| T-60-12-03 | Spoofing | CAN-SPAM affirmative opt-in bypass | mitigate | DB default `opted_in = false`; UI default state OFF/unchecked in BOTH Settings + Onboarding; vitest assertion: `expect(NewsletterSettings.toggleDefaultState).toBe(false)`; vitest assertion: `expect(onboardingState.newsletterOptIn).toBe(false)` at mount; PostHog `newsletter_subscribed` event records `opted_in_at` server-side from authenticated user gesture (no anon subscribe path) |
| T-60-12-04 | Information Disclosure | unsubscribe-1click token enumeration | mitigate | Token is 32-byte base64 (~256-bit entropy); brute-force infeasible; RLS prevents listing tokens (anon cannot SELECT * — only filter-by-user_id); rate-limit Edge Fn (deferred to Phase 67 OPS-08; document hot-patch if abused) |
| T-60-12-05 | Injection | Email body content from kb_chunks | mitigate | HTML-encode `verbatim_quote` + `chunk_title` + `source_name` via DOMPurify-equivalent server-side string sanitizer (allowlist `<p><a><strong><em>` only; strip all `<script><iframe><img>onerror=*`); call `assertPharma02Safe()` per [[feedback_3_layer_must_never_invariant_pattern]] BEFORE template substitution — fail-closed (skip chunk; alertSlack on violation) |
| T-60-12-06 | Injection | Email header injection via subject_format / Resend recipient | mitigate | Strip `\r\n` from subject/from/to fields before fetch to Resend API; Resend SDK/API already escapes but defense-in-depth; `email` column is auth.users.email (validated at auth time) — no user-controllable email injection vector |
| T-60-12-07 | Repudiation | Subscriber claims they never opted in | mitigate | `opted_in_at` timestamp recorded server-side on UPSERT with `opted_in=true`; `kb_admin_events`-equivalent audit row inserted in same transaction (event_type='newsletter_subscribed', actor=user_id, payload includes UA + IP if available from request); never bypass on background-jobs path |
| T-60-12-08 | DoS | unsubscribe-1click flooded by abuse | accept | Token entropy + RLS + Edge Middleware rate-limit (Phase 67) sufficient; per-token unsubscribe is idempotent (no amplification); accept residual risk |
| T-60-12-09 | Tampering | rag-newsletter-sender invoked outside cron context | mitigate | Fn requires service-role-key bearer (cron from vault); reject non-bearer requests with 401; GET /healthz exempt (returns static 200) |
| T-60-12-10 | Information Disclosure | Subscriber list leakage via Resend BCC mistake | mitigate | Send per-recipient (one fetch to Resend per subscriber) — NOT bulk BCC; loop in Fn body |
| T-60-12-SC | Tampering | npm/Resend SDK supply chain | mitigate | Resend invoked via direct `fetch` (no `resend` npm package install for the Edge Fn — Deno runtime); no new npm installs in this plan; Phase 60 package legitimacy audit (RESEARCH.md) covers any client-side additions |

All high-severity threats (T-60-12-01, T-60-12-02, T-60-12-03, T-60-12-05) have concrete mitigations gated by automated tests.
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add EN newsletter locale strings + client API wrapper + types</name>
  <files>leanshot/public/locales/en/rag.json, src/lib/rag/newsletter-api.ts, src/lib/rag/__tests__/newsletter-api.test.ts</files>
  <read_first>leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Copywriting Contract — Settings Page Newsletter Toggle, Onboarding Newsletter Checkbox, Newsletter Email Template sections), leanshot/src/lib/i18n (existing Phase 58 wiring), leanshot/src/lib/rag (any existing helpers from 60-10 if shipped at this point)</read_first>
  <behavior>
    - Test 1: `getNewsletterSubscription(userId)` returns `{ opted_in: false, topic_tags: [], email: '...' }` when no row exists (PostgREST returns 0 rows; helper returns synthetic default)
    - Test 2: `getNewsletterSubscription(userId)` returns row when present
    - Test 3: `setNewsletterOptIn({ userId, optedIn: true, topicTags: ['glp-1', 'peptide-research'] })` UPSERTs newsletter_subscribers with `opted_in_at = now()` and `opted_out_at = null`
    - Test 4: `setNewsletterOptIn({ userId, optedIn: false })` UPSERTs with `opted_in = false`, `opted_out_at = now()`, and PRESERVES topic_tags from previous row (does not clobber)
    - Test 5: client wrapper never reads/writes `unsubscribe_token` field (server-only column; defense-in-depth)
    - Test 6: locale keys present per UI-SPEC §Copywriting Contract — section_heading, toggle_label, toggle_sublabel, save_cta, onboarding_label, subject_format, header, digest_intro_placeholder, chunk_section_heading, read_full_cta_format, footer_unsubscribe, footer_disclaimer
  </behavior>
  <action>
    Add EN-only locale file at `leanshot/public/locales/en/rag.json` (CONTEXT.md i18n decisions — newsletter EN-only at MVP; ES queued v1.5; do NOT create `locales/es/rag.json` for newsletter keys this phase). Keys MUST mirror UI-SPEC §Copywriting Contract verbatim — `newsletter.section_heading: "Research newsletter"`, `newsletter.toggle_label: "Send me the weekly research digest"`, `newsletter.toggle_sublabel: "Curated summaries from approved research sources, sent Sundays. Unsubscribe anytime."`, `newsletter.save_cta: "Save preferences"`, `newsletter.onboarding_label: "Send me the weekly research digest (optional — unsubscribe anytime)"`, `newsletter.subject_format: "LeanShot Research: Week of {date}"`, `newsletter.header: "LeanShot Research Digest"`, `newsletter.intro_placeholder: "{admin_intro}"`, `newsletter.section_heading_topic: "This week in {topic}"`, `newsletter.read_full_cta: "Read at {source_name} ↗"`, `newsletter.footer_unsubscribe: "Unsubscribe · Manage preferences"`, `newsletter.footer_disclaimer: "Not medical advice — consult your clinician. LeanShot, [address per CAN-SPAM]."`, `newsletter.unsubscribe_success: "You're unsubscribed."`, `newsletter.resubscribe_cta: "Resubscribe"`. Add merge-by-spread if `leanshot/public/locales/en/rag.json` already exists from 60-10 — DO NOT overwrite existing AI-coach citation keys.

    Implement `src/lib/rag/newsletter-api.ts`:
    - Export `interface NewsletterSubscription { user_id: string; opted_in: boolean; topic_tags: string[]; email: string; last_sent_at: string | null; opted_in_at: string | null; opted_out_at: string | null; }` (NO `unsubscribe_token` field — server-only column, never exposed to client per T-60-12-04).
    - Export `getNewsletterSubscription(userId: string): Promise<NewsletterSubscription>` — PostgREST SELECT on `newsletter_subscribers` keyed by `user_id`; if 0 rows, return synthetic `{ user_id, opted_in: false, topic_tags: [], email: '', last_sent_at: null, opted_in_at: null, opted_out_at: null }`.
    - Export `setNewsletterOptIn({ userId, optedIn, topicTags? }: { userId: string; optedIn: boolean; topicTags?: string[] }): Promise<NewsletterSubscription>` — PostgREST UPSERT with `opted_in_at = optedIn ? new Date().toISOString() : <preserve>`, `opted_out_at = optedIn ? null : new Date().toISOString()`, `topic_tags = topicTags ?? <preserve existing>`. Uses `supabase.from('newsletter_subscribers').upsert(...).select().single()`.
    - Do NOT include `unsubscribe_token` in the column selection or write payload (server defaults handle it).

    Implement vitest at `src/lib/rag/__tests__/newsletter-api.test.ts`:
    - Mock Supabase client; assert UPSERT shape per behavior list above.
    - Constant-time-compare test (token verification) lives in `_shared/__tests__/newsletter-token.test.ts` per Task 2 (do NOT duplicate here).
    - Assert that `setNewsletterOptIn` when called with `optedIn: false` does NOT pass `topic_tags` if not provided (preserves existing).
    - Use vitest mock for `supabase.from(...).upsert(...).select().single()` returning the seeded row.

    Per [[reference_vitest_4_projects_config_masks_default]]: run tests via `npx vitest run --config vite.config.ts`, not plain `npm test`.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/lib/rag/__tests__/newsletter-api.test.ts && npm run typecheck</automated>
  </verify>
  <done>
    - `leanshot/public/locales/en/rag.json` contains all newsletter copy keys per UI-SPEC §Copywriting Contract (existing AI-coach keys from 60-10 preserved if present)
    - `src/lib/rag/newsletter-api.ts` exports `NewsletterSubscription` type, `getNewsletterSubscription`, `setNewsletterOptIn` — never references `unsubscribe_token`
    - 6 vitest cases pass
    - typecheck clean (no any, strict mode)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: HMAC newsletter-token helper + Deno tests (constant-time-compare)</name>
  <files>supabase/functions/_shared/newsletter-token.ts, supabase/functions/_shared/__tests__/newsletter-token.test.ts</files>
  <read_first>leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-02-shared-edge-helpers-PLAN.md (shared helper conventions + import.meta.main guard), [[feedback_rls_stored_token_verification_pattern]] reference notes in CONTEXT.md, [[reference_base64url_postgres_vercel_mint_verify]] for base64url normalization</read_first>
  <behavior>
    - Test 1: `constantTimeEqual('aaa', 'aaa')` returns true
    - Test 2: `constantTimeEqual('aaa', 'aab')` returns false
    - Test 3: `constantTimeEqual('aa', 'aaa')` returns false (length mismatch — early-return safe; documented behavior)
    - Test 4: `constantTimeEqual('', '')` returns true (edge case)
    - Test 5: timing-analysis smoke — 10000 iterations of equal-length mismatched strings completes within stable wall-clock band (NOT a strict timing assertion — just a runtime smoke that the function doesn't short-circuit on mismatch char-by-char; assert via `crypto.subtle.timingSafeEqual`-equivalent code path inspection if available, else trust the bitwise-OR-reduce implementation)
    - Test 6: `mintUnsubscribeToken(userId, signingKey)` returns base64url-encoded HMAC-SHA256 of `${userId}:${storedToken}` — round-trip with `verifyUnsubscribeToken` succeeds
    - Test 7: `verifyUnsubscribeToken` rejects forged tokens (wrong key) with constant-time path (no early-exit before full HMAC compare)
    - Test 8: base64url normalization per [[reference_base64url_postgres_vercel_mint_verify]] — replace-chain handles `+/=` consistently across Postgres mint side and TS verify side
  </behavior>
  <action>
    Implement `supabase/functions/_shared/newsletter-token.ts`:
    - `export function constantTimeEqual(a: string, b: string): boolean` — implement via bitwise OR-reduce on character codes; if lengths differ, still iterate over `max(a.length, b.length)` to avoid length-leak channel (documented inline). Use TextEncoder → Uint8Array if comparing binary; for base64url string comparison, plain string char-code reduce is acceptable.
    - `export async function mintUnsubscribeToken(opts: { userId: string; storedToken: string; signingKey: string }): Promise<string>` — HMAC-SHA256(`${userId}:${storedToken}`, signingKey); base64url-encode (replace `+`→`-`, `/`→`_`, strip `=`).
    - `export async function verifyUnsubscribeToken(opts: { userId: string; storedToken: string; signingKey: string; presentedToken: string }): Promise<boolean>` — recompute mint result, then `constantTimeEqual(presentedToken, expected)`.
    - `Deno.serve` is NOT used in this shared module — pure helper. (Top-level-serve trap per [[reference_deno_test_top_level_serve_trap]] does not apply, but verify import does not transitively pull a serve-emitting module.)

    Implement Deno test at `supabase/functions/_shared/__tests__/newsletter-token.test.ts`:
    - `Deno.test('constantTimeEqual: equal strings', ...)` etc per behavior list above.
    - Note: per [[reference_deno_test_top_level_serve_trap]] project-wide trap, this test file imports ONLY `_shared/newsletter-token.ts` (no Fn imports); ALSO note that running `$HOME/.deno/bin/deno test --no-check supabase/functions/_shared/__tests__/newsletter-token.test.ts` should NOT hit the trap because newsletter-token.ts has no `Deno.serve` call.

    Run via project Deno binary per [[reference_deno_binary_path]]: `$HOME/.deno/bin/deno test --no-check supabase/functions/_shared/__tests__/newsletter-token.test.ts`.

    Per [[feedback_rls_stored_token_verification_pattern]] design note in inline comment: this helper is defense-in-depth — the PRIMARY auth path for unsubscribe is the stored-token + constant-time-compare on the DB-stored `unsubscribe_token` (NOT the HMAC). The HMAC envelope adds tamper-evident framing for the URL but the row-level secret is the auth boundary. Document this in the file header comment.
  </action>
  <verify>
    <automated>$HOME/.deno/bin/deno test --no-check supabase/functions/_shared/__tests__/newsletter-token.test.ts</automated>
  </verify>
  <done>
    - `_shared/newsletter-token.ts` exports `constantTimeEqual`, `mintUnsubscribeToken`, `verifyUnsubscribeToken`
    - 8 Deno test cases pass
    - File header comment explains stored-token vs HMAC roles per [[feedback_rls_stored_token_verification_pattern]]
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Build NewsletterSettings.tsx component + mount in SettingsPage</name>
  <files>src/components/dashboard/settings/NewsletterSettings.tsx, src/components/dashboard/settings/SettingsPage.tsx, src/components/dashboard/settings/__tests__/NewsletterSettings.test.tsx</files>
  <read_first>leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 11 Settings Page Newsletter Toggle + Copywriting Contract Settings section), leanshot/src/components/dashboard/settings/SettingsPage.tsx (existing Phase 54 push-notification section pattern), leanshot/src/components/ui (Toggle, Pill, Button primitives), leanshot/src/lib/store.ts (user selector pattern)</read_first>
  <behavior>
    - Test 1: Mounts with default state `opted_in: false` (when no subscription row exists) — toggle is OFF visually
    - Test 2: Mounts with `opted_in: true` (existing subscribed user) — toggle is ON; topic_tags Pills render selected state
    - Test 3: Toggling ON without selecting topics shows topic-tag multi-select with all kb_topics (fetched via `kb_topics` table); default 0 selected
    - Test 4: `Save preferences` button calls `setNewsletterOptIn({ optedIn: true, topicTags })` — assert mock invocation shape
    - Test 5: `Save preferences` after toggle OFF calls `setNewsletterOptIn({ optedIn: false })` WITHOUT topicTags (preserves)
    - Test 6: Loading state during save shows `aria-busy="true"` on Save button
    - Test 7: Save error renders inline error: "Couldn't save preferences. Try again."
    - Test 8: a11y — section heading is `<h2>`, toggle has `aria-pressed`, multi-select Pills have `role="checkbox"` with `aria-checked`
    - Test 9: ALL copy strings render from `t('rag.newsletter.*')` keys (mock i18n to assert lookups)
    - Test 10: Component file does NOT reference `unsubscribe_token` (grep gate inside test — read source file string, assert no match)
  </behavior>
  <action>
    Implement `src/components/dashboard/settings/NewsletterSettings.tsx`:
    - Section heading `<h2>` (18px / `text-lg` / 600 per UI-SPEC §Typography) — `t('rag.newsletter.section_heading')`.
    - Toggle row: Toggle primitive (existing `src/components/ui/Toggle.tsx` or `Switch.tsx`) with `aria-pressed`, label `t('rag.newsletter.toggle_label')`, sublabel `t('rag.newsletter.toggle_sublabel')` (13px / `text-sm` / 400 `text-text-secondary`).
    - Topic-tag multi-select: appears below toggle when `optedIn === true`. Uses existing `Pill` primitive `role="checkbox"` + `aria-checked`. Fetches kb_topics on mount (deduplicated from `kb_chunks.topic_tag` distinct values OR `kb_topics` table if 60-01 ships it — check 60-01 frontmatter; if neither, fall back to hardcoded `['glp-1', 'peptide-research', 'off-label-safety', 'metabolic-health']` and document follow-up).
    - `Save preferences` Button (accent primary) — calls `setNewsletterOptIn(...)` from `src/lib/rag/newsletter-api.ts`. Disabled while in-flight; `aria-busy="true"` during save.
    - Success: emit `useToast` success `"Saved"`; refetch subscription state.
    - Error: inline error text below button (13px / `text-sm` / `text-danger`); no toast.
    - **DEFAULT STATE: OFF when no subscription row exists.** Per CONTEXT.md D-26 + UI-SPEC §Critical UI Invariant #9 (CAN-SPAM affirmative opt-in OVERRIDES the legacy 50-09 `default ON for paid users` rule).
    - NO reference to `unsubscribe_token` anywhere (DB-server-only).

    Patch `src/components/dashboard/settings/SettingsPage.tsx`:
    - Import `NewsletterSettings` lazily (lazy() + Suspense per CLAUDE.md code-splitting convention).
    - Mount as a new section AFTER the existing Phase 54 push-notification-categories section. Use a section divider matching existing pattern.

    Implement vitest at `src/components/dashboard/settings/__tests__/NewsletterSettings.test.tsx`:
    - Use React Testing Library; mock `src/lib/rag/newsletter-api.ts` and `t()` helper.
    - Cover all 10 behavior cases.
    - For Test 10 (grep gate): `import { readFileSync } from 'node:fs'; const src = readFileSync(...); expect(src).not.toMatch(/unsubscribe_token/);`.

    Per [[reference_vitest_4_projects_config_masks_default]]: `npx vitest run --config vite.config.ts`.

    Color/typography guardrails per UI-SPEC §Typography: ONLY `text-micro`/`text-sm`/`text-lg`/`text-heading` (no `text-base`/`text-md`/`text-xl`/`text-2xl`); ONLY weight 400 + 600; ONLY semantic color tokens (no hex). Per [[feedback_negation_grep_defeated_by_comment_string]]: do NOT include rejected-alternative names like `text-base` in code comments.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/components/dashboard/settings/__tests__/NewsletterSettings.test.tsx && npm run typecheck</automated>
  </verify>
  <done>
    - `NewsletterSettings.tsx` renders per UI-SPEC §11 with default OFF
    - 10 vitest cases pass
    - SettingsPage.tsx mounts the new section after Phase 54 push-notification section
    - typecheck clean
    - No `text-base` / `text-md` / `text-xl` / `text-2xl` / `text-3xl` in component output (4-size ceiling per UI-SPEC §Critical UI Invariant #11)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Build NewsletterOptInStep.tsx + insert into OnboardingFlow</name>
  <files>src/components/onboarding/steps/NewsletterOptInStep.tsx, src/components/onboarding/OnboardingFlow.tsx</files>
  <read_first>leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 12 Onboarding Newsletter Checkbox + Copywriting Contract Onboarding section), leanshot/src/components/onboarding/OnboardingFlow.tsx (existing multi-step controlled-flow pattern from v1.4 Phase 59), leanshot/src/components/onboarding/steps (existing step components for shape conformance)</read_first>
  <behavior>
    - Test 1: Step mounts with checkbox UNCHECKED (default state) — CAN-SPAM affirmative opt-in invariant
    - Test 2: User checking the box updates parent onboarding state via `setState` callback
    - Test 3: Skipping the step (Next without checking) persists `newsletterOptIn = false` in onboarding state
    - Test 4: Checkbox has `aria-describedby` pointing to sublabel id
    - Test 5: Label copy matches `t('rag.newsletter.onboarding_label')` exactly
    - Test 6: OnboardingFlow on completion invokes `setNewsletterOptIn({ optedIn: state.newsletterOptIn, topicTags: [] })` ONLY IF `newsletterOptIn === true` (no DB write for the default-false case — avoids row spam)
    - Test 7: Step is INSERTED in the flow between personalization step and final review/submit step (assert step order in OnboardingFlow.tsx via snapshot test of step IDs array)
  </behavior>
  <action>
    Implement `src/components/onboarding/steps/NewsletterOptInStep.tsx`:
    - Standalone step component matching existing onboarding step contract: receives `{ state, setState, onNext, onBack }` props.
    - `<input type="checkbox" id="newsletter-opt-in">` — DEFAULT `checked={state.newsletterOptIn ?? false}`.
    - `<label htmlFor="newsletter-opt-in">` containing `t('rag.newsletter.onboarding_label')` (13px / `text-sm` / 400).
    - Sublabel `<p id="newsletter-opt-in-desc">` (11px / `text-micro` / 400 `text-text-tertiary`) — short explanation of newsletter content.
    - Checkbox `aria-describedby="newsletter-opt-in-desc"`.
    - `Continue` / `Back` buttons matching existing step navigation pattern (`onNext` / `onBack` props).
    - Step is OPTIONAL — user can `Continue` without checking (legitimate skip behavior; flow does not block).

    Patch `src/components/onboarding/OnboardingFlow.tsx`:
    - Add `newsletterOptIn: boolean` field to onboarding state shape (default `false`).
    - Insert `NewsletterOptInStep` in the step sequence AFTER the personalization step and BEFORE the final review/submit step (rationale: by personalization time, user has indicated interest; checkbox is part of the ready-to-start gesture).
    - On flow completion (existing handler that persists user profile): IF `state.newsletterOptIn === true`, additionally call `setNewsletterOptIn({ userId: newUserId, optedIn: true, topicTags: [] })` from `src/lib/rag/newsletter-api.ts`. Wrap in try/catch — failure here MUST NOT block onboarding completion (toast warn only).
    - If `state.newsletterOptIn === false` (the default and most common case), DO NOT make any DB write for newsletter_subscribers (DB default opted_in=false; no row needed until user opts in via Settings).

    Implement vitest at `src/components/onboarding/__tests__/NewsletterOptInStep.test.tsx` (combine with OnboardingFlow snapshot test in same file or new test file):
    - Cover 7 behavior cases.
    - For Test 7 (step order): snapshot the `steps` array IDs and assert position.

    Per CAN-SPAM § UI-SPEC §Critical UI Invariant #9: checkbox MUST be UNCHECKED by default everywhere it appears. Add a comment on the `defaultChecked={false}` (or `checked={state.newsletterOptIn ?? false}`) line: `// CAN-SPAM affirmative opt-in: MUST default unchecked.`
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts src/components/onboarding/__tests__/NewsletterOptInStep.test.tsx && npm run typecheck</automated>
  </verify>
  <done>
    - `NewsletterOptInStep.tsx` renders unchecked checkbox per UI-SPEC §12
    - OnboardingFlow.tsx inserts step between personalization and final-review
    - 7 vitest cases pass
    - typecheck clean
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Build rag-newsletter-sender Edge Fn + Resend HTML template + per-Fn deno.json</name>
  <files>supabase/functions/rag-newsletter-sender/index.ts, supabase/functions/rag-newsletter-sender/templates/rag-newsletter.html, supabase/functions/rag-newsletter-sender/deno.json, supabase/functions/rag-newsletter-sender/__tests__/sender.test.ts, supabase/functions/_shared/email-templates/rag-newsletter.html</files>
  <read_first>leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 13 Newsletter Email Template + Copywriting Contract Newsletter Email Template section verbatim), leanshot/.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-09-PLAN.md Task 2 (structural reuse), leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-02-shared-edge-helpers-PLAN.md (rag-retrieve.ts + posthog-rag-events.ts contracts), [[reference_supabase_functions_deploy_import_map_flag]], [[reference_deno_test_top_level_serve_trap]], [[reference_supabase_pg_cron_vault_service_role_pattern]] (cron invokes Fn with service_role_key bearer)</read_first>
  <behavior>
    - Test 1: GET /healthz returns 200 with `{ ok: true, fn: "rag-newsletter-sender" }`
    - Test 2: POST without service-role bearer returns 401 (T-60-12-09 mitigation)
    - Test 3: POST with valid bearer + zero opted-in subscribers returns `{ sent: 0, skipped: 0 }`
    - Test 4: POST with 3 opted-in subscribers + mocked rag-retrieve returning 4 chunks (3 newly-curated tier-A + 1 popular evergreen) per CONTEXT.md → fetches Resend 3 times (one per subscriber, NOT BCC per T-60-12-10) → updates last_sent_at for each → emits 3 PostHog `newsletter_sent` events
    - Test 5: Subscriber with `opted_in=true` BUT `last_sent_at` within 6 days is SKIPPED (idempotent re-cron protection)
    - Test 6: Email body MUST include `List-Unsubscribe: <https://{project}.functions.supabase.co/rag-newsletter-unsubscribe-1click?u={user_id}&t={token}>, <mailto:unsubscribe@leanshot.app>` AND `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058)
    - Test 7: Each subscriber's unsubscribe URL contains their stored `unsubscribe_token` from `newsletter_subscribers` (NOT a fresh HMAC mint — stored-token is the auth boundary per [[feedback_rls_stored_token_verification_pattern]]); HMAC envelope wraps the URL for tamper-evidence per Task 2 mint
    - Test 8: PHARMA-02 guardrail (per [[feedback_3_layer_must_never_invariant_pattern]]): mock a chunk with a dosing-number summary; assertPharma02Safe throws → chunk is SKIPPED from email body + alertSlack invoked + counter `pharma02_violations` incremented in response
    - Test 9: HTML template renders all template variables (admin_intro, per_topic_sections, footer_unsubscribe_url, footer_address); verbatim_quote + chunk_title + source_name are HTML-encoded (T-60-12-05 — `<script>foo</script>` in chunk_title appears in output as `&lt;script&gt;foo&lt;/script&gt;`)
    - Test 10: Subject line per UI-SPEC `LeanShot Research: Week of YYYY-MM-DD` — no `\r\n` injection possible (T-60-12-06)
    - Test 11: Cost telemetry — each successful send emits a `$ai_generation` PostHog event with `amount_usd: 0.0001, vendor: 'resend', action: 'newsletter_send'`
    - Test 12: Deno.serve guarded by `if (import.meta.main)` per [[reference_deno_test_top_level_serve_trap]] — test file imports handler function directly without triggering server
  </behavior>
  <action>
    Create `supabase/functions/rag-newsletter-sender/deno.json` (per-Fn import map per [[reference_supabase_functions_deploy_import_map_flag]] — CLI v2.101.0+ ignores --import-map flag):
    ```json
    {
      "imports": {
        "std/": "https://deno.land/std@0.224.0/",
        "shared/": "../_shared/",
        "@supabase/supabase-js": "npm:@supabase/supabase-js@2.45.0"
      }
    }
    ```

    Implement `supabase/functions/rag-newsletter-sender/index.ts`:
    - Export a named `handleNewsletterSend(req: Request): Promise<Response>` function (testable without Deno.serve).
    - Wrap with `if (import.meta.main) { Deno.serve(handleNewsletterSend); }` per [[reference_deno_test_top_level_serve_trap]].
    - GET /healthz → 200 `{ ok: true, fn: "rag-newsletter-sender" }`.
    - POST (any path) → require bearer = `SUPABASE_SERVICE_ROLE_KEY` (per [[reference_supabase_service_role_key_format_divergence]] use `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` direct compare via `constantTimeEqual` from Task 2; reject with 401 on mismatch).
    - Main flow:
      1. SELECT FROM `newsletter_subscribers` WHERE `opted_in = true` AND (`last_sent_at IS NULL` OR `last_sent_at < now() - interval '6 days'`).
      2. For each subscriber:
        a. For each `topic_tag` in `subscriber.topic_tags` (or default global retrieval if empty array), call `retrieveTopChunks({ topic_tag, tier: 'A', k: 3, newer_than_iso: <now - 7d> })` from `_shared/rag-retrieve.ts` (60-02).
        b. Also retrieve 1 popular evergreen chunk (use `ragRetrieve({ k: 1 })` without `newer_than_iso` filter; rank by retrieval count — implementation in 60-02 shared helper or fall back to recent-tier-A if popularity tracking not yet shipped, documented as follow-up).
        c. Filter chunks via `assertPharma02Safe(chunk.summary)` from existing runtime helper; SKIP violators + alertSlack via 60-02 helper (T-60-12-08 / [[feedback_3_layer_must_never_invariant_pattern]]).
        d. HTML-encode every user-facing string field (chunk_title, verbatim_quote, source_name) via a server-side sanitizer (Deno-runtime DOMPurify equivalent or hand-roll allowlist sanitizer — minimal: replace `<>&"'` with HTML entities; allowlist NO tags in chunk fields since they are plain-text data).
        e. Compose per-topic sections HTML from template strings (read template HTML from disk via `Deno.readTextFileSync(new URL('./templates/rag-newsletter.html', import.meta.url))` — embed into Fn bundle).
        f. Build URL: `${SUPABASE_URL}/functions/v1/rag-newsletter-unsubscribe-1click?u=${user_id}&t=${storedUnsubscribeToken}&h=${hmacEnvelope}` — `storedUnsubscribeToken` is the DB row value (per [[feedback_rls_stored_token_verification_pattern]] — stored-token is primary auth); `hmacEnvelope = await mintUnsubscribeToken({ userId, storedToken, signingKey: env.NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY })` per Task 2.
        g. Compose Resend payload:
        ```
        {
          from: "LeanShot Research <research@leanshot.app>",
          to: [subscriber.email],
          subject: t('rag.newsletter.subject_format', { date: weekISO }),
          html: substitutedTemplate,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@leanshot.app>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
          }
        }
        ```
        h. Strip `\r\n` from subject + from + to before fetch (T-60-12-06).
        i. POST to `https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}` (or via `_shared/email-router.ts` if present from Phase 22/25).
        j. On 200: UPDATE `newsletter_subscribers` SET `last_sent_at = now()` WHERE user_id = subscriber.user_id.
        k. `await captureRagEvent(subscriber.user_id, 'newsletter_sent', { topic_tags, chunk_count, week_iso: weekISO })` per 60-02 helper.
        l. Cost log: `await captureRagEvent(subscriber.user_id, '$ai_generation', { amount_usd: 0.0001, vendor: 'resend', action: 'newsletter_send' })`.
      3. Response: `{ sent: N, skipped: M, pharma02_violations: P }`.

    Implement Resend HTML template at `supabase/functions/rag-newsletter-sender/templates/rag-newsletter.html` (NOT the `_shared/email-templates/` path — Resend templates are per-Fn assets; the second `_shared/email-templates/rag-newsletter.html` path is a symlink-equivalent COPY for legacy email-router compatibility, since email-router from P22/25 looks under _shared/email-templates/):
    - Single-column, max-width 600px, light theme only per UI-SPEC §13.
    - Geist via Google Fonts `<link>` with Arial fallback.
    - Header: teal-700 background, white text, "LeanShot Research Digest" + "Week of {{week_date}}".
    - Body: `{{admin_intro}}` placeholder; `{{per_topic_sections}}` (composed HTML inserted by Fn).
    - Each chunk card: bordered, 12px radius, surface-card background; TierBadge as `<span>` with inline styles (no CSS classes — email-compatible) per UI-SPEC §13 TierBadge inline-style values verbatim; chunk title 18px/600; 1-line summary 13px/400; `Read at {{source_name}} ↗` CTA Button (32px height, teal-700 bg, white text, 8px radius).
    - 1 evergreen popular chunk section labeled `Popular this month`.
    - Footer: `Not medical advice — consult your clinician.` + Unsubscribe link + Manage preferences link + `LeanShot, [address per CAN-SPAM]` (CONTEXT.md placeholder — replace with actual address once available; document in plan SUMMARY).

    Implement Deno test at `supabase/functions/rag-newsletter-sender/__tests__/sender.test.ts`:
    - Import `handleNewsletterSend` directly (NOT via Deno.serve — per [[reference_deno_test_top_level_serve_trap]] `import.meta.main` guard prevents server bind).
    - Mock fetch for Resend API (use `globalThis.fetch = ...` stub).
    - Mock `_shared/rag-retrieve.ts` and `_shared/posthog-rag-events.ts` and `_shared/slack-guardrail-alert.ts` via dependency injection or import-map override.
    - Cover all 12 behavior cases.
    - Run via `$HOME/.deno/bin/deno test --no-check supabase/functions/rag-newsletter-sender/__tests__/sender.test.ts`.

    Per CONTEXT.md i18n: subject + intro placeholder string `LeanShot Research: Week of {date}` is EN-only; t() lookup falls back to EN per Phase 58 wiring.

    DO NOT register cron schedule in this plan — cron migration lands in 60-15 per [[feedback_fn_deploy_before_cron_db_push]]. DO NOT run `supabase functions deploy` in this plan — atomic deploy in 60-15.
  </action>
  <verify>
    <automated>$HOME/.deno/bin/deno test --no-check supabase/functions/rag-newsletter-sender/__tests__/sender.test.ts && $HOME/.deno/bin/deno check --no-config supabase/functions/rag-newsletter-sender/index.ts</automated>
  </verify>
  <done>
    - `rag-newsletter-sender/index.ts` exports handleNewsletterSend with import.meta.main guard
    - per-Fn `deno.json` import map present
    - `templates/rag-newsletter.html` matches UI-SPEC §13 (single-column 600px, inline-style TierBadge values verbatim)
    - 12 Deno test cases pass
    - `_shared/email-templates/rag-newsletter.html` exists (copy/symlink for email-router compatibility — actual path resolves whichever email-router uses)
    - No cron schedule in any file under this plan (60-15 owns)
    - No `supabase functions deploy` invocation in any file under this plan (60-15 owns)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Build rag-newsletter-unsubscribe-1click Edge Fn (RFC 8058 POST + GET fallback)</name>
  <files>supabase/functions/rag-newsletter-unsubscribe-1click/index.ts, supabase/functions/rag-newsletter-unsubscribe-1click/deno.json, supabase/functions/rag-newsletter-unsubscribe-1click/__tests__/unsubscribe.test.ts</files>
  <read_first>supabase/functions/_shared/newsletter-token.ts (Task 2 mint/verify), [[feedback_rls_stored_token_verification_pattern]] in CONTEXT.md, [[reference_postgres_no_insert_on_conflict_do_delete]] (for atomic compare-and-update pattern), RFC 8058 §3.1 (one-click POST semantics)</read_first>
  <behavior>
    - Test 1: GET /healthz returns 200 with `{ ok: true, fn: "rag-newsletter-unsubscribe-1click" }`
    - Test 2: POST with valid `u` (user_id) + `t` (stored token from DB) → flips `opted_in=false`, sets `opted_out_at=now()`, ROTATES `unsubscribe_token` (atomic single SQL statement per T-60-12-02 mitigation), returns 200 (RFC 8058 requires 200 on success, NOT 302)
    - Test 3: POST with mismatched token → 400 generic error (no token-shape leak in body per T-60-12-01)
    - Test 4: POST with valid `u` but missing `t` → 400
    - Test 5: POST with HMAC envelope `h` parameter present AND mismatched → 400 (defense-in-depth)
    - Test 6: POST with HMAC envelope `h` present AND matching → proceed (HMAC is additional layer, not primary)
    - Test 7: GET with same params → renders success HTML page with "You're unsubscribed. [Resubscribe]" link (returns `Content-Type: text/html`); same DB write occurs (GET fallback for manual click)
    - Test 8: Replay attack — POST again after successful unsubscribe (token already rotated) → 400 (stale token rejected)
    - Test 9: `constantTimeEqual` used for token comparison (NOT `===`) — assert by code inspection: `expect(srcFile).toMatch(/constantTimeEqual/)` and `expect(srcFile).not.toMatch(/token\s*===\s*/)`
    - Test 10: PostHog `newsletter_unsubscribed` event emitted server-side via `_shared/posthog-rag-events.ts` (60-02), distinct_id = user_id (NOT `'rag-system'`)
    - Test 11: Idempotency — repeat POST of valid-but-already-flipped user (somehow same token survived rotation): no-op + still 200
    - Test 12: Deno.serve guarded by `if (import.meta.main)` per [[reference_deno_test_top_level_serve_trap]]
    - Test 13: Anon SELECT RLS pattern (per [[feedback_rls_stored_token_verification_pattern]]) — Fn uses anon-client SELECT to fetch stored token; only service-role UPDATE rotates row; both gated by user_id
  </behavior>
  <action>
    Create `supabase/functions/rag-newsletter-unsubscribe-1click/deno.json` matching Task 5 pattern.

    Implement `supabase/functions/rag-newsletter-unsubscribe-1click/index.ts`:
    - Export `handleUnsubscribe(req: Request): Promise<Response>`.
    - `if (import.meta.main) { Deno.serve(handleUnsubscribe); }`.
    - GET /healthz → 200 `{ ok: true, fn: "rag-newsletter-unsubscribe-1click" }`.
    - POST OR GET (RFC 8058 POST is mandatory; GET is fallback UX path for direct browser-clicks from email):
      1. Parse `u` (user_id), `t` (stored token from URL), optional `h` (HMAC envelope) from URL query (both POST + GET).
      2. SELECT `unsubscribe_token` FROM `newsletter_subscribers` WHERE `user_id = u` — anon-client (anon SELECT RLS allows token+opted_in read by user_id key per 60-01 RLS policy). If no row → return 400 generic.
      3. `if (!constantTimeEqual(storedToken, presentedToken)) return 400 generic` per T-60-12-01.
      4. If `h` (HMAC envelope) present: `if (!await verifyUnsubscribeToken({ userId: u, storedToken, signingKey: env.NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY, presentedToken: h })) return 400 generic` (T-60-12-02 defense-in-depth).
      5. Atomic compare-and-update via service-role client (single SQL statement to prevent race + replay):
      ```sql
      UPDATE newsletter_subscribers
        SET opted_in = false,
            opted_out_at = now(),
            unsubscribe_token = encode(gen_random_bytes(32), 'base64'),
            updated_at = now()
        WHERE user_id = $1
          AND unsubscribe_token = $2  -- redundant but ensures atomicity under concurrent unsubscribe attempts
        RETURNING user_id;
      ```
      Note: redundant token-compare in WHERE is intentional — if a concurrent request already rotated the token, this UPDATE no-ops and returns 0 rows. Treat 0-row result as success-idempotent (T-60-12-11) — user is unsubscribed regardless.
      6. `await captureRagEvent(user_id, 'newsletter_unsubscribed', { via: req.method === 'POST' ? 'one-click' : 'manual-click' })` per 60-02 helper.
      7. Response by method:
        - POST: 200 with empty body (RFC 8058 — Gmail/Apple Mail expect 200, NOT 302).
        - GET: 200 with `Content-Type: text/html` rendering inline HTML success page: `<html><body><h1>You're unsubscribed.</h1><a href="/settings#notifications">Resubscribe</a></body></html>` (per UI-SPEC §Copywriting Contract `Unsubscribe success page` copy).
    - No JWT/auth required for POST or GET — token IS the credential per RFC 8058 § "must not require user-side authentication".

    Implement Deno test at `supabase/functions/rag-newsletter-unsubscribe-1click/__tests__/unsubscribe.test.ts`:
    - Import `handleUnsubscribe` directly (no Deno.serve trigger per [[reference_deno_test_top_level_serve_trap]]).
    - Mock Supabase client (anon SELECT + service-role UPDATE).
    - Mock `_shared/posthog-rag-events.ts`.
    - Cover all 13 behavior cases.
    - Test 9 specifically: `const src = await Deno.readTextFile('supabase/functions/rag-newsletter-unsubscribe-1click/index.ts'); assert(src.includes('constantTimeEqual')); assertEquals(src.match(/token\s*===\s*/g), null);` per [[feedback_negation_grep_defeated_by_comment_string]] — ensure no rejected-alternative naming in comments.

    Per CONTEXT.md: Fn deploys in 60-15, NOT this plan.
  </action>
  <verify>
    <automated>$HOME/.deno/bin/deno test --no-check supabase/functions/rag-newsletter-unsubscribe-1click/__tests__/unsubscribe.test.ts && $HOME/.deno/bin/deno check --no-config supabase/functions/rag-newsletter-unsubscribe-1click/index.ts</automated>
  </verify>
  <done>
    - `rag-newsletter-unsubscribe-1click/index.ts` implements RFC 8058 POST + GET fallback with stored-token + constantTimeEqual + atomic rotation
    - per-Fn `deno.json` import map present
    - 13 Deno test cases pass
    - No `token === ` or `presentedToken === ` patterns anywhere in source (only `constantTimeEqual`)
    - No `supabase functions deploy` invocation (60-15 owns)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 7: Playwright onboarding opt-in E2E + Phase 60 source-audit verification</name>
  <files>tests/e2e/newsletter-opt-in.spec.ts</files>
  <read_first>leanshot/tests/e2e (existing Playwright config + onboarding helpers), leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surfaces 11 + 12 contracts), [[reference_zustand_persisted_user_blocks_marketing_uat]]</read_first>
  <behavior>
    - Test 1: Fresh user (localStorage.leanshot_v4 cleared per [[reference_zustand_persisted_user_blocks_marketing_uat]]) reaches onboarding NewsletterOptInStep; checkbox is UNCHECKED on first paint
    - Test 2: User skips checkbox + completes onboarding → no `newsletter_subscribers` row exists for user (verified via test-DB query helper); user lands on dashboard
    - Test 3: User checks checkbox + completes onboarding → `newsletter_subscribers` row exists with `opted_in=true, opted_in_at IS NOT NULL`
    - Test 4: Onboarded user navigates to Settings → NewsletterSettings section is rendered; toggle reflects DB state from onboarding choice
    - Test 5: User toggles OFF in Settings + saves → DB row `opted_in=false, opted_out_at IS NOT NULL`
    - Test 6: a11y — Playwright axe-core scan on Settings + Onboarding step pages reports no a11y violations in the new surfaces
    - Test 7: Visual snapshot of NewsletterSettings (existing user; toggle ON) — for VR regression
  </behavior>
  <action>
    Implement Playwright E2E at `tests/e2e/newsletter-opt-in.spec.ts`:
    - Test gate via env var: `PLAYWRIGHT_RUN_P60_NEWSLETTER_OPTIN=1` (matches established Phase 50/55+ gate pattern).
    - Use existing Playwright config + test-DB seeding helpers (or document inline if not present per [[feedback_handoff_doc_with_embedded_discoveries]]).
    - Before each: clear localStorage `leanshot_v4` + signed-out state per [[reference_zustand_persisted_user_blocks_marketing_uat]].
    - Cover all 7 behavior cases above.
    - For Test 6 (a11y), use `@axe-core/playwright` (verify in package.json — if not present, document as follow-up and use basic role/aria attribute assertions instead).
    - For Test 7 (visual snapshot), use Playwright's `toHaveScreenshot()` with project-standard threshold.

    Source-audit verification (per `<scope_reduction_prohibition>` block in planner instructions): create an inline test assertion at the END of the spec file:
    ```
    test('Phase 60 RAG-08 source-audit: all source items covered', async () => {
      // GOAL: weekly Resend newsletter capability (ROADMAP RAG-08)
      // REQ: RAG-08 (weekly Resend newsletter; opt-in; 1-click unsubscribe RFC 8058)
      // CONTEXT.md decisions: Sunday 9am ET, top-3 tier-A 7d + 1 popular + admin intro, RFC 8058, default OFF CAN-SPAM, EN-only MVP
      // RESEARCH: stored-token RLS pattern, per-Fn deno.json, import.meta.main guard
      // Plan must_haves enumerate all 12 truths above.
      // This assertion is a documentary checkpoint — passes by reaching this line.
      expect(true).toBe(true);
    });
    ```

    Run via `cd leanshot && PLAYWRIGHT_RUN_P60_NEWSLETTER_OPTIN=1 npx playwright test tests/e2e/newsletter-opt-in.spec.ts` (gate-enabled).
  </action>
  <verify>
    <automated>cd leanshot && PLAYWRIGHT_RUN_P60_NEWSLETTER_OPTIN=1 npx playwright test tests/e2e/newsletter-opt-in.spec.ts --reporter=line</automated>
  </verify>
  <done>
    - 7 Playwright cases pass under gate `PLAYWRIGHT_RUN_P60_NEWSLETTER_OPTIN=1`
    - Source-audit assertion passes (covers RAG-08 + CONTEXT.md newsletter decisions)
    - Visual snapshot baseline established
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 8: Cross-cutting verification — typecheck + lint + 4-size typography gate + no-deploy assertion</name>
  <files>(no new files; verification-only task)</files>
  <read_first>leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Critical UI Invariant #11 — 4-size ceiling), all files modified in Tasks 1-7</read_first>
  <behavior>
    - Test 1: `npm run typecheck` passes (strict mode, no any leak)
    - Test 2: `npm run lint` passes for all files modified in this plan
    - Test 3: 4-size typography gate — grep `src/components/dashboard/settings/NewsletterSettings.tsx` + `src/components/onboarding/steps/NewsletterOptInStep.tsx` for `text-base|text-md|text-xl|text-2xl|text-3xl` patterns: zero matches (filter comments per [[feedback_negation_grep_defeated_by_comment_string]])
    - Test 4: No-deploy assertion — grep all files modified in this plan for `supabase functions deploy`: zero matches (60-15 owns deploy per [[feedback_fn_deploy_before_cron_db_push]])
    - Test 5: No-cron-in-this-plan assertion — grep for `cron.schedule|pg_cron|net.http_post.*rag-newsletter`: zero matches (60-15 owns cron registration)
    - Test 6: Vendor secret pre-flight verification per [[feedback_vendor_secret_preflight_surface]] — orchestrator confirms `supabase secrets list --project-ref <ref>` includes `RESEND_API_KEY` AND `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY` BEFORE execute dispatch; this plan's pre-execute checkpoint documents the verification command for the operator
    - Test 7: Reuse audit — `rag-newsletter-sender/index.ts` + `rag-newsletter-unsubscribe-1click/index.ts` reference 50-09 Tasks 2-3 structural patterns (per outline reuse target); cross-grep that signing-key/HMAC + stored-token-compare pattern was NOT copy-pasted from 50-09 token-compare-via-`===` (which is the 50-09 pattern this plan replaces — 50-09 used `===` token compare which is the divergence point this plan corrects per [[feedback_rls_stored_token_verification_pattern]])
  </behavior>
  <action>
    Run verification commands per behavior list. Output a Markdown table in the task completion log:

    | Check | Command | Result |
    |---|---|---|
    | typecheck | `cd leanshot && npm run typecheck` | pass/fail |
    | lint | `cd leanshot && npm run lint -- <files>` | pass/fail |
    | 4-size gate | `grep -nE 'text-base\|text-md\|text-xl\|text-2xl\|text-3xl' src/components/dashboard/settings/NewsletterSettings.tsx src/components/onboarding/steps/NewsletterOptInStep.tsx \| grep -v '^.*://'` | 0 matches |
    | no-deploy | `grep -rn 'supabase functions deploy' supabase/functions/rag-newsletter-sender supabase/functions/rag-newsletter-unsubscribe-1click \|\| true` | 0 matches |
    | no-cron | `grep -rnE 'cron\.schedule\|pg_cron\|net\.http_post.*rag-newsletter' supabase/functions/rag-newsletter-sender supabase/functions/rag-newsletter-unsubscribe-1click supabase/migrations \|\| true` | 0 matches in this plan's files (60-15 owns) |
    | secret pre-flight | `supabase secrets list --project-ref <ref> \| grep -E 'RESEND_API_KEY\|NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY'` | both present |
    | reuse audit | `grep -c 'constantTimeEqual' supabase/functions/rag-newsletter-unsubscribe-1click/index.ts` | ≥1 |

    Per [[feedback_validation_md_inline_generation_when_missing]]: this task's verification output is the inline VALIDATION.md source for plan-checker — no separate file generation required.

    If any check fails: STOP execution, surface failure to orchestrator, do NOT mark plan complete.
  </action>
  <verify>
    <automated>cd leanshot && npm run typecheck && npm run lint -- src/components/dashboard/settings/NewsletterSettings.tsx src/components/onboarding/steps/NewsletterOptInStep.tsx src/lib/rag/newsletter-api.ts && bash -c 'set -e; ! grep -nE "text-base|text-md|text-xl|text-2xl|text-3xl" src/components/dashboard/settings/NewsletterSettings.tsx src/components/onboarding/steps/NewsletterOptInStep.tsx | grep -v "^.*://" ; ! grep -rn "supabase functions deploy" supabase/functions/rag-newsletter-sender supabase/functions/rag-newsletter-unsubscribe-1click ; ! grep -rnE "cron\.schedule|pg_cron" supabase/functions/rag-newsletter-sender supabase/functions/rag-newsletter-unsubscribe-1click'</automated>
  </verify>
  <done>
    - All 7 checks pass
    - typecheck + lint green
    - 4-size typography ceiling enforced (zero `text-base/md/xl/2xl/3xl` in modified components)
    - Zero `supabase functions deploy` invocations in this plan's source (60-15 owns)
    - Zero cron registrations in this plan's source (60-15 owns)
    - Vendor secrets pre-flighted by operator before execute
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 9: Phase-60 source-audit + plan summary stub</name>
  <files>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-12-SUMMARY.md</files>
  <read_first>$HOME/.claude/get-shit-done/templates/summary.md, all files modified in Tasks 1-8</read_first>
  <behavior>
    - Test 1: SUMMARY.md exists with frontmatter: phase, plan, requirements (RAG-08), files_created, files_modified, tests_added, tests_passing, follow_ups
    - Test 2: SUMMARY references each must_haves truth from frontmatter and notes verification disposition
    - Test 3: Documents the legacy 50-09 token-`===`-compare → 60-12 stored-token-`constantTimeEqual` divergence per [[feedback_rls_stored_token_verification_pattern]]
    - Test 4: Documents the default-OFF override of legacy 50-09 D-26 `default ON for paid users` rule per UI-SPEC §Critical UI Invariant #9 CAN-SPAM affirmative opt-in
    - Test 5: Captures follow-ups: (a) ES newsletter locale (v1.5); (b) auto-pause behavior on Resend rate-limit (Phase 67 OPS-08); (c) Resend webhook → PostHog newsletter_opened wiring (60-15 close-out); (d) CAN-SPAM physical address placeholder replacement before first live send; (e) Phase 60-15 owns Fn deploy + cron registration + atomic db push
  </behavior>
  <action>
    Per `<output>` execution contract in plan template, create the SUMMARY stub. Do NOT mark as final — final SUMMARY content is filled in by gsd-executor at task completion per template at `$HOME/.claude/get-shit-done/templates/summary.md`.

    Pre-populate frontmatter shell:
    ```yaml
    ---
    phase: 60-rag-knowledge-base-completion-waves-2-4
    plan: 12
    completed: <date>
    requirements: [RAG-08]
    files_created: [<list>]
    files_modified: [<list>]
    tests_added: [<count + paths>]
    tests_passing: [<status>]
    deploy_status: deferred-to-60-15
    cron_status: deferred-to-60-15
    follow_ups:
      - "Phase 60-15: deploy rag-newsletter-sender + rag-newsletter-unsubscribe-1click + register weekly Sunday 09:00 ET cron per [[reference_supabase_pg_cron_vault_service_role_pattern]]"
      - "Phase 60-15: Resend webhook → PostHog newsletter_opened event ingestion"
      - "v1.5: Spanish newsletter locale + translated HTML template (gated on Phase 58 contractor expansion)"
      - "Pre-first-live-send: replace CAN-SPAM physical-address placeholder in footer template with actual address"
      - "Phase 67 OPS-08: Edge Middleware rate-limit for unsubscribe-1click (residual T-60-12-08 risk)"
    ---
    ```

    Body content: divergences-from-50-09, decision-record (default-OFF override + stored-token-compare upgrade), key links exercised, verification disposition per must_haves truth.
  </action>
  <verify>
    <automated>test -f leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-12-SUMMARY.md && grep -q "RAG-08" leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-12-SUMMARY.md && grep -q "deferred-to-60-15" leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-12-SUMMARY.md</automated>
  </verify>
  <done>
    - SUMMARY.md exists with frontmatter referencing RAG-08
    - Follow-ups documented (5 items per behavior Test 5)
    - Divergence-from-50-09 documented (token-compare upgrade + default-OFF CAN-SPAM)
  </done>
</task>

</tasks>

<verification>
- Vitest suites (Tasks 1, 3, 4): all green via `npx vitest run --config vite.config.ts`
- Deno tests (Tasks 2, 5, 6): all green via `$HOME/.deno/bin/deno test --no-check`
- Playwright E2E (Task 7): green under gate `PLAYWRIGHT_RUN_P60_NEWSLETTER_OPTIN=1`
- Cross-cutting verification (Task 8): typecheck + lint + 4-size gate + no-deploy + no-cron + secret pre-flight all pass
- Source audit (Task 9): SUMMARY.md records RAG-08 closure for plan boundary; 60-15 inherits Fn deploy + cron registration
- No-net-new regression: tsc baseline matches pre-plan + run `npx vitest run` with `--changed` flag is acceptable per STATE.md sequential-on-main flakiness lesson; full-suite check is FLAKY and gated by own-tests-pass + no-net-new-failures
</verification>

<success_criteria>
- RAG-08 closed at plan boundary: sender Fn + unsubscribe-1click Fn + Settings toggle + onboarding checkbox + Resend template + locale strings + tests
- CAN-SPAM affirmative opt-in enforced (default OFF in DB + UI in 2 surfaces; vitest assertions guard against regression)
- RFC 8058 compliance: `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers; POST handler returns 200; stored-token-and-constant-time-compare auth path (NOT `===`)
- PHARMA-02 carveout enforced in newsletter body composition (3-layer invariant + Slack alert on violation)
- Source audit clean: all 4 source-types (GOAL/REQ/RESEARCH/CONTEXT) covered; no scope reduction; no "v1/v2/placeholder/static-for-now" language anywhere
- 60-15 deploy + cron prerequisites met: per-Fn `deno.json` import maps in place; Fn source ready for atomic deploy; cron migration NOT shipped in this plan
- Vendor secrets `RESEND_API_KEY` + `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY` confirmed present in `supabase secrets list` BEFORE Wave 3 dispatch (operator-side pre-flight)
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-12-SUMMARY.md` per Task 9 when plan completes (executor finalizes content; this plan only ships the stub).
</output>
