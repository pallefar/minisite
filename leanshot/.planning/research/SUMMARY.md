# Project Research Summary — LeanShot v1.3 Platform Expansion

**Project:** LeanShot (v1.3 megamilestone)
**Domain:** Mature multi-audience consumer-health SaaS (GLP-1 vertical) — shipped v1.2 — adding revenue/growth optimization, B2B clinic depth, HIPAA BAA chain, content depth (i18n + embeds + pharma test), retention engine (onboarding + gamification + reviews + helpdesk + AI personalization partial), and ad-spend ETL
**Researched:** 2026-05-17
**Confidence:** HIGH on stack versions + HIPAA BAA matrix + platform-store policy; MEDIUM on multi-tenant org schema + Resend BAA status + conversion-tactic specifics; LOW on cross-network ad-spend deduplication precision + Helpdesk Resend Inbound spam protection

---

## Executive Summary

v1.3 is a **triple-bet platform expansion** layered onto the v1.2-shipped product: (a) revenue-optimization (multi-tier affiliate + mid-trial paywall A/B + page-builder A/B + hourly cross-network ad ETL), (b) B2B + HIPAA (clinic organizations with per-patient metered billing + signed BAA chain across Supabase/Vercel/Sentry/Anthropic/Resend-or-SES/PostHog), and (c) consumer depth + retention engine (Spanish i18n + embed-provider blocks + pharma paywall + onboarding overhaul + gamification + two-stage reviews + helpdesk + pgvector recommender + cancellation save-offers + status page). The architecture explicitly does NOT redesign — it **extends** the v1.2 Zustand/Supabase/Vercel stack, adding a NEW org-context layer in `src/lib/org.ts` and a second tenancy axis (`org_id`) on top of the existing `user_id` RLS isolation.

The recommended approach is **foundation-first** then **parallel-track three workstreams**: Phase 24 ships the canonical event taxonomy + server-side PostHog capture + modular admin shell + admin 2FA — this is load-bearing for nearly every downstream measurement (paywall A/B attribution, M3 review-prompt routing, M5b recommender activation, M6 helpdesk routing). HIPAA legal/vendor negotiation runs in **PARALLEL with engineering from Wave 0** (4-8 weeks of vendor/contract work); engineering deliverables for HIPAA are audit-log hardening, MFA enforcement, route-level Sentry mask declarations, PostHog PII regex scrub, and the per-org cross-tenant impersonation proof tests. **Aggressive on end-user UX** (onboarding, gamification, helpdesk, embeds, i18n); **cheapest defensible posture on regulator/process surfaces** (HIPAA BAA chain, admin permissions). Mobile shells stay deferred to v1.4 per user direction.

Key risks are catastrophic-tail (HIPAA BAA chain breakage → 18-month-latent audit finding; Google Play review-gating violation → app suspension; multi-tenant org_id leak → cross-clinic data exposure; page-builder A/B canonical omission → SEO de-indexing; ad ETL silent-drop → broken CAC decisions). All five are LANDMINE-class (silent failures surfacing weeks-to-quarters later). Mitigations are baked into the suggested phase structure below: runtime BAA-scope guard + monthly subprocessor diff cron (Phase 25); native review prompt fires unconditionally + internal NPS routes to helpdesk independently (Phase 36); per-org cross-tenant proof tests + service_role `withOrgScope` wrapper + HMAC realtime channels (Phases 28-30); canonical link + 42-day variant cap (Phase 39); idempotent last-72h re-sync + normalized-attribution view + AEM priority register (Phase 33).

---

## Key Findings

### Recommended Stack

**Continuity rule:** Everything in v1.2 stays (React 19 + Vite 6 + TS strict + Tailwind v4 + Zustand + Supabase + Stripe + Anthropic via AI Gateway + Resend + Sentry + PostHog + Vercel + chart.js + framer-motion + dnd-kit + Capacitor 8). v1.3 is net-new ADDITIVE only.

