# Stack Research — v1.3 Platform Expansion (additions only)

**Domain:** Mature multi-audience SaaS (B2C patient + B2B clinic + doctor read-share) — already shipped to production on web — adding revenue/growth optimization layer, B2B clinic depth, HIPAA BAA chain, content/depth (i18n + embeds + pharmacology test), retention engine (onboarding + gamification + reviews + helpdesk), and ad-spend ETL.
**Researched:** 2026-05-17
**Confidence:** HIGH on library versions + HIPAA BAA matrix (Supabase/Vercel/Sentry/Anthropic/Stripe/PostHog) — verified via vendor docs 2026-05-17 · MEDIUM on Resend BAA status (no public confirmation — pivot recommendation documented) · MEDIUM on multi-tier affiliate / ad-ETL custom code patterns (no off-the-shelf library; pattern is custom on existing v1.2 Connect rails + Vercel Cron)

> **Scope of this document.** This is the **v1.3 STACK delta only.** Everything in `.planning/milestones/v1.2-research/STACK.md` (Capacitor 8 + RevenueCat + dnd-kit + vanilla-cookieconsent + Stripe Connect Express + AdMob + Health firewall + Turborepo decision + all v1.1 carryover) plus the v1.2-shipped surface (React 19 + Vite 6 + TS 5.6 strict + Tailwind v4 + Zustand + Supabase Postgres/Auth/RLS/Storage/Edge Functions/pg_cron + Stripe Checkout+Subs+Connect+metered + Anthropic via Vercel AI Gateway proxy + Resend + Sentry + PostHog + chart.js + framer-motion + react-virtuoso + dnd-kit + vanilla-cookieconsent + jsPDF + Vercel hosting) **stays as-is and is NOT re-evaluated here.** This doc specifies only the *net-new* surface needed for the 18 v1.3 workstream items in PROJECT.md "v1.3 megamilestone OPENED" section. Versions verified via `npm view` against the live registry on 2026-05-17.

---

## Recommended Stack

### Core Net-New Technologies