**Core net-new technologies:**
- **react-i18next 15.7.4 + i18next 25.5.2 + i18next-http-backend** — Spanish i18n via `Accept-Language` + lazy-loaded `/locales/{lng}/{ns}.json` chunks (NOT eager-bundled JSON imports); critical: use HTTP backend NOT Vite static-import for language packs
- **posthog-node 5.10.4** (via Deno `npm:` specifier in Edge Functions) — server-side capture for signup/payment/activation events that adblockers eat (~30-40% of browser-side events); MUST call `await client.shutdown()` before Edge Function return
- **pgvector** (already available on Supabase Pro) — embeddings storage + cosine similarity for AI recommender; HNSW index; `vector(1536)` matches OpenAI `text-embedding-3-small`
- **openai 6.13.0** routed via Vercel AI Gateway (same posture as v1.2 Anthropic proxy) — embeddings only, not chat
- **@tanstack/react-query 5.x + react-table 8.x + react-virtual 3.x** — server-state for v1.3's admin-heavy surfaces; admin-route-gated lazy chunks
- **react-markdown 9.x + remark-gfm 4.x + rehype-sanitize + dompurify 3.2.7** — KB articles + helpdesk message rendering; XSS-safe
- **canvas-confetti 1.9.3** — gamification level-up bursts; imperative API
- **Resend Inbound** — email-to-ticket ingest (reuse existing `app.leanshot.app` domain with new `support@` MX); reply-threading via HMAC token in `Reply-To`
- **Better Stack** ($12/mo) — public status page on `status.leanshot.app`
- **Meta Marketing SDK 24.x + google-ads-api 23.x + hand-rolled TikTok REST fetch** — hourly ad-spend ETL Edge Functions
- **AWS SES** (Deno `npm:` via `@aws-sdk/client-sesv2`) — HIPAA-eligible email path, conditional on Resend BAA gap

**Bundle posture:** `sync-defer.ts` MANDATORY for v1.3 heavies; new per-chunk ceilings to add at Phase 24: admin-shell 30 kB gz, helpdesk-widget 25 kB gz, i18n-runtime 15 kB gz, gamification-burst 8 kB gz.

**HIPAA tier-upgrade cost when chain activates: ~$1,864-4,364/mo additional** (Supabase Pro→Team+addon $924, Vercel Pro+addon $350, Sentry Business $80, Anthropic Enterprise custom $500-2K, optional PostHog Boost $0 or $2K, AWS SES ~$10). Input to first-clinic-deal price-floor conversation.

### Expected Features

**Must have (table stakes):**
- Modular admin shell + bulk actions + admin 2FA enforcement
- Canonical event taxonomy + server-side PostHog capture
- Multi-tier affiliate (Standard/Gold/Lifetime) with `tier_at_conversion_time` stamping
- Mid-trial paywall A/B test triggered on activation event
- Hourly ad-spend ETL (Meta + Google + TikTok) joined with PostHog for true CAC
- Clinic `organizations` + `org_members` + `org_subscriptions` + per-patient metered billing
- HIPAA BAA chain signed across 6 critical vendors
- Spanish i18n infrastructure (UI strings + transactional emails + KB articles)
- M2 onboarding overhaul with magic link + Google + Apple SSO + activation event
- M3 gamification engine (ethical-only patterns)
- M6 helpdesk core (tickets + Resend Inbound + AI assist + CSAT + KB)

**Should have (differentiators):**
- Page-builder A/B (per-block variant overrides + canonical-link + 42-day cap)
- Two-stage NPS-then-review prompt (web only at v1.3; native to v1.4)
- pgvector AI personalization recommender + weekly Claude summary email
- Cancellation save-offers flow
- Public status page (Better Stack)
- Custom rank weights + dose-trend clinician alerts (deferred from v1.2)
- Embed-provider blocks (Calendly + YouTube + Tally with sandboxing + consent gating)
- Pharmacology paywall test (with "what stays free on principle" carve-out)
- Cohort builder in admin
- Admin command palette (Cmd+K)

**Defer (v1.4+):**
- Mobile shells (P16) + push (P17) + HealthKit (P18) + AdMob (P20) + Watch (P21) — v1.4
- M3 native SKStoreReviewController / Play in-app review — depends on P16 — v1.4
- M4 Membership/Community — v1.5
- M5b full AI personalization (anomaly detection + churn model) — v1.5
- M6 App Store/Play review ingestion — depends on store presence — v1.4
- Subdomain white-label `acme.leanshot.app` — v1.5 (v1.3 ships path-based only)
- i18n `/es/` path prefix — v1.3 uses `?lang=es` query (avoids Vercel rewrite doubling)
- Monorepo refactor (Turborepo) — v1.4

**Anti-features:**
- Per-admin custom permission matrix (keep fixed 3-role)
- Multi-level affiliate (MLM)
- Bandit auto-traffic-shifting A/B
- Sub-hourly ad cron
- HealthKit data into ad attribution (two-tunnel firewall)
- Ads on clinic/doctor-share/admin (EVER)
- Paywall on pharmacology projection OR drug interaction safety
- Stripe `metadata`/`description` containing PHI keywords
- Native review prompt gated by NPS score (App/Play violation)
- Session-replay autocapture on PHI routes

### Architecture Approach

v1.3 is an **EXTENSION** of v1.2, not a rewrite. A new **org-context layer** (`src/lib/org.ts`) inserts between Zustand and supabase-js — detecting current org via path/subdomain/member.org_id, injecting `org_id` into every query, providing surface-check, overlaying white-label theme tokens.

**Major components:**
1. **Org context layer (NEW)** — `src/lib/org.ts` + Zustand slices for `org`, `orgMembership`, `orgSettings`
2. **Multi-tenant Supabase schema (NEW, largest slab)** — 12+ org-scoped tables gated by NEW JWT custom claim `app_metadata.org_ids` (336ms propagation window — UI loading state required)
3. **Event taxonomy + server-side PostHog (NEW foundation)** — `src/lib/analytics/events.ts` + `_shared/posthog-server.ts`
4. **Multi-tier affiliate extension** — ALTER + `affiliate_tiers` + `affiliate_tier_history` + tier-stamping
5. **Ad ETL pipeline (NEW)** — 3 Edge Fns + `ad_spend_facts` partitioned-by-month + separate daily gap-detection cron
6. **HIPAA compliance layer (NEW, cross-cutting)** — runtime BAA-scope guard + `withOrgScope` wrapper + Sentry/PostHog masking + audit-log hardening + MFA
7. **Helpdesk (NEW)** — `tickets` + `ticket_messages` + `kb_articles` ({slug, locale}) + `csat_responses` + Resend Inbound webhook + HMAC reply-threading
8. **pgvector recommender (NEW)** — `content_embeddings vector(1536)` + HNSW (or IVFFlat — decision deferred) + OpenAI via AI Gateway
9. **Gamification engine (NEW)** — append-only `xp_ledger` + `streak_state` + `freeze_tokens_ledger` + `leaderboard_entries` (matview, pg_cron 15-min refresh)
10. **Onboarding builder + A/B (NEW)** — `onboarding_flows/steps/variants/responses` + `activation_events`
11. **i18n runtime + locale overrides (NEW)** — file-based `/locales/{lng}/{ns}.json` + admin-editable `locale_overrides`
12. **Cancellation save-offers (NEW)**
13. **Better Stack status page (NEW)**

**Key patterns:**
- Every NEW org-scoped table gets a live cross-tenant impersonation proof test (project rule extended from `user_id` to `org_id` axis)
- `admin.generateLink + plain fetch /auth/v1/verify` for test auth fixtures
- Per-file slug prefix in RLS test suites (vitest file-parallelism)
- `tier_effective` view is canonical (do NOT invent parallel tier table)
- Vendor-gated send via health check (Resend domain)
- Status-machine transition ownership rule (P19 BL-11)
- Parallel executors use `git commit -- <pathspec>` OR worktrees
- Supabase migration filenames strict `<14-digits>_name.sql` — NEVER letter-suffix