| Technology | Version | Purpose | Why Recommended (and which v1.3 feature it serves) |
|------------|---------|---------|----------------------------------------------------|
| **react-i18next** | `react-i18next@15.7.4` + `i18next@25.5.2` + `i18next-browser-languagedetector@8.x` + `i18next-http-backend@3.x` | Spanish i18n infrastructure for UI strings — workstream item **6 (Spanish i18n)** | De-facto React i18n stack since 2019; supports namespaces + lazy-loaded translation chunks (matches our v1.1 sync-defer.ts bundle discipline), React 19 + Suspense compatible (verified via Context7 docs 2026-05-17), works inside Vite without ecosystem-fork tax. The HTTP backend lets `/locales/{{lng}}/{{ns}}.json` ship as static Vercel assets — zero runtime cost, CDN-cacheable per-language. **Reject `next-intl`** — Next.js-only, doesn't apply to our Vite SPA. **Reject `lingui`** — smaller community (~1/20th the GitHub stars), the macro-based DX is more involved for non-trivial onboarding cost; react-i18next's `useTranslation` + `<Trans>` shape is what every contributor already knows. **Integration:** v1.2 transactional Resend templates render server-side in Edge Functions — wrap those in an `i18n.t()` shim with a `Accept-Language` resolver that defaults to user's `auth.users.user_metadata.locale`. **KB articles** ship as `{slug}.{lang}.md` flat files served by the existing page-render Edge Function — no CMS layer required at v1.3. |
| **posthog-node** | `posthog-node@5.10.4` (Deno-compat via `npm:` import) | Server-side event capture from Supabase Edge Functions for adblock/iOS-tracking-blocker eaten events — workstream item **Foundation (PostHog hardening)** + **16 (PostHog server-side capture)** | Critical for activation/payment/signup observability: ITP/uBlock/Brave eat ~30-40% of browser-side events for the signal-richest user moments. Server-side capture from Edge Functions (stripe-webhook, auth-callback, account-delete, payout-cron) ensures revenue + conversion + retention metrics never miss. `posthog-node@5` runs on Deno via `npm:` specifier (confirmed against Edge Function runtime); requires `await client.shutdown()` before function return to flush. **Integration:** Add a `_shared/posthog-server.ts` helper that mirrors the `_shared/resend-domain-health-check.ts` pattern from Phase 22 (lazy-init + breadcrumb + sentry-fallback if PostHog key missing). **Anti-pattern:** never send raw PHI keys in event properties — keep event names + counts only; the user join happens at PostHog server-side via `distinct_id = supabase user_id`. |
| **PostHog Experiments + multivariate flags** | (uses existing `posthog-js` from v1.2 + `posthog-node@5.10.4`) | Mid-trial paywall A/B test (workstream **2.A**), page-builder block A/B test (workstream **2.A**), pharmacology paywall test (workstream **3.B**), onboarding step variants (workstream **5/M2**) | Already-wired vendor; multivariate flags support ≤9 test variants with payload per variant (perfect for paywall copy/price variants); evaluate-once-per-user is the SDK contract that prevents the "user oscillates between variants" anti-pattern. **Critical SDK rule (carry into plan-phase):** evaluate the flag server-side in the Edge Function that records the experiment-event-of-interest, so the variant attribution survives client/server divergence. **No new vendor cost** — PostHog Experiments are bundled with the existing tier. |
| **pgvector** (Postgres extension) | available on Supabase Pro (already on Pro post-v1.2) | Embedding storage + cosine-similarity search for AI Personalization recommender — workstream item **14 (M5b partial recommender)** | Native Postgres extension (we already have Postgres + RLS); the recommender doesn't need a separate vector DB (Pinecone/Weaviate/Qdrant) at v1.3 scale (~1k users with ~50 events each = 50k embeddings, comfortably within pgvector HNSW index). Cosine similarity via `<=>` operator; HNSW index recommended for read-heavy similarity workloads. **Reject Pinecone/Weaviate:** new vendor + new BAA + new bill (~$70/mo Pinecone Starter min) for a feature pgvector covers natively. **Reject Supabase Vector Buckets:** Public Alpha on Pro+ as of 2026-05; the API surface is non-stable — wait for GA. **Integration:** new migration `20270601_pgvector.sql` enabling extension + `vector(1536)` (OpenAI text-embedding-3-small dim) or `vector(1024)` (Voyage voyage-3-large) column on a new `content_embeddings` table; backfill cron via Edge Function. |
| **OpenAI Node SDK** OR **Voyage AI SDK** (pick one) | `openai@6.13.0` (recommended) OR `voyageai@0.2.1` | Embedding generation for recommender (workstream **14**) — content + user-history → 1536-d vector | **Pick OpenAI `text-embedding-3-small`** unless there's a specific multilingual reason to choose Voyage. Pricing parity at this volume (~$0.02 per 1M tokens for OpenAI 3-small vs ~$0.06 for Voyage voyage-3-large), OpenAI SDK is more battle-tested in Deno, embeddings round-trip via a single `/embeddings` endpoint that already proxies cleanly through Vercel AI Gateway (matches v1.2 Anthropic proxy pattern). **Routing through AI Gateway is MANDATORY** per v1.2 stack — no direct OpenAI calls from Edge Functions. **Reject Anthropic for embeddings:** Anthropic does not ship a dedicated embeddings API (still uses Voyage under partnership at 2026-05). **HIPAA note:** when HIPAA BAA chain activates, prefer OpenAI's HIPAA-eligible API tier with signed BAA (available on enterprise OpenAI accounts) over Voyage (BAA TBD). |
| **Stripe Billing — usage-based + seat-based clinic subs** | `stripe@22.x` (already in v1.2) + new product config | `org_subscriptions` table — per-patient metered billing for clinics — workstream item **9 (Clinic organizations)** | v1.2 already wired Stripe Checkout + Subscriptions + Customer Portal + metered (per-active-patient clinic billing — MONEY-04). v1.3 extends to **organizations table** with seat-license OR per-patient metering choice per-clinic. **No new SDK** — use existing `stripe-checkout`/`stripe-webhook` Edge Functions with new product price IDs and a new `org_id` column on `subscriptions`. **Integration:** new migration adding `organizations`, `org_members`, `org_subscriptions`, `org_invites`; reuse stripe-webhook for `customer.subscription.updated` events with `metadata.org_id` discriminator. |
| **Resend Inbound (email-to-ticket)** OR **Postmark Inbound** | Resend Inbound (now GA per `https://resend.com/docs/dashboard/receiving/introduction`) | Email-to-ticket ingest for Helpdesk — workstream item **15 (Helpdesk core)** | Resend is already-wired (v1.2 outbound); Inbound webhook POSTs parsed `{from, to, subject, text, html, attachments, in-reply-to, references}` to a configured endpoint. Reuse existing Resend domain `app.leanshot.app` with a new `support@` MX route. **Why this not Postmark:** zero-new-vendor; same dashboard/API key; same domain DKIM/SPF posture. **Pitfall to flag at plan-phase:** Resend Inbound parsing of attachments — verify max attachment size + MIME type allowlist; ticket-attachments bucket needs Storage RLS that pins to the ticket's tenant. **Reply-threading pattern:** outbound ticket emails include `Reply-To: ticket+{token}@app.leanshot.app` where `token` is a HMAC of `(ticket_id, user_id, secret)`; inbound parser extracts + verifies HMAC + appends to `ticket_messages`. |
| **PostHog HIPAA BAA add-on** | requires Boost / Scale / Enterprise add-on (Enterprise = $2,000/mo) | Analytics BAA chain for HIPAA — workstream item **10 (HIPAA BAA chain)** | PostHog only signs BAAs for **PostHog Cloud** on Boost/Scale/Enterprise; self-hosted PostHog is explicitly NOT BAA-covered. Per their docs, BAA is generator-based (`https://posthog.com/baa`). **Decision deferred to plan-phase:** if we ship HIPAA chain mid-v1.3, the analytics BAA is the most expensive line item; alternative is **scrub all PHI before send** (event-property allowlist enforced in `_shared/posthog-server.ts`) and stay BAA-light. Phase 22 RLS posture already keeps PHI server-side; the question is session-replay autocapture (which can capture form values). **Recommendation:** disable session-replay entirely on routes that show PHI (BodyTab, MedicationTab, AIChatPanel) via PostHog's `disable_session_recording_on_url` config — keeps us BAA-light. |
| **AWS SES** (HIPAA email path) OR **Paubox Email API** | aws-sdk `@aws-sdk/client-sesv2@3.700+` (Deno-compat) | HIPAA-compliant transactional email fallback when Resend BAA is unavailable — workstream item **10 (HIPAA BAA chain)** | **Resend has no publicly-confirmed HIPAA BAA as of 2026-05-17** (verified against `resend.com/legal` + `resend.com/pricing`). Once the clinic-tier features ship and a clinic deal lands, transactional emails carrying PHI (e.g., "Dr. Smith reviewed your liver-enzyme spike alert") need a BAA-covered ESP. **Recommended:** keep Resend for marketing/lifecycle (non-PHI) and add **AWS SES** for PHI-touching emails. SES signs BAA (AWS HIPAA-eligible service), $0.10 per 1k emails (cheaper than Paubox $29/user/mo+), TLS-required can be configured but caveat: SES silently drops mail to receivers that can't negotiate TLS — for low-PHI-volume clinic alerts this is acceptable with monitoring; for high-PHI-volume use Paubox. **Decision deferred to plan-phase:** pick SES (cheaper, ops complexity slightly higher) vs Paubox (simpler, more expensive) once volume estimates are in. **Anti-recommendation:** don't dual-send the same template via both Resend AND SES — pick one path per-template and tag it at the `_shared/email-router.ts` layer. |
| **Better Stack (status page only — NOT BAA path)** | hosted SaaS — $12/mo per status page tier | Public status page — workstream item **18 (Public status page)** | Better Stack's status-page-only tier is the cheap-and-cheerful pick: hosted status page on a `status.leanshot.app` subdomain, auto-updates from their own uptime monitors on a 30s cadence (or push-via-API from our Sentry/CI). **Reject Upptime:** GitHub Actions cron is 5-min minimum interval (matches Better Stack free, beats their paid? — but Upptime's GitHub-hosted incident workflow is clunky for non-engineering responders). **Reject self-hosting OneUptime:** new infra surface for v1.3 polish item. **HIPAA note:** status page contains zero PHI by construction — no BAA needed. |
| **Meta Marketing API SDK** | `facebook-nodejs-business-sdk@24.0.1` | Hourly ad-spend pull from Meta Ads — workstream item **4 (Hourly ad-spend ETL)** | Official Meta SDK; rate-limit: rolling 1-hour window. **Pitfall to flag:** hourly cron at :05 minute past hour (Vercel Cron or pg_cron) to give Meta time to roll up; persist `_etag` per `(account_id, day)` to detect intra-day backfills. As of 2026-05, Advantage+ Shopping/App Campaigns can no longer be created/updated via API on v25+ (read still works) — irrelevant for our pull-only ETL but flag for future write integrations. |
| **Google Ads API SDK** | `google-ads-api@23.0.0` | Hourly ad-spend pull from Google Ads — workstream item **4 (Hourly ad-spend ETL)** | `google-ads-api` (Opteo's wrapper) is the de-facto Node SDK — handles OAuth refresh + the GAQL query DSL. **Pitfall:** Google Ads daily-spend reports are delayed ~3 hours; hourly cron should write to a `provisional` column + reconcile daily at 03:00 UTC. **Anti-pattern:** don't pull `customer_search` with `KEYWORD_VIEW` segment in the hourly job — that's tens of thousands of rows; pull `CAMPAIGN_VIEW` only. |
| **TikTok Business API** | direct REST fetch (no official Node SDK on npm) | Hourly ad-spend pull from TikTok Ads — workstream item **4 (Hourly ad-spend ETL)** | TikTok publishes a Node SDK only via local-file-install (per their `tiktok-business-api-sdk` GitHub) — community wrappers exist (`@quantum-forge/tik-tok-business-sdk@0.0.4-alpha-0.0.1`, very immature). **Recommendation: skip the SDK, hand-roll a thin REST client** using `fetch` in the Edge Function (`https://business-api.tiktok.com/open_api/v1.3/reports/integrated/get/`). **Pitfall (flagged in plan-phase):** TikTok reports API has ~11-hour data latency — true hourly granularity is not achievable; treat the "hourly" cron as a 12-hour rolling reconciliation. |
| **Capacitor In-App Review plugin** | `@capgo/capacitor-native-review@latest` (or `@capacitor/in-app-review` if Capacitor adopts officially) — DEFER to v1.4 | Two-stage review prompt → SKStoreReviewController (iOS) + Play In-App Review API (Android) — workstream item **13 (Review prompt engine)** | **v1.3 ships web-side only** (Trustpilot/G2 redirect on positive NPS); native in-app review is **v1.4-blocked-on-Phase-16** (mobile shells deferred to v1.4). When v1.4 resumes Phase 16, add Capgo's plugin (active on Capacitor 8). |

### Supporting Net-New Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-query` | `5.100.10` | Server-state cache for the v1.3-heavy admin shells (Helpdesk inbox, Affiliate tier reports, Org members table) — workstream items **1 (admin shell)**, **9 (clinic dash)**, **15 (helpdesk widget)** | New surface area in v1.3 has 4-5x more list-detail views than v1.2; current Zustand pull pattern works for owned-by-user data but is fragile for "watch this list of 200 tickets and refetch on focus" semantics. RQ's `useQuery` + `useMutation` + `staleTime` model collapses ~200 LOC of bespoke fetch/loading/error wrapping into ~30 LOC per surface. Bundle cost ~13kB gz — gate via `sync-defer.ts` pattern so it only loads on admin routes. **Reject SWR:** smaller ecosystem, less battle-tested with React 19 Suspense; RQ is the safer multi-year bet. |
| `@tanstack/react-table` | latest `8.x` | Headless table primitives for Admin Tickets list, Affiliate Tier dashboard, Org Members table | Same justification as react-query: v1.3 has 4+ table surfaces. v1.2 admin tables were hand-rolled; replicating that for tickets + affiliate-tier + org-members is busywork. **Bundle:** ~14kB gz — admin-route gated. **Reject AG-Grid / MUI DataGrid:** heavyweight, opinionated styling fights Tailwind v4 tokens. |
| `react-hook-form` (already in v1.2) | `^7.75.0` | Continue using for v1.3's helpdesk reply form, org-create form, affiliate tier-config form | Already in stack; just call out continued use. |
| `framer-motion` (already in v1.2) | `^11.x` | Onboarding-overhaul step transitions (workstream **5/M2**), gamification XP-bar animations (workstream **5/M3**) | Already in stack; gamification (XP-bar fills, level-up bursts, freeze-token flips) is animation-heavy and framer-motion is the right tool. |
| `react-confetti` OR `canvas-confetti` | `canvas-confetti@1.9.3` | Gamification level-up + streak-milestone burst — workstream item **5/M3 (Gamification engine)** | Tiny (~5 KB), zero-dep, framework-agnostic; canvas-confetti has wider adoption than react-confetti. **Bundle:** mobile/Home tab only, lazy-loaded behind the level-up modal. |
| `@dnd-kit/core` + `@dnd-kit/sortable` (already in v1.2) | `^6.x` + `^8.x` | Onboarding step builder drag-and-drop (workstream **5/M2**), page-builder admin editor (already v1.2) | Already in stack. **Reuse pattern:** Phase 15 page builder is the reference implementation; onboarding step builder ships the same Sortable + Droppable shape, different node types. |
| `swr` | NOT recommended | n/a | Don't add — pick react-query, don't run both. |
| `nanoid` | `5.1.6` | Short opaque IDs for affiliate tier slugs, helpdesk ticket short-codes (`#A7K2`), org invite tokens | 130-byte gzipped; already used in v1.2 via Supabase tooling. Use for HMAC-token replacement candidates where reversibility isn't needed. |
| `@aws-sdk/client-sesv2` | `3.700+` | HIPAA-eligible email via AWS SES — Edge Function side | Only loaded by `_shared/email-router.ts` when destination is flagged `phi=true`. Wraps via `npm:` import for Deno. |
| `firebase-admin` (already planned v1.2) | `^12.x` | Push fan-out (carryover from v1.2 deferred Phase 17 — likely lands in v1.3 if we keep mobile push out of scope for v1.4) | Same plan as v1.2 research; no v1.3 change. |
| `react-hotkeys-hook` | `5.1.0` | Admin shell keyboard shortcuts (cmd-k command palette + j/k row nav in tables) — workstream item **1 (modular admin shell)** | Optional polish for the admin power-user flows; tiny (~3 KB gz). Only if admin power-user UX is in scope at plan-phase. |
| `react-markdown` + `remark-gfm` | `react-markdown@9.x` + `remark-gfm@4.x` | Render KB articles + helpdesk message bodies (Markdown source-of-truth) — workstream items **6 (KB i18n)** + **15 (helpdesk)** | Already-validated React 19 compat; lazy-load on the article/ticket detail routes. **Anti-pattern:** never `dangerouslySetInnerHTML` on user-submitted helpdesk markdown without `remark-rehype` + sanitization — wire `rehype-sanitize` or restrict to text-only ticket bodies. |
| `dompurify` | `3.2.7` | Sanitize embed-block iframe srcdoc + helpdesk reply HTML — workstream items **5 (embed blocks)** + **15 (helpdesk)** | Required for any user-controlled HTML rendering surface. Tiny + battle-tested. |
| `@tanstack/react-virtual` | `3.x` | Long-list virtualization for affiliate-tier-conversions table + admin tickets list | Lighter than react-virtuoso (already in v1.2 for photo grids) for fixed-row-height table use; use react-virtuoso for variable-height. |

### Net-New Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `posthog-cli` (or PostHog dashboard) | Define + sync feature flag definitions as code | At v1.3 scale (~4 flags + 3 experiments), code-as-config from a `.planning/posthog-flags.json` file checked in alongside ROADMAP is cleaner than dashboard-only management. PostHog has `posthog-cli` as of late 2025 — verify support for our needs at plan-phase. |
| Stripe CLI (already in v1.2) | Webhook tunneling for org-subscriptions dev | Existing tool; new `customer.subscription.updated` filter for `metadata.org_id` events. |
| Resend Inbound webhook simulator | Test reply-to-ticket parsing locally | Resend supports webhook test-fires from dashboard; combine with `ngrok` for local dev. |
| Better Stack push-status API | Optional: surface CI-fail incidents on public status page | If wired; not required at v1.3. |
| OpenAI Playground | Tune embedding model + chunk-size for recommender | Pre-plan-phase task; cache result in `.planning/research/embeddings-tuning.md`. |

---

## Installation

```bash
# i18n infrastructure (workstream 6)
npm install react-i18next@^15 i18next@^25 i18next-browser-languagedetector@^8 i18next-http-backend@^3

# Server-side analytics (workstream 1 + 16)
npm install posthog-node@^5   # used inside Supabase Edge Functions via npm: import

# Server state + tables for admin-heavy surfaces (workstreams 1, 9, 15)
npm install @tanstack/react-query@^5 @tanstack/react-table@^8 @tanstack/react-virtual@^3

# Gamification polish (workstream 5/M3)
npm install canvas-confetti@^1
npm install -D @types/canvas-confetti

# Helpdesk + KB rendering (workstreams 6, 15)
npm install react-markdown@^9 remark-gfm@^4 rehype-sanitize@^6 dompurify@^3
npm install -D @types/dompurify

# Embeddings (workstream 14)
npm install openai@^6   # routed via Vercel AI Gateway, mirrors v1.2 Anthropic pattern

# HIPAA email path — added only when HIPAA BAA chain activates (workstream 10)
# (Deno Edge Function — import via npm: specifier, no package.json entry needed)

# Admin power-user polish (workstream 1 — optional)
npm install react-hotkeys-hook@^5

# Ad-spend ETL — added only inside Edge Function deno.json import_map (workstream 4)
# facebook-nodejs-business-sdk and google-ads-api via npm: specifier in Edge Function only
# TikTok: hand-rolled fetch wrapper, zero deps

# Migrations needed (no npm install):
# - pgvector extension enable (workstream 14)
# - organizations + org_members + org_subscriptions tables (workstream 9)
# - tickets + ticket_messages + ticket_attachments + kb_articles + csat_responses (workstream 15)
# - affiliate_tiers + affiliate_tier_assignments (workstream 2.A)
# - ad_spend_hourly (workstream 4)
# - content_embeddings + user_interaction_embeddings (workstream 14)
# - notification_recommendations + summary_emails (workstream 14)
```

---

## HIPAA BAA Vendor Matrix (workstream item 10)

**Critical dependency:** HIPAA BAA chain is mid-v1.3 entry condition for landing first clinic deal. Engineering work is small (header propagation, audit log hardening, MFA enforcement); the *vendor negotiation + paid-tier upgrades* are 4-8 weeks of parallel finance/legal effort. This matrix is the input to that effort.

| Vendor | Used For | BAA Available? | Required Tier | Public Pricing (2026-05-17) | Notes / Gotchas |
|--------|----------|----------------|---------------|------------------------------|------------------|
| **Supabase** | Postgres + Auth + RLS + Storage + Edge Fns + pg_cron | YES | **Team** + HIPAA add-on | $599/mo (Team) + ~$350/mo (HIPAA add-on) = **~$949/mo baseline** | HIPAA add-on flag enables platform PHI safeguards + signed BAA. Pro tier ($25/mo, currently active for v1.3 entry) does NOT qualify — must upgrade. Source: [Supabase docs: HIPAA Compliance](https://supabase.com/docs/guides/security/hipaa-compliance) + [HIPAA Projects](https://supabase.com/docs/guides/platform/hipaa-projects). |
| **Vercel** | Static SPA + AI Gateway proxy + Cron + leanshot.app + app.leanshot.app routing | YES | **Pro** (self-serve) | **$350/mo HIPAA add-on on Pro** (no Enterprise required since 2025) | Self-serve BAA from dashboard — no sales call. Enterprise ($45K/yr median) includes BAA + Secure Compute (isolated networks, dedicated IPs, VPC peering); only needed if "more sensitive workloads" demand. Source: [Vercel: HIPAA BAAs available to Pro teams](https://vercel.com/changelog/hipaa-baas-are-now-available-to-pro-teams) + [HIPAA compliance on Vercel](https://vercel.com/kb/guide/hipaa-compliance-guide-vercel). |
| **Anthropic** (Claude via AI Gateway) | AI coach + helpdesk AI assist + recommender "Next Best Action" + weekly summary email | YES, but **sales-assisted Enterprise only** | sales-assisted Claude Enterprise (usage-based billing) | custom — sales call required | **Critical gotcha:** self-serve Enterprise + Team + individual plans CANNOT enable HIPAA. Admin must activate "HIPAA compliance" toggle in Data & Privacy after sales-assisted Enterprise activation + signed BAA. Web search functionality is OUT OF BAA scope. ZDR (Zero Data Retention) is **separate eligibility** for APIs that don't require prompt storage — useful as a pre-BAA posture but not a BAA replacement. Source: [Anthropic: HIPAA-ready Enterprise plans](https://support.claude.com/en/articles/13296973-hipaa-ready-enterprise-plans) + [BAA for Commercial Customers](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers). |
| **OpenAI** (embeddings) | Recommender embeddings (workstream 14) | YES on Enterprise tier with signed BAA | Enterprise | custom | Same shape as Anthropic — BAA via enterprise contact. If we don't go Enterprise-tier on OpenAI, embeddings must not include PHI in the input string (strip patient identifiers + dose-specific text). Easier: scope embeddings to non-PHI content only (KB articles, generic insights). |
| **Stripe** | Web subs + Connect Express + clinic seats + org metered billing | **NO** — Stripe does NOT sign BAA | n/a | n/a | **NOT a BAA-eligible vendor.** This is fine because of the HIPAA "normal banking and financial transactions" exemption — Stripe can process payments without being a Business Associate as long as PHI never enters Stripe. **Project rule (carry into plan-phase):** keep Stripe `description` / `metadata` / `invoice line item description` generic ("Clinic Subscription — 12 patients"; NEVER "Semaglutide dose tracking for J. Smith"). v1.2 already does this; reaffirm + add a CI lint that blocks PHI keywords in Stripe API calls. Source: [Stripe HIPAA discussion](https://patient-protect.com/post/is-stripe-hipaa-compliant). |
| **Resend** | v1.2 transactional + lifecycle email (welcome / receipts / dunning / KB email digests) | **NOT PUBLICLY DOCUMENTED** as of 2026-05-17 (Resend `/legal` + `/pricing` do not mention HIPAA BAA) | unknown | unknown | **Block at plan-phase:** contact Resend sales for BAA availability. If unavailable, pivot to **AWS SES (BAA-eligible, ~$0.10/1K emails)** for PHI-touching emails; keep Resend for non-PHI marketing/lifecycle. Email-router pattern: `_shared/email-router.ts` switches provider by `phi: boolean` flag on template metadata. |
| **AWS SES** | HIPAA email fallback (if Resend BAA unavailable) | YES | any | $0.10 per 1,000 emails | AWS HIPAA-eligible service; BAA available via AWS Artifact. **Gotcha:** SES silently drops mail to recipients that can't negotiate TLS when `EnforceTLS` is set — acceptable for clinic-internal alerts where recipients are vetted enterprise mailboxes; logs the drop, so observability is in. Alternative: **Paubox Email API** auto-falls-back to Paubox Secure Message Center on TLS-negotiation failure (~$29/user/mo+, but no silent drops). Source: [Paubox: Amazon SES vs Paubox](https://www.paubox.com/blog/amazon-ses-vs-paubox-email-api-for-hipaa-compliant-email). |
| **Sentry** | Error tracking + Session Replay (currently active) | YES | **Business** plan | **$80/mo** (cheapest BAA in the chain) | Business plan ($80/mo, 100K events) includes Advanced Data Scrubbing (BAA prerequisite) + signed BAA. **Gotcha:** Session Replay can capture form values — must enable input masking site-wide before BAA activation (`maskAllInputs: true` + `blockAllMedia: false` for redact-mode); on PHI routes (BodyTab, MedicationTab, AIChatPanel, DoctorReport) use `data-sentry-mask` attribute on PHI containers. Source: [Sentry BAA](https://sentry.io/legal/baa/) + [Sentry trust](https://sentry.io/trust/privacy/). |
| **PostHog** | Product analytics + feature flags + A/B + session replay + surveys + heatmaps | YES (PostHog Cloud only — NOT self-hosted) | **Boost / Scale / Enterprise** add-on | Enterprise add-on $2,000/mo | **Cheapest BAA route:** Boost or Scale add-on (smaller); Enterprise ($2K/mo) only if larger governance requirements (RBAC, dedicated support). **BAA generator:** PostHog provides their BAA at https://posthog.com/baa for self-countersign. **Cheaper alternative:** stay PHI-scrubbed (event-property allowlist enforced in `_shared/posthog-server.ts` + `disable_session_recording_on_url` for PHI routes) — keeps BAA out of scope. **Decision point at plan-phase:** if session-replay on PHI surfaces is a product requirement, BAA required; if not, scrub-only path saves $2K+/mo. Source: [PostHog HIPAA compliance docs](https://posthog.com/docs/privacy/hipaa-compliance). |
| **Better Stack** (status page) | Public uptime status page | N/A — no PHI in scope | any tier | $12/mo (status page tier) | Zero PHI by construction. No BAA needed. |
| **Cloudflare / Vercel AI Gateway** | Anthropic + OpenAI proxy | N/A — Vercel AI Gateway covered under Vercel BAA | Vercel Pro+ with BAA | included | If AI Gateway is in Vercel BAA scope (which it should be — Vercel-operated service); confirm at plan-phase BAA negotiation. |

**Estimated incremental monthly cost when HIPAA BAA chain activates:**
- Supabase Pro → Team + HIPAA add-on: **+$924/mo** (was $25, becomes $949)
- Vercel Pro → Pro + HIPAA add-on: **+$350/mo**
- Sentry → Business: **+$80/mo** (likely already on or near this)
- Anthropic → Enterprise: **custom** (likely 2-5x current usage cost; estimate **+$500-2,000/mo** at v1.3 scale)
- OpenAI → Enterprise (for HIPAA embeddings): **custom** OR avoid by scoping embeddings to non-PHI content (preferred)
- PostHog → Boost add-on (cheapest BAA path) **OR** scrub-only (free): **+$0 to +$2,000/mo** depending on decision
- Email path: Resend unchanged for non-PHI + AWS SES for PHI (~$10/mo at v1.3 volume) — **+~$10/mo**
- **TOTAL: ~$1,864-4,364/mo additional vendor cost when HIPAA BAA chain activates** (excluding Anthropic Enterprise which is custom).

This is the input to the "first clinic deal price floor" conversation — first clinic contract MRR needs to exceed this baseline by a meaningful margin for HIPAA-tier to make sense.

---

## Architecture: how the v1.3 additions fit the v1.2-shipped stack

```
                                  ┌───────────────────────────────────────────────────────┐
                                  │  Single repo (no monorepo at v1.3 — defer to v1.4)    │
                                  │  /Users/karstenhaldan/minisite/leanshot                │
                                  └───────────────────────────────────────────────────────┘
                                                       │
   ┌──────────────────┬──────────────────┬─────────────┴──────────────┬──────────────────────┐
   ▼                  ▼                  ▼                            ▼                      ▼
src/components/    src/lib/        Supabase Edge Fns                 Vercel Cron        Public assets
admin/           i18n/             (NEW v1.3, all on Deno)           (NEW v1.3)         /locales/{lng}/*.json
+ Modular shell  + react-i18next   _shared/posthog-server          ad-spend-meta         (NEW v1.3 — workstream 6)
+ Bulk actions   + locale router   _shared/email-router            ad-spend-google
+ Permissions    + KB markdown     _shared/embed-sandboxer         ad-spend-tiktok
                                   ticket-inbound (Resend Inbound) embedding-backfill
src/components/  src/lib/          ticket-reply                    recommender-weekly
helpdesk/        recommender/      org-invite + org-subscription   review-prompt-fanout
+ Inbox          + pgvector q's    affiliate-tier-recalc           account-deletion (extends)
+ Ticket detail  + Voyage/OpenAI   summary-email-render            organizations-billing-cron
+ Reply panel    + cosine sim      review-prompt-stage1
+ Attachments
+ KB editor      src/lib/
                 gamification/
src/components/  + xp + levels
clinic-org/      + freeze tokens
+ Org dash       + leaderboard
+ Members        + challenges
+ Invite flow    + canvas-confetti
                                                                  ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────┐
   │ Supabase project ytnsipxxmzgaebkqmokp — adds at v1.3:                                │
   │  · organizations, org_members, org_invites, org_subscriptions  (workstream 9)         │
   │  · tickets, ticket_messages, ticket_attachments,                                      │
   │    kb_articles (i18n: {slug, locale}), csat_responses          (workstream 15)        │
   │  · affiliate_tiers, affiliate_tier_assignments                 (workstream 2.A)       │
   │  · ad_spend_hourly (composite PK: account_id+source+hour_ts)   (workstream 4)         │
   │  · content_embeddings, user_interaction_embeddings,                                   │
   │    notification_recommendations, summary_emails (vector(1536)) (workstream 14)        │
   │  · gamification_events, user_xp, user_freeze_tokens,                                  │
   │    leaderboards (matview), weekly_challenges                   (workstream 5/M3)      │
   │  · onboarding_steps (admin-editable, drag-and-drop),                                  │
   │    onboarding_variants, onboarding_runs                        (workstream 5/M2)      │
   │  · review_prompts (stage1=NPS, stage2=route_to_store|ticket),                         │
   │    save_offers, cancellation_flows                             (workstreams 13, 17)   │
   │  · admin_audit (extends v1.2 audit_logs with bulk-action      (workstream 1)         │
   │    discriminator + admin_2fa_enforcements)                                            │
   │                                                                                       │
   │ pgvector extension enabled                                                            │
   │ Storage buckets: ticket-attachments (RLS by tenant), kb-images (public)              │
   └──────────────────────────────────────────────────────────────────────────────────────┘
                                                                  │
                                                                  ▼
   ┌──────────────────┬─────────────────────────────────────┬──────────────────────────────┐
   │ Existing (v1.2): │ NEW vendor relationships v1.3:      │ HIPAA chain (mid-v1.3):      │
   │  Stripe          │  Better Stack (status page)         │  Supabase Team+HIPAA add-on  │
   │  Anthropic       │  Meta Ads API + Google Ads API +    │  Vercel Pro HIPAA add-on     │
   │  Resend          │     TikTok Marketing API (read-only)│  Sentry Business             │
   │  Sentry          │  OpenAI (embeddings via AI Gateway) │  Anthropic Enterprise        │
   │  PostHog         │  AWS SES (HIPAA email path,         │  OpenAI Enterprise (opt)     │
   │  Vercel          │     conditional on Resend BAA gap)  │  PostHog Boost add-on (opt)  │
   └──────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

**Bundle posture (carry from v1.1/v1.2).** Existing `sync-defer.ts` idle-deferred-init pattern remains MANDATORY for all v1.3 web-side heavies:
- `@tanstack/react-query` + `@tanstack/react-table` + `@tanstack/react-virtual` — admin-route-gated dynamic import only
- `canvas-confetti` — gamification-modal-gated lazy import
- `react-i18next` core — eager (it's used everywhere); language packs lazy via `i18next-http-backend`
- `react-markdown` + `remark-gfm` + `rehype-sanitize` — KB/ticket-detail-route gated
- `dompurify` — same gate as react-markdown
- `posthog-node` — Edge-Function-only, never bundles into web
- `openai` + `facebook-nodejs-business-sdk` + `google-ads-api` — Edge-Function-only

**Existing bundle ceiling (v1.2: index 17.67 kB gz, 50 kB cap).** v1.3 must preserve. Bundle CI guard stays as hard PR-blocker. New v1.3-specific per-chunk ceilings to add at Phase 24 (v1.3 bootstrap):
- `admin-shell` chunk: 30 kB gz (includes react-query + react-table when admin route hit)
- `helpdesk-widget` chunk: 25 kB gz (includes react-markdown when ticket-detail rendered)
- `i18n-runtime` chunk: 15 kB gz (react-i18next + i18next core, no language packs)
- `gamification-burst` chunk: 8 kB gz (canvas-confetti)

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative / Why Not Now |
|-------------|-------------|----------------------------------------|
| **react-i18next** | next-intl | Next.js only; we're on Vite. |
| react-i18next | LinguiJS | Smaller community + macro DX; valid alternative if a contributor strongly prefers it but no migration upside. |
| react-i18next | FormatJS / react-intl | Heavier; ICU MessageFormat overkill for our string density at v1.3. |
| **pgvector** | Pinecone / Weaviate / Qdrant | Use if embeddings scale > 1M vectors OR if we need real-time cross-tenant similarity at >10 QPS (we won't at v1.3). |
| pgvector | Supabase Vector Buckets | Wait for GA; currently Public Alpha (2026-05). |
| **OpenAI embeddings** | Voyage AI (`voyage-3-large`) | Voyage wins on retrieval quality on technical/code-heavy benchmarks; on patient-narrative text the gap is narrower. Use if recommender precision is poor with OpenAI 3-small after tuning. |
| OpenAI embeddings | Anthropic embeddings | Anthropic doesn't ship an embeddings API as of 2026-05. |
| **PostHog feature flags + experiments** | LaunchDarkly / Statsig / GrowthBook | All viable; all add new vendor. PostHog covers flags + experiments + analytics + replay + surveys + heatmaps as one bill — keep consolidation. |
| **Resend + AWS SES dual-path** | Postmark single-path | Postmark BAA exists + is widely documented; cheaper than SES on small volume but more expensive than $0.10/1K at scale. Postmark would be a vendor swap (replace Resend entirely); SES is additive (keep Resend for marketing). Defer Postmark consideration to v1.4 if Resend BAA confirms unavailable. |
| **Resend Inbound** for email-to-ticket | Postmark Inbound, SendGrid Inbound Parse, AWS SES inbound | Resend is already-wired; one less vendor relationship. |
| **Better Stack** status page | Upptime (self-hosted GitHub Actions) | Upptime is free + GitOps-managed but 5-min poll minimum + responder UX is GitHub-centric. Pick Upptime if budget is a hard $0/mo cap. |
| Better Stack | Atlassian Statuspage | Atlassian Statuspage starts at $29/mo + adds Atlassian SSO complexity; Better Stack is more polished for solo/small ops. |
| Better Stack | Self-host OneUptime | Open source, fully self-hostable, but adds Docker/K8s ops surface. Wrong shape for v1.3 polish item. |
| **Hand-rolled TikTok REST client** | `@quantum-forge/tik-tok-business-sdk` community wrapper | Wrapper is alpha-tier (v0.0.4); ~50 LOC of `fetch` is more durable. |
| **canvas-confetti** | `react-rewards` | Wider feature set in react-rewards but adds React Context wrapper that fights with framer-motion's animation loop on the gamification screen. Stick with the imperative-call confetti. |
| **AWS SES** for HIPAA email | Paubox Email API | Paubox is simpler (auto-fallback to Secure Message Center on TLS fail; no silent drops); SES is cheaper + more operationally familiar. Pick Paubox if PHI volume is high and a single dropped email is a compliance incident; pick SES if low-volume clinic alerts with monitoring. |
| **`@tanstack/react-query`** | SWR | RQ has the larger ecosystem + React 19 Suspense story. SWR is fine but second-place. |
| **`@tanstack/react-table`** | AG-Grid / MUI DataGrid | Both heavyweight + opinionated styling; v1.3 admin tables stay Tailwind-styled. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Mixpanel / Amplitude** for adblock-eaten event coverage | PostHog is already wired + covers product analytics + flags + experiments + session replay + surveys + heatmaps as one vendor; adding Mixpanel/Amplitude duplicates the bill and the JS bundle. | Add `posthog-node` server-side capture from Edge Functions for adblock-eaten conversion events; same dashboard. |
| **Pinecone / Weaviate / Qdrant** at v1.3 scale | New vendor, new BAA negotiation, new bill ($70+/mo Pinecone Starter), new RLS-equivalent to design. pgvector covers our load. | pgvector + HNSW index in Supabase Postgres. |
| **LaunchDarkly / Statsig / GrowthBook** for A/B | PostHog Experiments are bundled in existing tier; switching adds a vendor with no v1.3 capability we don't have. | PostHog multivariate flags + Experiments. |
| **Mux / Cloudflare Stream** for video at v1.3 | M4 Community / Skool-style video posts is explicitly v1.5+ per PROJECT.md. No video-hosting need in v1.3. | Skip. Defer to v1.5 milestone planning. |
| **Postmark / SendGrid full swap of Resend** at v1.3 | v1.2 already wired Resend domain + templates + lifecycle Edge Functions; swapping the ESP is a Phase 22-scale migration. | Keep Resend for non-PHI + add AWS SES path for PHI-touching mail only. |
| **Stripe `description` / `metadata` fields containing diagnoses, drug names, dosing** | Stripe is not BAA-eligible; ANY PHI in a Stripe field breaches HIPAA's "normal banking exemption." | Generic descriptors ("Clinic Subscription — 12 patients"); CI lint that blocks PHI keyword regex in Stripe API call sites. |
| **Anthropic `web_search` tool** when HIPAA BAA chain is active | Per Anthropic BAA terms, web search functionality is explicitly OUT OF BAA scope. Using it on PHI-containing prompts breaches BAA. | If HIPAA BAA active: gate web_search by `user.is_phi_handler === false`. If user is clinic staff: disable web_search; if patient self-service AI coach: web_search OK on non-PHI prompts. |
| **PostHog session replay on PHI-rendering routes without BAA** | Session replay can capture form values + DOM; without BAA it's a breach risk; with BAA it's $2K/mo. | `disable_session_recording_on_url` for `/medication/*`, `/body/*`, `/insights/*`, `/coach/*`, `/share/*`, `/clinic/*`, `/admin/*` AND/OR add `data-ph-no-capture` to all PHI-rendering containers. |
| **OpenAI embeddings input containing patient identifiers + specific drug + dose strings** | Without OpenAI Enterprise BAA, these prompts cross the BAA line. | Scope embeddings to non-PHI content (KB articles, generic insights, anonymized aggregates) UNTIL OpenAI Enterprise tier is signed. |
| **Self-hosting PostHog for HIPAA cost dodge** | PostHog explicitly does NOT sign BAAs for self-hosted deployments. Self-hosting buys nothing on HIPAA, costs ops surface. | Either PostHog Cloud + BAA add-on OR PostHog Cloud + PHI scrub posture. |
| **TikTok community SDK `@quantum-forge/tik-tok-business-sdk`** | Alpha (v0.0.4), last published 9 months ago, narrow community. | Hand-roll a thin `fetch`-based client; ~50 LOC; uses only stable v1.3 endpoints. |
| **Mixing the OnlyFans-style monorepo refactor with v1.3 net-new** | Monorepo move (deferred from v1.2 research) is its own engineering arc; bundling it with v1.3 doubles risk. | Stay single-repo at v1.3; revisit Turborepo migration as a v1.4 Phase entry. |
| **Building a custom in-house helpdesk component-library** | Helpdesk is a 1-engineer-month problem in our shape (tickets + messages + attachments + CSAT + KB), all of which is patterns we already have (RLS-by-tenant, Storage + signed URLs, Resend templates). Building a reusable component-library on top adds 3x the work for no v1.3 value. | Ship surface-by-surface; refactor into shared primitives only when 2nd consumer emerges. |
| **`react-confetti`** (continuous renderer) | Always-on render loop; battery cost on mobile. | `canvas-confetti` — imperative-call. |
| **`dangerouslySetInnerHTML` on helpdesk reply HTML / KB markdown** | XSS surface; user-submitted markdown via inbound email is hostile by construction (spam links, scripted content). | `react-markdown` + `rehype-sanitize` for KB; for helpdesk-reply HTML run through `dompurify` with a strict allow-list. |
| **Adding a CMS (Strapi / Sanity / Contentful) for KB articles** at v1.3 | KB articles are flat Markdown + frontmatter; we already have a page-render Edge Function (Phase 15) and a Storage bucket. CMS adds ops + integration surface. | KB articles as Markdown files in `apps/marketing/kb/{slug}.{lang}.md` (or Supabase `kb_articles` table for editor UX); render via existing page-render Edge Function. |
| **Atlassian Statuspage / PagerDuty for v1.3 status surface** | Both designed for multi-service incident management; v1.3 has one product surface. Overkill. | Better Stack hosted status page tier ($12/mo). |
| **NextAuth / Auth.js for the magic-link / Google / Apple onboarding additions** | We're already on Supabase Auth (which natively supports magic link + Google OAuth + Apple OAuth); swapping is a v1.2 rewrite. | Configure new providers in Supabase Auth dashboard; consume via existing supabase-js. |

---

## Stack Patterns by Variant

**If the first clinic deal slips past v1.3 (HIPAA chain unblocks for v1.4):**
- Skip Supabase Team upgrade ($924/mo saved)
- Skip Vercel HIPAA add-on ($350/mo saved)
- Skip Anthropic Enterprise upgrade
- Keep Sentry on existing tier (no BAA needed yet)
- Keep PostHog in PHI-scrub mode (already cheap default)
- Net: zero new vendor cost until clinic deal is signed; HIPAA stays in "ready posture, not paid" (carryover language from v1.2)
- Recommendation: build HIPAA SCAFFOLD (audit-log hardening, MFA enforcement, route-level PHI mask declarations in code) at v1.3 plan-phase even if BAA isn't paid yet — so when clinic signs, the engineering work is just "flip the BAA"

**If Anthropic Enterprise pricing is rejected mid-v1.3:**
- AI coach (workstream 5) + helpdesk AI assist (workstream 15) + recommender Next Best Action (workstream 14) split into "PHI-touching" vs "non-PHI-touching" paths
- PHI-touching path: gated behind feature flag, disabled until BAA signs
- Non-PHI path: KB article suggestions, marketing copy generation, helpdesk public-FAQ generation — fine on existing AI Gateway routing
- Estimated impact: workstream 14 partially blocked; workstreams 5+15 ship in degraded mode (no AI insights, only AI helpdesk-assist + summary email)

**If PostHog BAA add-on is rejected (~$2K/mo):**
- Maintain PHI-scrub posture: `_shared/posthog-server.ts` event-property allowlist (event names + counts + non-PHI dimensions only)
- Disable session replay on all PHI routes (URL regex + per-route `data-ph-no-capture`)
- Disable autocapture (`autocapture: false`) on PHI routes
- Disable surveys + heatmaps on PHI routes
- Net: cost $0; capability loss = no session replay for clinic-tier user behavior analysis (acceptable for v1.3, revisit if clinic operators ask)

**If Spanish i18n proves heavier than expected:**
- Ship i18n infrastructure (workstream 6 part 1: react-i18next + namespace structure + fallback) at v1.3
- Defer KB-article Spanish translation + transactional-email Spanish translation to v1.4
- Acceptable degradation: Spanish UI present, Spanish KB/emails fall back to English

**If embed-block sandboxing is too risky:**
- Ship Calendly + YouTube as "iframe-with-sandbox-allow-scripts-and-same-origin-stripped" using `<iframe sandbox="allow-scripts" referrerpolicy="strict-origin-when-cross-origin">`
- Defer Tally + custom-script blocks to v1.4
- Add per-provider allowlist (CSP `frame-src` includes only `https://calendly.com https://www.youtube-nocookie.com`)
- Consent gating: embed renders a placeholder + "Load this content from {provider}" button; click loads the iframe (matches the cookie consent pattern from v1.2's vanilla-cookieconsent)

---

## Version Compatibility (verified 2026-05-17 via `npm view` + Context7)

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `react-i18next@15.7.4` | React 19 + Vite 6 + Suspense | Context7 docs confirm `<Suspense fallback={...}>` wrapping for lazy language packs; works with React 19 transition API. |
| `i18next@25.5.2` | `react-i18next@15.x` + `i18next-http-backend@3.x` + `i18next-browser-languagedetector@8.x` | All on matching majors; published within 90 days of research date. |
| `posthog-node@5.10.4` | Supabase Edge Functions (Deno) via `npm:` specifier | Must call `await client.shutdown()` before Edge Function return to flush. |
| `@tanstack/react-query@5.100.10` + `@tanstack/react-table@8.x` + `@tanstack/react-virtual@3.x` | React 19 | All TanStack libs on v5+ are React 19 ready; verified. |
| `openai@6.13.0` | Deno via `npm:` specifier + Vercel AI Gateway (already proven via v1.2 Anthropic gateway pattern) | Routes via `baseURL: "https://gateway.ai.vercel.app/v1/openai"`; same posture as v1.2 Anthropic. |
| `voyageai@0.2.1` | Deno via `npm:` specifier | Alternative to OpenAI; same Edge Function shape. |
| `facebook-nodejs-business-sdk@24.0.1` | Deno via `npm:` specifier | Heavyweight (~2MB), only loaded inside `ad-spend-meta` Edge Function — never bundles into web. |
| `google-ads-api@23.0.0` | Deno via `npm:` specifier | OAuth refresh token must live in Supabase Function Secrets, not in code. |
| `canvas-confetti@1.9.3` | React 19 + framer-motion 11 | Imperative-only API; no React Context interference. |
| `react-markdown@9.x` + `remark-gfm@4.x` + `rehype-sanitize@6.x` | React 19 | v9 explicitly supports React 19. |
| `dompurify@3.2.7` | Browser + Deno | Use browser bundle in web, jsdom-shim in Edge Function reply-validation. |
| pgvector (Postgres extension) | Supabase Pro+ | Already available on the current Pro tier; just needs migration to enable + index. |
| `@aws-sdk/client-sesv2@3.700+` | Deno via `npm:` specifier | AWS SDK v3 is modular; only the SESv2 client loads, not the entire AWS SDK. |
| `nanoid@5.1.6` | Browser + Deno | Already in v1.2 toolchain; v5 is ESM-only (already on ESM stack). |
| `react-hotkeys-hook@5.1.0` | React 19 | v5 added React 19 support. |

**Known compatibility traps (carry into plan-phase):**

1. **react-i18next + Vite eager-bundling translation JSONs.** Default Vite config will bundle the `/locales/` tree into the chunk graph if you `import` JSONs. **Project rule:** use `i18next-http-backend` with `loadPath: '/locales/{{lng}}/{{ns}}.json'` (HTTP fetch from public/) so language packs are CDN-cached + not in JS bundle.
2. **posthog-node `await client.shutdown()` MUST be the last call** in Edge Functions; otherwise events buffer in memory and are lost on function teardown. Bake into the `_shared/posthog-server.ts` factory.
3. **pgvector HNSW index creation is LONG-RUNNING** (minutes on warm tables with >100K rows). Schedule the index-create migration during a low-traffic window OR use `CREATE INDEX CONCURRENTLY` (which doesn't require a maintenance window but takes 2x longer).
4. **OpenAI `text-embedding-3-small` returns 1536 dims by default.** Schema must match (`vector(1536)`). If you switch to `text-embedding-3-large` later, vectors are 3072 dims — schema migration required.
5. **Resend Inbound DKIM verification.** Inbound requires MX record on `app.leanshot.app` pointed at Resend's inbound MX hosts (different from outbound). DNS change + 24-48h propagation. Schedule into Phase 24 (v1.3 bootstrap) before any helpdesk plan.
6. **Stripe metadata field 500-char limit.** When wiring `org_id` + tier discriminators into `subscriptions.metadata`, watch the budget; use short JSON keys.
7. **Meta Marketing API rate limit is per-app per rolling-hour.** Schedule cron at :05 of each hour to avoid the top-of-hour stampede; persist `_etag` per fetch.
8. **Google Ads API daily-spend reports are delayed ~3 hours.** Hourly cron writes to a `provisional=true` column; daily reconciliation at 03:00 UTC sets `provisional=false`.
9. **TikTok Marketing API has ~11h data latency.** "Hourly" cron is actually a 12-hour rolling reconciliation; surface this caveat in the admin dashboard.
10. **Vercel AI Gateway proxy headers.** OpenAI SDK call from Edge Function must set `baseURL` + propagate the `Authorization` header to the gateway, not directly to OpenAI. Same pattern as v1.2 Anthropic — reuse the helper.
11. **Anthropic web_search tool exclusion under BAA.** If HIPAA BAA is active, all `tools: [{type: "web_search_20250305"}]` calls must be gated by the per-user PHI-handler flag. Add an `assertNoWebSearchUnderBAA()` helper in `_shared/anthropic.ts`.
12. **Sentry Session Replay mask attribute.** `data-sentry-mask` must be on PHI containers BEFORE BAA activation, not after. Add an audit pass to the v1.3 plan-phase: `grep -r "@\\@/components/(BodyTab|MedicationTab|InsightsTab|AIChatPanel|DoctorReport|ShareView|ClinicDashboard)" src/` and verify each renders a `<div data-sentry-mask>` wrapper.
13. **PostHog `disable_session_recording_on_url` accepts regex.** Use route patterns, not exact match: `/^\/(medication|body|insights|coach|share|clinic|admin)/`.
14. **Capgo plugins lock-in.** v1.2 already adopted `@capgo/capacitor-health`. If we add `@capgo/capacitor-native-review` in v1.4 (deferred), monitor Capgo's pricing model — Capgo introduced paid tiers for some plugins in 2024-2025; verify plugin remains MIT-free at v1.4 plan-phase.

---

## Sources

**Live npm registry (HIGH confidence — versions verified 2026-05-17 via `npm view`):**
- `react-i18next` `15.7.4`, `i18next` `25.5.2`, `i18next-http-backend` `3.x`, `i18next-browser-languagedetector` `8.x`
- `posthog-node` `5.10.4`
- `@tanstack/react-query` `5.100.10`, `@tanstack/react-table` `8.x`, `@tanstack/react-virtual` `3.x`
- `openai` `6.13.0`, `voyageai` `0.2.1`
- `canvas-confetti` `1.9.3`
- `react-markdown` `9.x`, `remark-gfm` `4.x`, `rehype-sanitize` `6.x`, `dompurify` `3.2.7`
- `facebook-nodejs-business-sdk` `24.0.1`, `google-ads-api` `23.0.0`
- `nanoid` `5.1.6`, `react-hotkeys-hook` `5.1.0`
- `@aws-sdk/client-sesv2` `3.700+`
- `@react-email/render` `2.0.8`, `@react-email/components` `0.13.11` (referenced but NOT added — current Resend templates work without)

**Context7-verified library docs (HIGH confidence — 2026-05-17):**
- `/i18next/react-i18next` — Suspense + namespaces + HTTP backend lazy-loading patterns confirmed

**Official vendor docs (HIGH confidence):**
- [Supabase: HIPAA Compliance](https://supabase.com/docs/guides/security/hipaa-compliance)
- [Supabase: HIPAA Projects](https://supabase.com/docs/guides/platform/hipaa-projects)
- [Supabase: pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Vercel: HIPAA BAAs available to Pro teams](https://vercel.com/changelog/hipaa-baas-are-now-available-to-pro-teams)
- [Vercel: HIPAA Compliance Guide](https://vercel.com/kb/guide/hipaa-compliance-guide-vercel)
- [Anthropic: HIPAA-ready Enterprise plans](https://support.claude.com/en/articles/13296973-hipaa-ready-enterprise-plans)
- [Anthropic: Business Associate Agreements for Commercial Customers](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers)
- [Anthropic: Zero Data Retention](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)
- [Sentry: Business Associate Amendment](https://sentry.io/legal/baa/)
- [Sentry: Privacy / data scrubbing](https://sentry.io/trust/privacy/)
- [PostHog: HIPAA Compliance docs](https://posthog.com/docs/privacy/hipaa-compliance)
- [PostHog: BAA generator](https://posthog.com/baa)
- [PostHog: Feature flags best practices](https://posthog.com/docs/feature-flags/best-practices)
- [Stripe (via patient-protect)](https://patient-protect.com/post/is-stripe-hipaa-compliant) — Stripe does not sign BAAs; banking-exemption pattern
- [Paubox: Amazon SES vs Paubox](https://www.paubox.com/blog/amazon-ses-vs-paubox-email-api-for-hipaa-compliant-email)
- [Resend: Receiving Emails (Inbound)](https://resend.com/docs/dashboard/receiving/introduction)
- [Resend: Legal](https://resend.com/legal) — no public HIPAA BAA documentation as of 2026-05-17
- [Better Stack: Pricing](https://betterstack.com/pricing)
- [Meta: facebook-nodejs-business-sdk](https://github.com/facebook/facebook-nodejs-business-sdk)
- [Google Ads API: Node client (Opteo)](https://github.com/Opteo/google-ads-api)
- [TikTok Business API SDK](https://github.com/tiktok/tiktok-business-api-sdk)
- [Apple: SKStoreReviewController](https://developer.apple.com/documentation/storekit/skstorereviewcontroller)

**Web research, multi-source verified (MEDIUM confidence):**
- Supabase Team tier + HIPAA add-on pricing ($599 + $350) — cross-checked across blaze.tech + metacto.com + supabase docs
- Vercel Pro + HIPAA add-on $350/mo — cross-checked with Vercel changelog + checkthat.ai + community discussions
- PostHog Enterprise add-on $2,000/mo — cross-checked across PostHog platform-packages + userpilot.com
- Anthropic enterprise BAA configuration requirements — confirmed via privacy.claude.com + support.claude.com + aptible.com
- Resend HIPAA BAA NOT publicly documented — confirmed by direct fetch of resend.com/legal + resend.com/pricing (no HIPAA mention)

**Cross-checked against v1.1 + v1.2 LeanShot project memory:**
- Bundle ceiling discipline (`sync-defer.ts`, per-chunk gz ceilings) — preserved from v1.1 + v1.2
- Vercel AI Gateway proxy posture for AI providers — preserved from v1.2 (used for Anthropic; extends to OpenAI)
- Supabase migration filename strict timestamp format (`<14digits>_name.sql`, NO letter suffix) — preserved from Phase 19 BL-10 lesson
- Worktree-base drift prevention + pathspec commit isolation — preserved as the parallel-execution rule
- Capgo plugin maintenance status caveat — re-flag if v1.4 mobile adds Capgo plugins

---

*Stack research for: LeanShot v1.3 — Platform Expansion (Revenue + Depth + B2B + HIPAA + Foundation + Onboarding/Gamification/Helpdesk/AI-personalization-partial)*
*Researched: 2026-05-17*
*Net-new vendors: Better Stack (status), AWS SES (HIPAA email path conditional), Meta/Google/TikTok Ads APIs (read-only ETL). Net-new libraries: react-i18next family, posthog-node, @tanstack/{react-query,react-table,react-virtual}, openai, canvas-confetti, react-markdown family, dompurify, @aws-sdk/client-sesv2, react-hotkeys-hook (optional). Tier upgrades on HIPAA activation: Supabase Pro→Team+addon, Vercel Pro+addon, Sentry→Business, Anthropic→Enterprise, optional OpenAI→Enterprise, optional PostHog→Boost.*