### Critical Pitfalls (Watch Out For)

1. **App/Play rating-prompt gating (V13-3)** — Google Play prohibits "two-stage NPS → conditional native prompt"; Apple expulsion risk. **Safe pattern:** native prompt fires UNCONDITIONALLY on positive moments; internal NPS is INDEPENDENT surface routing to M6 helpdesk. Plan-checker BLOCKER on conditional native-prompt code.

2. **HIPAA BAA chain breakage (V13-1)** — Anthropic BAA excludes Workbench/Console/Cowork/beta; ZDR separately negotiated. **Mitigations:** runtime allowlist guard in AI-proxy + weekly subprocessor-diff cron + `vendor_baa_chain` expiry calendar + eslint `no-restricted-imports` on Anthropic beta endpoints + Stripe PHI-keyword CI lint (Stripe will NEVER sign BAA).

3. **Clinic multi-tenancy 4 leak vectors (V13-2)** — service_role bypass + JOIN-table policy gap + realtime channel collision + Stripe email namespace. **Net-new:** `withOrgScope` wrapper + HMAC realtime channel naming + JWT `app_metadata.org_ids` claim (336ms propagation) + Stripe `stripe_customer_id` keyed by `(user_id, customer_context)`.

4. **Page-builder A/B canonical-link omission (V13-4)** — silent SEO penalty weeks-to-months. **Always `<link rel="canonical">` to control** + cap variants at 42 days + per-variant ISR cache key + JSON-LD on canonical only.

5. **Ad ETL 4 silent-drop modes (V13-5)** — rate-limit gap, attribution-window mismatch (Meta 7d vs Google 30d vs TikTok 7d), FX-conversion gap, Meta AEM 8-event cap. **Mitigations:** idempotent last-72h re-sync + separate gap-detection cron + normalized-attribution view + AEM priority register in `events.ts`.

6. **Multi-tier affiliate state-machine drift (V13-6)** — tier upgrade retroactively recomputes commission. **Mitigations:** stamp `tier_at_conversion_time` on insert; commission_cents NEVER recomputed; chargeback_hold_until per-conversion; plan-checker state-graph audit.

7. **Mid-trial paywall A/B refund spike + PostHog flag stickiness (V13-7)** — measure composite goal (paid + retained-30d); server-side activation capture mandatory; refund-rate kill-switch.

8. **Resend has NO publicly-documented HIPAA BAA** — Phase 25 first task = vendor call. If NO, use AWS SES via `_shared/email-router.ts` for PHI-touching email; keep Resend for non-PHI.

9. **Two Anthropic credentials needed** — consumer ai-chat vs clinical-context ai-chat (BAA + ZDR + web_search disabled). Branch in `ai-chat` Edge Fn on `org_id IS NOT NULL`.

10. **i18n routing = `?lang=es` query + user-preference** (NOT `/es/` path prefix).

11. **Path-based white-label `/clinic/{slug}/...`** for v1.3 — subdomain deferred to v1.5.

12. **Page-builder bundle regression** — admin-route gating MUST stay; per-chunk CI ceilings.

---

## Implications for Roadmap

**Phase numbering starts at 24** (continuing from v1.2's Phase 23). Suggested ~19 phases total.

### Phase 24: Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog
**Rationale:** Load-bearing for nearly every downstream measurement. ARCHITECTURE and FEATURES converge on foundation-first.
**Delivers:** `src/lib/analytics/events.ts` taxonomy with `phi: true|false`; `_shared/posthog-server.ts` helper; modular admin shell; admin 2FA; bulk-actions on Members; per-chunk bundle ceilings.
**Avoids:** V13-7 pre-requisite; V13-5 AEM priority register pre-requisite.

### Phase 25: HIPAA Audit Hardening (engineering; vendor/legal PARALLEL from Wave 0)
**Rationale:** Engineering small; vendor negotiation 4-8 weeks. Run in parallel so first clinic deal can land MID-v1.3.
**Delivers:** `vendor_baa_chain` + expiry alerts; weekly subprocessor-diff cron; runtime BAA-scope guard; `data-sentry-mask` audit; PostHog `disable_session_recording_on_url`; eslint Anthropic beta block; Stripe-PHI CI lint; `_shared/email-router.ts` + AWS SES Edge Fn.
**Avoids:** V13-1.

### Phase 26: Multi-Tier Affiliate
**Rationale:** Standalone; doesn't block other tracks.
**Delivers:** ALTER + `affiliate_tiers` + `affiliate_tier_history` + `tier_at_conversion_time` stamping + partner progress bar + Lifetime recurring-commission cron + locked-once-earned policy.
**Avoids:** V13-6 (plan-checker state-graph audit).

### Phase 27: Modular Admin Shell Extensions (shared infra)
**Rationale:** Phases 28+34+37 need shared react-query/table/virtual.
**Delivers:** Admin-route-gated chunks; cohort builder UI; audit-log diff viewer.

### Phase 28: Clinic Organizations Schema + RLS (4-leak-vector hardening)
**Rationale:** Largest schema slab; blocks 29-30.
**Delivers:** 12+ org-scoped tables; JWT `app_metadata.org_ids`; `withOrgScope` wrapper; HMAC realtime channels; cross-tenant impersonation proof tests; `src/lib/org.ts`.
**Avoids:** V13-2 (all 4 vectors).

### Phase 29: Org Subscriptions + Per-Patient Metered Billing
**Rationale:** Depends on Phase 28.
**Delivers:** `org_subscriptions` + usage records + metered-billing Edge Fn + clinic onboarding + invite-via-email.
**Open decision:** "active patient" definition (e.g., "logged-event-in-last-30-days") — lock in CONTEXT.md.

### Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts
**Rationale:** Where clinic deals close. Pulls deferred-from-v1.2 forward.
**Delivers:** Org roster + drill-in + `alert_rules` + `clinician_alerts` + Resend templates (vendor-gated).

### Phase 31: White-Label (path-based)
**Rationale:** Defer subdomain to v1.5. Ship path-based only.
**Delivers:** `org_branding` CSS-var overlay + path-based clinic routing.

### Phase 32: Spanish i18n (PARALLEL with clinic track)
**Delivers:** react-i18next + http-backend; `?lang=es` query + user-preference; transactional-email shim; KB `{slug}.{lang}.md`; `locale_overrides` table.

### Phase 33: Hourly Ad-Spend ETL
**Rationale:** Depends on Phase 24 taxonomy.
**Delivers:** 3 hourly Edge Fns + `ad_spend_facts` partitioned + `ad_revenue_normalized` view + separate daily gap-detection cron + `fx_rates` table + admin CAC dashboard.
**Avoids:** V13-5.

### Phase 34: M2 Onboarding Overhaul
**Rationale:** Depends on Phase 24. Blocks Phase 39 (paywall needs activation event).
**Delivers:** Value-first preview + magic-link/Google/Apple SSO + admin drag-and-drop step builder + `activation_events` + anonymous-to-authenticated merge + ≥44px tap targets + PostHog step A/B.

### Phase 35: M3 Gamification Engine
**Delivers:** Ledger tables + matview leaderboard + canvas-confetti bursts; ethical-only patterns.

### Phase 36: M3 Review Prompt Engine (web only)
**Delivers:** Internal NPS as INDEPENDENT surface; promoter → Trustpilot/G2; non-promoter → M6 helpdesk ticket.
**Avoids:** V13-3 — plan-checker BLOCKER on conditional native-prompt code.

### Phase 37: M6 Helpdesk Core
**Rationale:** Depends on Phase 27 + Phase 25 Resend BAA decision.
**Delivers:** tickets + ticket_messages + kb_articles + csat + Resend Inbound webhook + HMAC reply-threading + AI assist + in-app widget + KB editor.

### Phase 38: M5b Partial AI Recommender
**Rationale:** Depends on Phase 25 (Anthropic BAA decision for clinical context). Non-PHI ships unconditionally.
**Delivers:** pgvector + `content_embeddings vector(1536)` + IVFFlat-vs-HNSW decision + OpenAI via AI Gateway + Claude weekly digest Edge Fn.
**Open decision:** IVFFlat vs HNSW at clinic-tenant scale.

### Phase 39: A/B Paywall + Pharma Paywall + Page-Variant A/B
**Rationale:** Depends on Phase 34 activation event + Phase 24 server-side PostHog. Bundle 3 A/B surfaces.
**Delivers:** Mid-trial paywall (activation-triggered) + composite goal + page-builder per-block variant + canonical-link + 42-day cap + per-variant ISR cache key + pharma paywall test with safety-info carve-out.
**Avoids:** V13-4 + V13-7.
**Open decision:** Pharmacology paywall line — CONTEXT.md decision artifact.

### Phase 40: Cancellation Save-Offers Flow (PARALLEL with Phase 39)
**Delivers:** `cancellation_offers` + eligibility rules + offer-type variants + offer-take A/B.

### Phase 41: Public Status Page + Embed-Provider Blocks
**Delivers:** Better Stack on `status.leanshot.app`; Calendly/YouTube/Tally embed blocks with sandboxing + consent gating + CSP allowlist + dompurify.

### Phase 42: v1.3 Polish + WCAG 2.2 AA + Smart Notifications + PWA Offline + Dark Mode + Validation
**Delivers:** axe-core CI + smart-notifications + PWA offline + dark-mode parity + final bundle audit + cross-phase RLS validation + deferred-test batch fix.

### Phase Ordering Rationale

- Foundation (24) first — load-bearing for measurement-dependent phases.
- HIPAA engineering (25) PARALLEL with vendor/legal from Wave 0.
- Affiliate (26) standalone.
- Admin extensions (27) bundled — shared infra.
- Clinic orgs (28→29→30→31) sequential — each blocks the next.
- i18n (32) PARALLEL with clinic track.
- Ad ETL (33) after foundation.
- Onboarding (34) blocks paywall A/B (39).
- Gamification (35) + Review (36) + Helpdesk (37) — review→helpdesk routing.
- Recommender (38) blocks on HIPAA decision.
- A/B trifecta (39) bundled.
- Polish closeout (40, 41, 42).

### Research Flags

**Needs research-phase:**
- Phase 25: Resend BAA call (long lead time — Wave 0); Anthropic/PostHog/OpenAI tier decisions
- Phase 28: Multi-tenant patterns deep-dive; "active patient" definition; org_id propagation UX
- Phase 33: Meta App Review (Dev → Standard tier, 2-4 week vendor lead time)
- Phase 38: IVFFlat vs HNSW at clinic-tenant scale; embedding model A/B
- Phase 39: Pharmacology paywall line CONTEXT.md artifact; refund-rate kill-switch
- Phase 36: Plan-checker rule for native-prompt-conditional-on-NPS BLOCKER

**Standard patterns (skip research-phase):**
- 24, 26, 27, 31, 32, 34, 35, 37, 40, 41, 42

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified via `npm view` 2026-05-17; vendor BAA matrix cross-checked official docs; Context7 react-i18next. MEDIUM only on Resend BAA (Phase 25 call resolves). |
| Features | HIGH | App/Play policy + Stripe BAA-exemption + Anthropic BAA scope verified. MEDIUM on mid-trial paywall 3.8x case study; LOW on cross-network dedup precision. |
| Architecture | HIGH | v1.2 architecture empirical (21 migrations + 8 Edge Fns shipped). MEDIUM on multi-tenant org schema (first time shipping); MEDIUM on HIPAA-compliant audit-log shape. |
| Pitfalls | HIGH | App/Play + Anthropic BAA + Supabase RLS + Stripe + Meta/Google rate limits verified. MEDIUM on HIPAA operational details + medical translation liability. LOW on Resend Inbound spam protection. |

**Overall confidence:** HIGH — unknowns are scoped (3-5 vendor decisions) and resolvable with Wave-0 vendor calls.

### Gaps to Address

| Gap | How to Handle |
|---|---|
| Resend BAA y/n | Phase 25 first task — vendor call. If NO, pivot to AWS SES. Blocks Phase 37. |
| PostHog Enterprise/Boost y/n | Phase 25 CONTEXT.md — gates session-replay on clinic routes. Cheaper alt: scrub-only. |
| Anthropic Enterprise pricing | Phase 25 CONTEXT.md — gates recommender (38) + AI-assist split. |
| "Active patient" definition | Phase 29 CONTEXT.md — affects MRR forecasting. |
| Pharmacology paywall line | Phase 39 CONTEXT.md — safety info NEVER paywalled. |
| IVFFlat vs HNSW | Phase 38 research-phase. |
| Meta App Review (Dev→Standard) | Phase 33 prerequisite — 2-4 week vendor lead time. |
| First-clinic-deal price floor | +$1,864-4,364/mo vendor cost — finance conversation. |

---

## Sources

### Primary (HIGH confidence)
- Live npm registry 2026-05-17 (all net-new versions)
- Context7 `/i18next/react-i18next`
- Supabase HIPAA + pgvector + service_role RLS docs
- Vercel HIPAA BAAs for Pro teams
- Anthropic HIPAA Enterprise + BAA + ZDR docs
- Sentry BAA + Privacy/data scrubbing
- PostHog HIPAA + Feature flags + Experiments docs
- Apple SKStoreReviewController + App Review Guidelines §3.2.2(x)
- Google Play User Ratings Reviews and Installs policy
- Resend Receiving Emails (Inbound) + Legal (no BAA as of 2026-05-17)
- Meta Marketing API insights best practices
- Google Ads API Rate Sheet
- TikTok Business API SDK GitHub
- Stripe HIPAA discussion + Customer docs
- Makerkit Supabase RLS best practices

### Secondary (MEDIUM confidence)
- Supabase Team + HIPAA add-on pricing cross-checked
- PostHog Enterprise add-on $2K/mo cross-checked
- Mid-trial paywall 3.8x lift (Pulseahead + Stackmatix)
- Affiliate tier-promotion patterns (Rewardful + BoldDesk)
- Cross-network ad attribution overcounting (AdLibrary 2026)
- HIPAA SaaS considerations (Linfordco)
- AWS SES vs Paubox (Paubox blog)
- PostHog identify() race (GitHub issue #21591)
- Trustpilot anti-fake-reviews policy
- Better Stack pricing

### Tertiary (LOW confidence — verify at plan-phase)
- Resend Inbound spam protection specifics (Phase 37)
- Capgo native-review plugin maintenance (v1.4)
- TikTok ~11-hour data latency (community-reported)
- Anthropic Enterprise pricing for LeanShot scale (custom)

### Cross-Checked Against v1.1 + v1.2 Project Memory
- `sync-defer.ts` bundle discipline preserved
- Vercel AI Gateway proxy extends to OpenAI
- Supabase migration filename strict format preserved
- Worktree-base drift prevention + pathspec commit isolation
- `tier_effective` view canonical (P19 D-04)
- Vendor-gated send (P22 D-03)
- Status-machine transition ownership rule (P19 BL-11)
- `admin.generateLink + plain fetch /auth/v1/verify` RLS test pattern
- Per-file slug prefix in RLS suites
- Audience asymmetry (regulator-vs-user)
- Defer-then-batch-fix pattern for CI-only failures
- Validate-phase inline > spawn subagent on code-shipped phases

---

*Research completed: 2026-05-17*
*Ready for roadmap: yes*
*Suggested phases: ~19 starting at Phase 24, ~5-8 month delivery*
*Critical Wave-0 vendor calls (kick off immediately): Resend BAA, Anthropic Enterprise pricing, PostHog tier decision, Supabase Team+HIPAA upgrade, Vercel HIPAA add-on, Sentry Business, Meta Ads App Review*
