# Feature Research — LeanShot v1.3 Platform Expansion

**Domain:** Multi-audience health-tracker SaaS (GLP-1 vertical) — v1.3 = revenue depth + B2B/HIPAA + onboarding/retention engine
**Researched:** 2026-05-17
**Confidence:** HIGH on platform-store rules + Stripe/legal constraints + AI deflection benchmarks; MEDIUM on conversion-tactic specifics + paywall placement; LOW on cross-network ad-spend deduplication exact precision

> **Scope guardrail:** this file covers ONLY the **17 NEW v1.3 feature areas** scoped in `PROJECT.md`'s "v1.3 megamilestone". v1.2-shipped surfaces (B2C cloud sync, AI coach, doctor share, clinic operator surface, page builder v1 with 8 blocks, design system v2, photo trash, knip CI, Stripe Connect Express affiliate v1, etc.) are NOT re-analyzed — see `.planning/milestones/v1.2-research/FEATURES.md`. This document **builds on** v1.2 research, doesn't replace it.

> **Audience asymmetry rule** (inherited from `feedback_regulator_vs_user_audience_pattern.md`): aggressive on end-user-facing UX (onboarding, gamification, helpdesk, embeds, i18n); cheapest defensible posture on regulator/process surfaces (HIPAA BAA chain, multi-tier admin schema). Applied per-feature below.

---

## Cross-Cutting Constraints (v1.3-specific, additive to v1.2)

1. **HIPAA BAA chain becomes load-bearing** — when v1.3 ships, first signed clinic deal is target; entire data path (Supabase → Vercel → Resend → Sentry → OpenAI/Anthropic) must have BAAs in place. Any new vendor introduced in v1.3 needs a BAA pass before it touches PHI. (HIGH — see `linfordco.com/blog/saas-hipaa-considerations/`)
2. **Mid-trial paywall + pharmacology paywall = reputational tightrope** — core-clinical-value gating is a brand risk. Decision must be made BEFORE shipping with explicit "what stays free on principle" carve-out (e.g., drug interactions safety-critical info NEVER paywalled).
3. **B2B2C billing introduces a third actor** (clinic operator pays for patient's seat) — every existing RLS path that assumes `user_id → org_id` direct ownership needs a `paying_org_id` column to disambiguate. Schema migration is M1 territory.
4. **Anonymous-to-authenticated session merge** is the M2 onboarding load-bearer; existing v1.2 store-merge logic was designed for "local-only → cloud sync" not "anonymous-trial → signup" — this is the highest-risk v1.3 schema change.
5. **Gamification ethics is a brand-level decision** — Duolingo's playbook drives 60% engagement but the leaderboard "XP grinding" + sad-mascot dark patterns are publicly criticized. LeanShot health audience makes this asymmetric: ethical-only patterns.
6. **Ad-spend ETL ≠ HealthKit data path** — v1.3's hourly ad-spend ingestion (Meta/Google/TikTok Ads APIs → PostHog join) is **inbound spend data only**, never outbound user-attributes. Two-tunnel firewall (v1.2) already enforces; reaffirm during M5a planning.

---

## Foundation Layer (M1-gaps + M5a)

### 1. Modular admin shell + bulk actions + admin 2FA

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Per-module routing (e.g. `/admin/billing`, `/admin/affiliates`, `/admin/orgs`) with code-split chunks | v1.2 admin already at 60%; mod splits prevent admin-bundle from monopolizing single chunk | M | Builds on v1.2 `AdminLayout`. Each module = lazy `import()` |
| Bulk actions on Members table: CSV export, tag/untag, comp-sub, ban, force-reset password | v1.2 has member CRUD per-row; bulk is the support-floor escalation | M | Checkbox-multi-select pattern; queued via Edge Function for >100 rows |
| Admin 2FA enforcement (mandatory TOTP for `role='admin'`) | Defense-in-depth; admin compromise = customer-data breach | M | Supabase Auth has built-in `mfa.enroll()`. ESLint regression guard on admin route mounting check |
| Per-module Edge Function permission checks | Today admin role is checked client-side + at RLS; Edge Functions need server-side `admin` claim verification | S | Reusable `assertAdmin(req)` helper |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Admin command palette (Cmd+K) for fast member lookup + action shortcuts | Saves seconds on every support ticket | M | Combo box + fuzzy-search v1.2 members table |
| Audit-log diff viewer (what changed when admin X edited member Y) | Compliance + accountability | S | Reuse v1.2 `audit_logs`; pretty-diff JSON |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Per-admin custom role builder (Notion-style permission matrix) | Permission combinatorics explode; we have 3 roles (owner/admin/support) | Fixed role set; promote/demote only |
| Real-time admin presence | No operational value at our scale | Defer |

**Dependencies on v1.2:** Builds on Phase 22 admin foundation (`AdminLayout`, members table, impersonation, audit-logs). M1 absorbs ~40% net-new code; ~60% is hardening + bulk-action extensions.

**Complexity overall: M**

### 2. Event taxonomy + server-side PostHog capture + cohort builder + session replay PII masking

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Canonical event taxonomy versioned in repo (`/src/lib/analytics/events.ts`) | Without it, ad-blocker + dev-typo regressions silently lose conversion data | M | Single source of truth; typed event names + props; lint-rule forbids `capture('arbitrary string')` |
| Server-side PostHog capture for signup/payment/activation | Ad-blockers eat ~20-40% of client-side events on these critical path; server-side recovers | M | Edge Function relay; same event taxonomy used both client + server |
| Cohort builder in admin (signup-week × N-week retention, segment by tier/source/country) | M5a foundation for win-back, gamification cohort A/B | M | SQL views on top of PostHog events table OR Supabase mirror; admin UI = saved cohort queries |
| Session-replay PII masking (`data-private` + class allowlist) | Health data on screen = HIPAA + reputational risk | M | PostHog `session_recording.maskAllInputs=true` baseline + custom selector list for PHI cards |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Reverse-ETL of cohort definitions to Resend audiences | Cohort → behavior-triggered email without manual export/import | S | Supabase cron; cohort SQL → Resend Audience API |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Capture raw HealthKit values to PostHog for "richer analytics" | Two-tunnel firewall violation + HIPAA | Never. Metadata only (count, timestamp). |
| Auto-record session replay for 100% of sessions | Cost + privacy + storage | Sample 10%; opt-out for paid tier |

**Dependencies on v1.2:** PostHog already wired (v1.2 Phase 22 GDPR-02 consent-gated load). M5a adds the taxonomy + server relay + cohort tooling.

**Complexity overall: M-L** (the taxonomy work is small; the server-side relay + retroactive event-rename work is the bulk)

---

## Workstream A — Revenue / Growth

### 3. Multi-tier affiliate program (Standard / Gold / Lifetime)

Industry standard is **volume-threshold tier promotion** (not time-based), with progression visible to affiliate via dashboard progress bar. Real-world: Moosend (Bronze 30% → Diamond 40% at 36+ accounts), Reply (Blue → Gold at 51+ referrals). Source: [Rewardful Commission Guide](https://www.rewardful.com/articles/affiliate-commission-explained), [BoldDesk SaaS Affiliate List](https://www.bolddesk.com/blogs/best-saas-affiliate-programs) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Tier-promotion logic (Standard → Gold → Lifetime on threshold cross) | Tier value lost without auto-promotion | M | DB trigger on conversion insert; threshold + commission-rate per tier in `affiliate_tier_configs` table |
| Per-tier commission rate (e.g. Standard $10 flat, Gold $15 flat, Lifetime $25 flat OR % recurring) | Differentiated rates = motivation; flat rates from v1.2 → tiered $$ in v1.3 | M | Extends v1.2 `affiliate_conversions.commission_cents` to lookup tier-rate at conversion time |
| Partner dashboard progress bar ("3 more conversions to Gold") | Visible progression drives reach-for-the-tier behavior | S | Compute (count, threshold-distance) per-tier |
| Tier-downgrade rules (Standard if N-day rolling volume drops) OR lock-tier-forever | Avoid permanent rate-creep | M | **Pick locked-once-earned** for v1.3 (simpler + nicer); revisit if abuse |
| Tier-specific marketing assets (Gold partners get premium banner kit) | Differentiated treatment = perceived value | S | Builds on v1.2 marketing-assets bucket |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Lifetime tier = recurring commission for life of customer (vs flat) | Top 1% partners do 90% of volume; recurring keeps them locked-in | M | New schema: `affiliate_recurring_payouts` monthly cron; Stripe Connect transfer per customer-month |
| Public tier leaderboard (opt-in) | Social proof + tier-up motivation | S | Top 10 Gold/Lifetime; anonymized handles |
| Tier-specific exclusive Slack/Discord access | Community moat for top partners | S (gated link + audit) | Manual invite is fine |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Multi-level (recruit-partners-and-earn-from-their-conversions) | MLM regulatory + trust signal | Single-tier hierarchy; flat or recurring only |
| Auto-promote on signup ("welcome to Gold!") | No accomplishment signal | Threshold-gated only |
| Per-partner negotiated rates outside tier system | Schema sprawl + favoritism | Use Lifetime as the "VIP" lever instead |

**Dependencies on v1.2:** v1.2 Phase 19 shipped single-tier flat $10 + Stripe Connect Express + fraud detection. M-A adds tier logic on top; reuses payout cron + cascade-on-delete.

**Complexity overall: M** (mostly schema + dashboard UI; payout cron extends rather than replaces)

### 4. Mid-trial paywall A/B test (after activation event)

**Canonical pattern**: Behavioral-triggered paywalls outperform end-of-trial by 3.8x (one case: 5.8% → 13.4% in 4 months). The single most important predictor is **activation** (users completing key product actions convert at 3-5x the rate). Median trial-to-paid: 7.1% for 14-day trials, 3.6% for 30-day trials. Source: [Pulseahead Trial-to-Paid Benchmarks](https://www.pulseahead.com/blog/trial-to-paid-conversion-benchmarks-in-saas), [Stackmatix Trial Levers](https://www.stackmatix.com/blog/saas-trial-to-paid-conversion) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Activation event definition (e.g. "logged 3 injections + 1 weight in first 7 days") | Without activation event, paywall fires arbitrarily | S | M2 must define; M5a event taxonomy carries |
| Paywall trigger on activation-event-cross during trial | Industry-best practice | M | PostHog feature flag splits trial users into A (current = end-of-trial) vs B (mid-trial-on-activation) |
| Variant tracking: conversion, refund, 30-day retention (not just signup-to-paid) | Refund-rate after mid-trial paywall is the kill signal | M | PostHog experiment goal = paid+retained-30d (composite) |
| Auto-promote winner on statistical significance | Without this, experiments stall | M | PostHog flags ship variants; promotion = manual flag-flip after CI calc (see PostHog notes below) |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Contextual paywall ("you've logged 3 injections — unlock the 7-day projection") | Pulls forward the value-prop instead of generic "upgrade" | S | Per-feature paywall copy; ties to pharmacology gating |
| In-paywall offer A/B (annual discount vs free-trial-extension vs first-month-50%) | Stack with main A/B for compounded learning | M | Multi-variant PostHog flag |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Paywall on the pharmacology projection itself (the Core Value) | Brand risk; users feel bait-and-switched | Paywall on the **forward** projection only (past 28d stays free); decide at CONTEXT.md |
| Paywall on drug interactions / safety info | Liability + reputational nuke | Never paywall safety-critical |
| Hard paywall (no skip option) mid-trial | Tanks free-tier engagement metrics | Soft paywall with "skip for now" + re-prompt at end |

**Note on PostHog auto-promote:** PostHog handles statistical significance detection + winner identification, but **does NOT automatically promote** the winning variant to 100% traffic — that's a manual flag-flip after significance hits. (Source: [PostHog Testing experiments docs](https://posthog.com/docs/experiments/testing-and-launching), HIGH)

**Dependencies on v1.2:** Stripe Checkout + `<TierGate>` (v1.2 Phase 14) carries; PostHog flag infrastructure exists. **Critical dependency on M2:** activation event definition is M2 deliverable. M-A cannot ship paywall A/B until M2 ships activation event.

**Complexity overall: M**

### 5. Page-builder A/B test (PostHog flags + auto-stat-sig + admin UX for non-marketers)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Multi-variant landing page (publish "v2" alongside "v1" with traffic-split %) | Test infrastructure expectation | M | Extends v1.2 `landing_pages` schema with `variant_group_id` + `traffic_split_pct` |
| PostHog multivariate feature flag assigns visitor to variant | Industry-standard A/B mechanism | S | `posthog.getFeatureFlag('landing-pricing-2026')` server-side in `page-render` Edge Function |
| Goal-event tracking per variant (e.g. signup, Stripe-checkout-completed) | Without event tracking, "winner" is unverifiable | S | Variant ID = PostHog event prop |
| Stat-sig calculator visible to non-technical admin (one-click "promote winner") | Marketing must not need data scientist | M | PostHog computes; admin UI surfaces "Variant B winning with 95% confidence — Promote?" button |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Block-level A/B (test one hero vs another within same page) | More tests at smaller scope = faster learning | L | Block-tree variant references; mid-page swap on render |
| Auto-archive losing variant after promotion + email summary | Cleanup + learning loop | S | Cron + Resend digest |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Bandit/multi-armed-bandit auto-traffic-shifting | Stat complexity + harder to debug | Fixed 50/50 split + manual promote; revisit at v1.5+ |
| Cross-page funnel A/B (landing → pricing → checkout all-at-once) | Multi-page interactions explode variance | Single-page A/B; serialize page-level tests |

**Dependencies on v1.2:** v1.2 Page Builder schema (`landing_pages` + `landing_page_revisions`) carries. M-A adds variant grouping + PostHog wire-up + admin promotion UX.

**Complexity overall: M-L** (block-level A/B is the upgrade tax; page-level A/B alone is M)

### 6. Hourly ad-spend ETL (Meta + Google + TikTok Ads APIs → Supabase, joined with PostHog for CAC by source)

**API rate limits — HARD constraints:**
- **Meta Marketing API**: ~200 calls/hour/ad-account default; attribution windows recently restricted (7d-click, 1d-view max) [PPC.land Meta restrictions](https://ppc.land/meta-restricts-attribution-windows-and-data-retention-in-ads-insights-api/) (MEDIUM)
- **Google Ads API**: 15,000 ops/day basic-access, much higher standard-access; need approved developer token [Google Ads API Rate Sheet](https://developers.google.com/google-ads/api/docs/api-policy/rate-sheet) (HIGH)
- **TikTok Ads API**: 7d-click + 1d-view attribution by default (shortest of the three); requires Business Center approval [Improvado TikTok Challenges](https://improvado.io/blog/tiktok-ads-data-challenges) (MEDIUM)
- **Cross-network overcounting**: when 3 platforms run simultaneously, each claims the same conversion → platform-side numbers sum to 150–200% of actual revenue [AdLibrary Attribution 2026](https://adlibrary.com/posts/ad-attribution-tracking-explained-2026) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Per-network hourly cron (Vercel Cron → Edge Function → store in `ad_spend_hourly`) | Without hourly granularity, CAC trend lags | M | Three Edge Fns (one per network); exponential backoff on rate-limit |
| Server-side conversion send-back (Meta CAPI, Google Enhanced Conversions, TikTok Events API) | iOS 14+ killed client-side attribution accuracy; server-side is the floor | L | First-party tracking; hashed email/IP via server; bundles up daily, fires to each network's conversion-import endpoint |
| Reconciliation layer (deduplicate conversions across networks via PostHog `distinct_id`) | Without it, CAC math is wrong by 50-100% | M | Join `ad_spend_hourly` + PostHog conversions on shared distinct_id; last-touch attribution v1, time-decay v1.5 |
| Admin dashboard: spend / conversions / CAC / LTV by source per day | The whole reason to do the ETL | M | Builds on M5a cohort builder |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Auto-pause campaign on CAC > LTV threshold | Prevents bleeding budget | M | Triggers Slack alert + flips Meta/Google campaign-status via API |
| Per-creative ROI tracking (which ad creative converted) | Creative-level learning | L | Requires Meta `creative_id` + Google `ad_id` in conversion events |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Sub-hourly cron (e.g. every 5 min) | Rate-limit headroom + cost; not actionable | Hourly is the floor for actionable signal |
| Pulling HealthKit / Health-import data into attribution joins | Two-tunnel firewall violation | Spend + PostHog only; Health stays firewalled |
| Trusting any one network's reported conversions | Self-reported numbers overstate by 50-100% (platform optimization bias) | Always reconcile to PostHog + Stripe ground-truth |

**Dependencies on v1.2:** PostHog + Edge Functions + admin dashboard infrastructure all exist. New: cron infrastructure (Vercel Cron already used in v1.2; M-A adds 3 fresh schedules + per-network API client libs).

**Complexity overall: L** (per-network API client + reconciliation layer is the bulk; the cron + dashboard is straightforward)

---

## Workstream B — Product Depth (web)

### 7. Embed-provider blocks (Calendly + YouTube + Tally)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| 3 new block types in page-builder: Calendly, YouTube, Tally | The 3 most-requested embed targets for SaaS landing pages | S | One JSON schema + one React component per provider; reuses v1.2 page-builder block API |
| Provider-specific sandboxing (`<iframe sandbox="allow-scripts allow-forms">`) | XSS containment | S | Per-provider sandbox attribute allowlist |
| Lazy-loading (`<iframe loading="lazy">`) below-the-fold | Lighthouse Performance score | S | HTML attribute; fallback `IntersectionObserver` for above-fold-deferred |
| Consent-gated load (don't load Calendly until user grants "Functional" cookie) | GDPR + v1.2 vanilla-cookieconsent already wired | M | Block renders placeholder until `consent.functional === true`; then mounts iframe |
| Per-provider config UI in page-builder editor (Calendly URL, YouTube video ID, Tally form ID) | Without it, admin must hand-edit JSON | S | Block right-rail config form per type |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Calendly inline-embed with pre-filled email when visitor is logged-in | Higher booking conversion | S | URL param `?email={user.email}` |
| YouTube facade (poster image + play button → load iframe on click) | ~600KB savings per video on initial load | S | `lite-youtube-embed`-style pattern |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Generic "paste any iframe URL" block | XSS surface; consent-gating gets ambiguous | Whitelist 3 providers; add more via PR review |
| Tracking pixels / Hotjar / FullStory embed | Privacy + consent complexity | Channel through PostHog only |
| Auto-play YouTube videos | UX hostility + cookie consent triggers | Click-to-play only |

**Dependencies on v1.2:** Page Builder block infrastructure (v1.2 Phase 15) + vanilla-cookieconsent (v1.2 Phase 22 GDPR-01).

**Complexity overall: S-M**

### 8. Spanish i18n (react-i18next)

**Industry standard for SaaS:**
- **Namespace organization**: split by feature/domain (`common`, `dashboard`, `pricing`), keep nesting 2-3 levels deep max. Source: [Crowdin React i18n tutorial](https://crowdin.com/blog/react-i18n) (MEDIUM)
- **Pluralization**: ICU MessageFormat handles complex cases (Polish 4 forms, Arabic 6 forms); for EN→ES alone, i18next default `_one`/`_other` is sufficient
- **Translator workflow**: Crowdin (most common, GitHub sync + OTA updates) > in-house spreadsheets

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| `react-i18next` infrastructure + EN/ES namespaces split by surface (common/dashboard/marketing/email) | Industry baseline | M | One-time scaffold; lint-rule to forbid string literals in JSX after migration |
| Full Spanish translation of UI + transactional emails + KB articles | The point of the workstream | L | Translation work is the bulk; engineering is the framework |
| Language toggle in Settings + auto-detect from `Accept-Language` on first visit | Standard UX | S | localStorage persists user choice |
| Pluralization via i18next `_one`/`_other` keys (sufficient for EN/ES) | Without it, "1 dose"/"2 doses" breaks | S | Default i18next behavior |
| Server-side rendering of email templates in user's language | Email opens are language-sensitive | M | Resend template lookup by `lang` |
| Locale-aware number/date formatting (`Intl.NumberFormat`, `Intl.DateTimeFormat`) | Spanish uses comma decimals | S | Use native Intl, not date-fns custom |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Crowdin OTA updates for copy changes without app redeploy | Translators iterate without engineering | M | Crowdin CDN integration; load namespace JSON at runtime |
| AI-assisted draft translations (Claude) reviewed by human | Speed up translator throughput | S | Edge Function: source EN → Claude → ES draft → translator review queue |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Auto-translate via Google Translate API at request time | Translation quality + cost + latency | Pre-translated JSON files; AI-assisted drafts at build-time |
| Localize app store metadata at v1.3 | Spanish market entry decision is separate | Defer to post-v1.3 if Spanish web traction shows |
| Pluralize via JS string concat ("1 " + (count > 1 ? "doses" : "dose")) | Breaks immediately on any new language | i18next `t('dose_count', { count })` only |

**Dependencies on v1.2:** None (greenfield); just integrates with existing component tree.

**Complexity overall: L** (translation work is the bulk; framework is M; coverage audit + lint enforcement is M)

### 9. Pharmacology paywall test

**Reputational considerations** — this is a **brand-level decision** that should be made up front, not iterated. The pharmacology curve (28 days past + 7 days projected) IS the LeanShot core value per PROJECT.md. Paywalling it carries brand risk.

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Defined split: past-curve (free) + forward-projection (paid) | Without explicit split, gating gets contested | S | Decision artifact in CONTEXT.md; safety info NEVER paywalled |
| `<TierGate>` wrapper around forward-projection chart segments | Reuses v1.2 infrastructure | S | Already exists from Phase 14 |
| In-app upgrade prompt at the projection-blur boundary | Contextual paywall pattern | S | Inline CTA, not modal |
| PostHog event: `paywall_pharmacology_viewed` + `paywall_pharmacology_dismissed` | Measure rejection rate | S | M5a event taxonomy |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Free-tier weekly preview (Sunday: show full projection for the week to free users; then re-blur) | Demo the value without losing brand | M | Cron + tier-override window |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Paywall drug interactions / side-effect lookup | Safety-critical content; reputational nuke | NEVER. Free for all tiers. |
| Paywall current-dose tracking or basic chart | Core utility; users churn | Free. |
| Paywall doctor-share generation | B2B trust + flagship use case | Free. |
| Hide chart entirely behind paywall (vs blur with upgrade-CTA) | Removes preview value | Always show blurred preview |

**Dependencies on v1.2:** `<TierGate>` (v1.2 Phase 14). Pharmacology curve component (v1.0 baseline).

**Complexity overall: S** (the engineering is trivial; the brand decision is the load-bearer)

---

## Workstream C — B2B Clinic + HIPAA

### 10. Clinic organizations (B2B2C billing — per-active-patient vs flat per-seat vs hybrid)

**Industry pattern**: Healthcare SaaS uses **hybrid pricing** most commonly — per-patient metered + base subscription, OR per-provider-seat + per-encounter overage. Source: [Vozo Health Pricing Guide](https://www.vozohealth.com/blog/the-ultimate-guide-to-healthcare-software-pricing-models), [Dodo Hybrid Billing Models](https://dodopayments.com/blogs/hybrid-billing-models-saas) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| `organizations` table + `org_members` (role: admin/operator/billing) + `org_subscriptions` table | B2B foundation | M | Builds on v1.2 clinic operator surface |
| Stripe Billing per-active-patient metering (definition of "active" locked in CONTEXT.md) | Industry standard for value-aligned billing | M | "Active" = logged-event-in-last-30-days; nightly true-up to Stripe `usage_records` |
| Patient invite flow: clinic admin enters email → magic link → patient onboards under org | Flagship B2B onboarding | M | Reuses v1.2 magic-link infra; `org_member.added_by` audit |
| `paying_org_id` disambiguation column on `auth.users` | Decides whose Stripe sub funds this patient | M | RLS schema change; migration affects all v1.2 patient-data tables |
| Org admin dashboard (different from operator dashboard — billing, members, settings) | Distinct from clinical operator UI | M | Sub-route `/clinic/{slug}/admin` |
| Clinic-side patient roster with health-aware status (extends v1.2 roster) | v1.2 already ships roster + drill-in | S | Extends with billing-status badges |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| White-label theming (clinic logo + color overrides on patient-facing surfaces) | Premium clinic upsell | M | CSS variable injection per org; lock to font-stack to avoid full redesign |
| Custom rank weights (per-clinic configurable patient-priority scoring) | Carry-over from v1.2 Out-of-Scope | M | `org_rank_config` JSONB; operator dashboard sorts |
| Dose-trend alerts (clinic gets push when patient deviates from titration schedule) | Clinical workflow value | M | Cron + push fan-out (v1.2 push infra not yet shipped — block on P17) |
| Two-tier clinic plans (Lite per-patient $10/mo, Plus per-patient $20/mo + white-label) | Standard B2B segmentation | S | Stripe price catalog |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Per-seat (per-operator) billing only | Misaligns with patient-value clinic delivers | Hybrid: per-active-patient is primary; per-operator-seat optional add-on |
| Self-serve clinic signup (anyone-can-make-an-org) | Spam + impersonation + HIPAA risk | Manual approval + sales-call workflow for v1.3; self-serve in v1.5 |
| Multi-clinic per patient ("Dr. A AND Dr. B both see me") | Conflict resolution + RLS combinatorics | Single-clinic-per-patient v1.3; revisit |
| Patient sees clinic admin dashboard | Role-bleed | Strict RBAC: patient-view never includes admin tools |

**Dependencies on v1.2:** Existing clinic operator surface (v1.1 + v1.2 Phase 22). Stripe Billing + metering (v1.2 Phase 14). v1.2 Phase 19 affiliate `tier_effective` view (B2B sub adds 4th provider source — `org` on top of `stripe` + `revenuecat` + `manual`).

**Complexity overall: L-XL** (schema migration impact + Stripe metering + white-label + invite flow = biggest single v1.3 workstream)

### 11. HIPAA BAA path — what clinics actually ask for

**Bottom line from research**: A signed BAA is the **legally non-negotiable** floor. SOC 2 and HITRUST are **trust signals** but DO NOT replace the BAA. Source: [Total HIPAA — SOC2 vs BAA](https://www.totalhipaa.com/what-is-soc2-audit-and-can-it-replace-a-baa/), [Linford & Co SaaS HIPAA Guide](https://linfordco.com/blog/saas-hipaa-considerations/) (HIGH)

**What clinics actually ask for (in typical priority order):**
1. **Signed BAA** with LeanShot (REQUIRED before any PHI flows)
2. **Downstream BAAs** — list of every subprocessor that touches PHI (Supabase, Vercel, Resend, Sentry, OpenAI/Anthropic), each with its own BAA
3. **SOC 2 Type II report** (signal of operational security maturity)
4. **Encryption standards** — at rest (AES-256), in transit (TLS 1.2+), key management
5. **Incident response plan** + breach notification SLA (HIPAA requires ≤60 days)
6. **Access controls + audit logs** (who accessed which PHI when)
7. **MFA enforcement** for all employees with PHI access
8. **Annual risk assessment + employee security training**
9. **HITRUST certification** — bigger clinics ask; smaller don't; LOW priority for v1.3

#### Table Stakes (v1.3 must-ship for first BAA-signed deal)
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Signed BAA with Supabase (requires Team tier $599/mo) | Database holds the PHI | S (process; $$) | Upgrade gate + paperwork |
| Signed BAA with Vercel (Enterprise tier required) | Edge function runtime touches PHI | S (process; $$) | Negotiate; price-tier varies |
| Resend BAA OR switch to Paubox/AWS SES with BAA | Email contains PHI references | M | Resend BAA status as of 2026-05 — verify; AWS SES is the proven fallback |
| Sentry BAA (Business tier) | Error reports may carry PHI in stack traces | S (process; $$) | + Sentry data-scrubbing config to redact PHI fields |
| OpenAI / Anthropic Zero Data Retention + BAA (Enterprise / API ZDR addendum) | AI coach sees PHI | M | Anthropic offers ZDR on Enterprise tier; verify BAA availability — fallback: local-only summarization for BAA-clinic patients |
| Audit log hardening — every PHI read/write logged with `actor_id` + `accessed_user_id` | OCR audit requirement | M | Extends v1.2 audit_logs; add coverage to every PHI-touching Edge Function |
| MFA enforcement for all admin + operator roles | Compliance + security | M | Builds on M1 admin 2FA work |
| Periodic access reviews (quarterly cron → admin) | Compliance | S | Cron + admin UI surface |
| Employee security-training tracking + signed acknowledgments | Compliance evidence | S | Manual process; tracked in vendor checklist |
| Written policies (Privacy, Security, Incident Response, Breach Notification, Access Control) | OCR audit requirement | S | Template-based; legal review |
| Annual risk assessment | Compliance | S | Annual review; document in security wiki |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Self-serve BAA download for qualifying clinics (after sales workflow) | Speeds clinic onboarding | S | Templated PDF; e-sign integration optional |
| SOC 2 Type II in-progress badge on marketing site | Trust signal pre-completion | S | Image + "in progress" disclosure |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Marketing as "HIPAA-compliant" before all subprocessors have BAA | Legal exposure if breach | Wait until full chain is signed |
| HITRUST certification before SOC 2 | HITRUST is 10-20x cost + most clinics don't ask | SOC 2 Type II first; HITRUST only if a specific deal demands |
| Self-built BAA template | Legal liability | Use Supabase/Vercel/Resend templates + counsel review |

**Audience asymmetry note:** This is **regulator/process audience** — cheapest defensible posture wins. Don't build custom HIPAA-vault encryption when Supabase Team tier delivers compliance for $599/mo. Counsel for BAA templates + the vendor-tier upgrades = ~$5-15k in v1.3; everything else is process work.

**Dependencies on v1.2:** v1.2 Phase 22 admin foundation + audit-logs. New: Supabase Team tier upgrade is the hard $$ gate.

**Complexity overall: L** (process + paperwork + vendor tier upgrades; engineering is M)

---

## Workstream M2 — Onboarding Overhaul

### 12. Onboarding overhaul (progressive disclosure + value-first + magic link + smart defaults)

**2026 SaaS onboarding best practices:**
- **Time-to-value > everything** — fewer signup fields, more product-first
- **Progressive disclosure** — show essentials first, reveal complex options as needed [UXPin Progressive Disclosure 2026](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/) (MEDIUM)
- **Magic link / passwordless** — Figma + Linear pattern; reduces password-reset funnel drop
- **Anonymous-then-merge** — let user experience value, then commit (Figma "design in browser first" pattern)
- **Smart defaults from Accept-Language + IP** — pre-fill country, language, units (kg/lb) [Arcade Onboarding 2026](https://www.arcade.software/post/customer-onboarding-best-practices) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Anonymous-trial session (no signup required to start tracking) | Industry-leading conversion pattern | L | New: `anonymous_sessions` table; localStorage handoff on signup; **critical schema risk** — must atomically merge into authenticated user on signup |
| Magic link auth + Google/Apple OAuth (in addition to existing email/password) | Passwordless = 30%+ less signup-funnel drop | M | Supabase Auth has built-in magic-link + OAuth; UI rework |
| Single-question-per-screen wizard (vs v1.2 multi-field-per-step) | Mobile-parity + cognitive load reduction | M | Refactor existing 7-step wizard |
| Smart defaults: country from IP, language from Accept-Language, units (kg/lb) from country | Skip 3 questions = higher completion | S | Existing geo-IP + `navigator.language`; defaults are overridable |
| Activation event definition + measurement (e.g. "logged 3 injections + 1 weight in first 7 days") | M-A paywall A/B depends on this | S | Decision artifact + event implementation; M5a taxonomy |
| Resumable cross-device (start onboarding on phone, finish on laptop) | Mobile-to-desktop handoff | M | Onboarding state persisted server-side per user |
| Mobile parity (≥44px tap targets, single-thumb reachable controls) | Mobile-first onboarding | M | Component audit; sticky CTAs |
| Social proof on signup screen (logos / testimonials) | Industry standard | S | Static asset; ties to v1.2 page-builder testimonial block |
| Admin drag-and-drop step builder (operator can add/reorder onboarding steps) | A/B test new flows without redeploy | M | Reuses v1.2 page-builder dnd-kit infrastructure |
| A/B variant rollout via PostHog flags | Test new onboarding flows | S | Same flag infra as M-A |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Pre-fill medication + dose from prescription photo (Claude vision API) | Magical first-impression; saves 4 fields | M | Edge Function: image upload → Claude → parsed JSON → confirmation UI |
| Gamified onboarding completion (XP for completing each step) | Ties to M3 gamification | S | Trigger XP grant; ties to M3 work |
| Branching onboarding by GLP-1 (semaglutide vs tirzepatide vs liraglutide) | Right-content-for-right-user | S | Per-drug step subset |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Mandatory email verification before any product use | Conversion killer | Verify async; allow product use during verification window |
| 7-step wizard with all-fields-required | High abandonment | Single-question-per-screen + most fields skippable |
| Modal-blocking tour on first dashboard visit | Hostile; users want to explore | Inline tooltips + dismissable callouts |
| Force credit card before any value | Trial-conversion antipattern (covered by v1.2 7d-card-required trial as compromise) | Anonymous + card-required at activation event, not at signup |

**Critical schema dependency:** Anonymous-to-authenticated session merge is the **highest-risk v1.3 schema change**. Existing v1.2 store-merge logic was designed for "local-only → cloud sync" not "anonymous-trial → signup". Must atomically: (1) create real auth.users row, (2) re-assign all anonymous-session rows from `session_id` to `user_id`, (3) delete anonymous session, (4) handle race conditions if user signs up twice from same browser. **Plan for dedicated migration phase + e2e tests** before exposing.

**Dependencies on v1.2:** v1.2 Phase 22 lifecycle email (welcome) carries; magic-link Supabase Auth exists. Page-builder dnd-kit (v1.2 Phase 15) reused for step builder.

**Complexity overall: L-XL** (anonymous-session merge + admin step builder + smart defaults stack)

---

## Workstream M3 — Gamification + Review Prompt

### 13. Gamification engine (XP / levels / freeze tokens / leaderboards / weekly challenges)

**Duolingo playbook benchmark**: streaks increase commitment 60%, XP leaderboards drive 40% more engagement, streak-freeze reduced churn 21% for at-risk users (daily users averaged 17.19 streak-days past 7-day mark with freeze vs 11.62 without). Source: [Orizon Duolingo Gamification](https://www.orizon.co/blog/duolingos-gamification-secrets), [Trophy Duolingo Case Study](https://trophy.so/blog/duolingo-gamification-case-study) (MEDIUM)

**Ethical constraints (health audience)**: NO sad-mascot push, NO escalating visual urgency (flame-icon faster animations), NO XP-grinding-favors-easy-content. Source: [DEV Duolingo Dark Patterns](https://dev.to/yaptech/duolingos-shallow-learning-trap-gamified-streaks-harmful-habits-4134) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| XP awarded on tracked events (log dose, log weight, complete check-in) with per-event point values | Foundation | M | `xp_events` table; per-event-type config; nightly aggregate |
| Levels (every N XP unlocks next level + cosmetic reward) | Progression loop | S | Level curve config; UI badge |
| Streak counter (existing v1.0) + Streak Freeze tokens (earned weekly, max 2 stockpiled) | The single highest-impact mechanic | M | Extends v1.0 `streaks`; `streak_freezes` table; consumed automatically on missed day |
| Weekly challenges (e.g. "Log every dose this week" → 200 XP + freeze token) | Engagement loop | M | Per-week challenge JSON config; cron generates user-challenges; admin can author new challenges |
| Optional opt-in leaderboard (weekly XP) — anonymized handles + opt-in only | Social proof without forced exposure | M | Per-week reset; user can opt-out anytime |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Streak repair (one-time-per-month "I missed a day, restore my streak") | Loss-mitigation without monetizing anxiety (vs Duolingo paid freeze) | S | Cooldown gate; no monetization |
| Achievement badges (first 7-day streak, first month, first titration step, first 100 doses) | Reinforcement | M | `achievements` table; trigger on event; v1.2 DS-10 illustrations exist |
| Share-card on level-up (auto-generated PNG for social) | Viral loop | S | Reuses v1.2 share-card infrastructure |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Monetized streak freeze (pay to recover lost streak) | Ethical line in health context; Duolingo-style dark pattern | Freezes earned only; one free repair/month |
| Sad-mascot guilt notifications | Manipulative; brand risk in health vertical | Operational reminders only ("you have 4 hours to log") |
| Escalating-urgency push (faster animations, red badges late in day) | Same | Calm + steady push timing |
| Global cross-tenant leaderboard for clinics | Competitive sorting between patients of different clinics is wrong | Per-clinic only OR opt-in personal-only |
| XP for clinical actions that pressure over-titration | Health harm risk | XP only for tracking-completeness, never for clinical-outcome metrics |

**Dependencies on v1.2:** v1.0 streak engine + v1.2 DS-10 gamification illustrations (bronze/silver/gold badges, achievement-shield) already shipped.

**Complexity overall: M-L**

### 14. Review prompt engine (two-stage: internal NPS → external review or feedback ticket)

**Canonical pattern**: Show emoji/NPS first → promoters get App Store/Play Store review CTA; detractors get internal feedback form (never go to public review). Apple allows max 3 prompts per 365 days. Source: [Apple Ratings & Reviews](https://developer.apple.com/app-store/ratings-and-reviews/) (HIGH), [Appcues review request examples](https://www.appcues.com/blog/mobile-app-review-request-examples) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| NPS prompt at moment-of-satisfaction (e.g. after 7-day streak hit, after first month, after doctor-share viewed) | Industry pattern | M | Trigger config per-event; max-per-user gate |
| Promoter route → native review prompt (iOS `SKStoreReviewController` / Android Play In-App Review) | Apple/Google approved review flow | M | Capacitor plugin (when P16 ships); web fallback = star-rating link |
| Detractor route → internal feedback form (becomes a helpdesk ticket) | Defuse before public negative review | S | Form → M6 ticket schema |
| Cooldown enforcement: max 3 prompts per 365 days (Apple), max 1 per quarter (our policy) | Compliance + UX | S | localStorage timestamp + server-side audit |
| Per-platform CTA (iOS → App Store deep link; Android → Play Store; Web → Trustpilot/G2) | Channel-right destination | S | Platform detection |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Detractor follow-up loop: AI-summarized feedback themes → product backlog | Closes the loop on negative feedback | M | Claude classification + admin dashboard |
| Promoter loop: thank-you email with referral-program nudge (M-A affiliate) | Ties to affiliate growth | S | Resend template + ref code |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Prompt every active user immediately on app open | Apple guidelines + UX hostility | Moment-of-satisfaction trigger only |
| Bribe-for-review ("get $5 if you review") | Apple §3.2.2(iii) violation + review-platform fraud | Genuine satisfaction-trigger only |
| Send detractors to public review platform | Defeats the purpose | Internal feedback ticket only |

**Dependencies on v1.2:** M3 review-prompt engine depends on **M5a event taxonomy** (need stable event names to trigger off) + **M2 activation event** (one valid satisfaction-moment). Native review APIs depend on P16 mobile shells (v1.2 deferred to v1.4).

**Complexity overall: M**

---

## Workstream M5b partial — AI Personalization Recommender

### 15. Next Best Action + content recommendations (pgvector + weekly Claude summary + win-back)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| pgvector extension + embeddings for user-activity profiles | Foundation | M | Supabase has pgvector built-in; HNSW index on `user_profile_embeddings`; cosine similarity (`<=>` operator). Source: [Supabase pgvector docs](https://supabase.com/docs/guides/database/extensions/pgvector) (HIGH) |
| Embedding generation cron (nightly: user-activity → OpenAI/Cohere embedding → store) | Without it, no similarity search | M | Edge Function cron; batch API for cost |
| Next-Best-Action card on dashboard ("Try logging your sleep — users like you log it 4× more often") | Visible recommendation surface | M | Top-K similar users → their most-engaged-with feature this user doesn't use yet |
| Weekly Claude summary email (every Sunday: "Your week in numbers + 1 insight") | Engagement loop | M | Cron + Claude prompt + Resend |
| Win-back prompt for at-risk users (no log in 14 days) | Churn save | M | Cohort: stale users; Resend campaign; in-app modal on return |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| AI Coach memory (last 30-day summary persisted as embedding context) | More personalized coach replies | M | Embed summaries; inject into AI Coach context window |
| Cross-user pattern detection ("users on 2.4mg semaglutide commonly report constipation around week 6") | Cohort-level insight | L | Aggregated, anonymized pattern surfacing; review by clinician before launch |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Predictive churn model that scores users with churn-risk visible to operators | Reductive labeling + breeds bias | Behavior-trigger emails instead |
| Recommendations that pressure clinical decisions ("increase your dose") | Out-of-scope for non-clinician; safety risk | Tracking-completeness only |
| Embed-search across patient PHI without RLS | Cross-tenant leak | RLS on `user_profile_embeddings` strict; embeddings cleared on user-delete |

**Dependencies on v1.2:** M5a event taxonomy + cohort builder. Resend infrastructure carries. Anthropic Edge Function infrastructure carries.

**Complexity overall: M-L**

---

## Workstream M6 — Helpdesk Core

### 16. Helpdesk core (in-app widget + email-to-ticket + AI assist + KB + SLA)

**AI deflection benchmarks 2026**: best-in-class 55-65% (Intercom Fin: 37.4% in one test; some "true resolution" platforms claim 90%+ — definitions vary). Source: [ServiceDeskAgents 2026 Benchmarks](https://servicedeskagents.com/deflection-rates/), [Duckie Resolution vs Deflection](https://www.duckie.ai/blog/ai-ticket-resolution-vs-deflection-why-90-resolution-beats-40-deflection) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| `tickets` + `ticket_messages` + `ticket_tags` schema with RLS (user sees own; admin sees all) | Foundation | M | New schema; reuse v1.2 audit pattern |
| In-app help widget (lazy-loaded button bottom-right; opens chat-style UI) | Industry standard | M | New component; lazy-loaded to keep main bundle small |
| Email-to-ticket via Resend Inbound | Standard channel | M | Resend has inbound webhook; parse → ticket; thread on Message-ID |
| AI assist via Claude (drafts reply + auto-tags + auto-routes by topic) | M6 differentiator + agent throughput | L | Claude classification + draft generation; agent reviews/edits before send |
| Knowledge-base articles with search (markdown source in repo or Supabase table) | Self-serve deflection | M | Page-builder pattern; per-locale; search via Postgres FTS or pgvector |
| AI-powered KB suggestions in widget BEFORE ticket creation | Pre-emptive deflection | M | User types query → top 3 KB matches surfaced first; ticket only if user clicks "still need help" |
| SLA tracking (first-response-time + resolution-time per priority) | Internal metric + admin visibility | S | Computed columns + admin dashboard |
| CSAT survey post-resolution | Quality metric | S | 1-question email post-close |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Auto-route by topic (billing → @billing-agent; clinical → @clinical-agent) | Right-person-right-ticket | M | Claude classification → routing rule |
| AI auto-resolve for high-confidence simple queries (refund-request with matching policy, password-reset link) | True resolution layer | L | Confidence threshold; user can escalate; full audit log |
| Inline screenshot capture in widget (user uploads screenshot via paste) | Faster diagnosis | S | Browser clipboard API |
| Ticket merge / split / parent-child | Power-user agent workflows | S | Standard helpdesk feature |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Force phone-call escalation in widget | Out-of-scope; we're SaaS not call-center | Email-only escalation |
| AI auto-reply without agent review (for first message) | Risk of wrong-info; brand damage | Draft-only initially; auto-send only on high-confidence + bounded categories |
| Shared inbox in a separate tool (Zendesk/Intercom integration) | Adds vendor + cost + sync complexity | Built-in own helpdesk; Intercom migration is post-v1.3 if needed |
| AI access to patient PHI for context (e.g. "summarize their dose history before replying") | HIPAA risk if Claude sees PHI without proper BAA + ZDR | Defer until full BAA chain confirmed (workstream C) |

**Dependencies on v1.2:** Resend infra (v1.2 Phase 22). Anthropic infra (v1.0). New: Resend Inbound is a separate Resend feature requiring config + DNS MX record.

**Complexity overall: L** (the AI assist layer is the bulk; ticket schema + widget + KB are M each)

---

## Workstream M7 selective — Cancellation Saves + Status Page

### 17. Cancellation save offers (pause / downgrade / discount / extended trial)

**Industry benchmarks**: Churnkey reports 34% avg save rate (15-30% is "good", 30-42% is "top performers"). Pause: customers who accept stay 5.5 months longer; 60-70% of paused subs resume vs 8-12% of fully-cancelled win-back. Discount: 20-30% off for 2-3 months saves 20-35% of price-sensitive cancellers. Source: [SmartSMS Subscription Save Playbook](https://smartsmssolutions.com/resources/blog/business/article-3-spoke-subscription-save-offers-pause-cancel-winback) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Cancellation flow with required reason-selection (5-7 reasons + "other") | Without reason, can't match offer | M | Custom UI before Stripe Customer Portal cancel |
| Reason-matched save offer (price → discount; missing feature → roadmap link; temporary situation → pause) | The whole point | M | Per-reason offer map; admin-configurable |
| Pause subscription (Stripe `pause_collection`) for 1-3 months | Highest-recovery lever for "temporary situation" | M | Stripe API supports natively; in-app re-activation UI |
| One-time discount (Stripe coupon: 20-30% off for 2-3 months) for "too expensive" | Standard | S | Pre-created Stripe coupons; admin can disable |
| Win-back email at +30 / +60 / +90 days post-cancellation | Standard 5-15% recovery | M | Resend automation; campaign branching per cohort |
| Exit-reason tracking → admin dashboard | Product learning | S | Aggregate per reason; tie to PostHog |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Personalized save offer based on usage (high-usage user → "extend trial" offer; low-usage → "let us help you get more value") | Reason-matched + behavior-aware | M | Cohort-aware offer selection |
| Free month for clinic-referred patient if they explain barrier | High-touch for high-LTV cohort | S | Manual approval step |
| Save-call CTA for >$X MRR customers ("Want to talk to a human?") | High-touch for high-value | S | Calendly embed (M-B blocks) |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Make cancel button hard to find / dark patterns | FTC + EU Modernisation Directive + brand damage | Clear cancel path; offers are alternatives, not blockers |
| Auto-discount-everyone | Trains users to cancel-for-discount | Reason-gated only |
| Permanent discount (lifetime 50% off) | Caps LTV forever | Time-limited (2-3 months) discounts only |

**Dependencies on v1.2:** v1.2 Phase 14 Stripe Customer Portal cancel-flow + v1.2 Phase 22 Resend lifecycle infrastructure carries.

**Complexity overall: M**

### 18. Public status page (Better Stack vs Upptime)

**Recommendation: Better Stack.** Upptime is GitHub-Actions-based (5-min polling, depends on GitHub status, free) and best for "developer team lives in GitHub". Better Stack ($22/user/mo) bundles monitoring + status page + incident management + alerting (email/Slack/Teams) into one tool; "anyone on the team can update during an incident without git". For LeanShot (B2B clinic deal pipeline; support is a CSM not a dev), Better Stack is right. Source: [Better Stack Statuspage Alternatives](https://betterstack.com/community/comparisons/statuspage-alternatives/) (MEDIUM)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Public status page at `status.leanshot.app` | B2B signal of operational maturity | S | Better Stack subdomain config |
| Per-service status (Web App / Mobile App / AI Coach / Sync / Email / Push) | Granular visibility | S | Per-service monitors |
| Incident posts with timeline (investigating → identified → monitoring → resolved) | Standard incident comms | S | Built-in to Better Stack |
| Subscriber notifications (email/Slack/RSS) | Stakeholder updates | S | Built-in |
| Uptime SLA visible (e.g. 99.95% last 30 days) | B2B trust signal | S | Built-in |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Maintenance window scheduling | Pre-comms reduce surprise tickets | S | Built-in |
| Auto-incident-on-monitor-alert | Reduces lag between detection + comms | S | Built-in to Better Stack |

#### Anti-Features
| Feature | Why Avoid | Alternative |
|---|---|---|
| Build our own status page | Time-sink for zero competitive advantage | Better Stack |
| Hide incidents to avoid scaring users | Trust nuke when discovered | Transparent + fast resolution comms |

**Dependencies on v1.2:** None (greenfield service); just DNS + Better Stack account.

**Complexity overall: S** (vendor config + subdomain DNS)

---

## v1.3 Cross-Workstream Feature Dependencies

```
[M1 Foundation — Admin + Event Taxonomy]
  ├──blocks── M-A paywall A/B test (needs event taxonomy)
  ├──blocks── M-A page-builder A/B (needs PostHog event coverage)
  ├──blocks── M3 review prompt engine (needs event triggers)
  ├──blocks── M5b NBA recommender (needs cohort builder)
  └──blocks── M6 helpdesk AI (needs server-side event capture for ticket-context)

[M2 Onboarding Overhaul]
  ├──blocks── M-A paywall A/B test (activation event is M2 deliverable)
  ├──blocks── M3 review prompt (one valid satisfaction moment is M2 activation)
  ├──blocks── M3 gamification (onboarding-completion XP grant ties in)
  └──enables── M5b NBA (user-profile-embeddings begin at signup)

[M-A Revenue]
  ├──multi-tier affiliate ──requires── v1.2 Phase 19 single-tier (already shipped)
  ├──paywall A/B ──requires── M1 event taxonomy + M2 activation event
  ├──page-builder A/B ──requires── v1.2 Phase 15 page-builder + M1 event taxonomy
  └──ad-spend ETL ──requires── M1 event taxonomy + PostHog server-side capture

[M-B Product Depth]
  ├──embed blocks ──requires── v1.2 Phase 15 page-builder + v1.2 Phase 22 consent (vanilla-cookieconsent)
  ├──Spanish i18n ──independent── of M-A/M-C; can ship parallel
  └──pharma paywall ──requires── decision-artifact (no engineering blocker)

[M-C B2B Clinic + HIPAA]
  ├──organizations + B2B billing ──blocks── on schema migration + v1.2 Phase 14 Stripe metering
  ├──dose-trend alerts ──blocks── on P17 push fan-out (v1.4 work; degrade to email-only at v1.3)
  ├──custom rank weights ──carry-over── from v1.2 Out-of-Scope
  └──HIPAA BAA chain ──serial-process── (legal/vendor parallel to engineering)

[M3 Gamification + Review]
  ├──XP/levels/streaks ──extends── v1.0 streak engine + v1.2 DS-10 illustrations
  ├──leaderboards ──requires── M1 event taxonomy
  └──review prompt ──requires── M5a event taxonomy + M2 activation event

[M5b Recommender]
  ├──pgvector ──requires── Supabase Pro (already on plan) + pgvector extension enabled
  ├──NBA cards ──requires── M5a cohort builder
  └──weekly Claude email ──requires── v1.2 Resend infra

[M6 Helpdesk]
  ├──in-app widget ──independent── of M1/M2 schema work
  ├──email-to-ticket ──requires── Resend Inbound DNS config + parser
  ├──AI assist ──requires── HIPAA BAA chain or strict no-PHI-context for v1.3
  └──KB articles ──requires── Spanish i18n if shipping multi-lingual

[M7 selective — Cancellation + Status]
  ├──cancellation flow ──extends── v1.2 Phase 14 Stripe Customer Portal
  └──status page ──independent── (vendor service)
```

### Dependency Critical Path Analysis

The **M1 Foundation → M2 Onboarding → M-A paywall** path is the **longest serial dependency** in v1.3 — M-A paywall test is high-value but cannot ship until M1 taxonomy + M2 activation event are stable. **Recommendation: ship M1 + M2 as first wave; M-A/M-B/M-C/M3/M5b/M6/M7 parallelize after.**

**Workstream C (B2B + HIPAA)** can start legal/vendor work IN PARALLEL with engineering on M1 immediately (per PROJECT.md "HIPAA work starts immediately in parallel"). The engineering for `organizations` schema can start once M1 lands its admin-shell modularization (or it ships its own module).

**Workstream B Spanish i18n** is the most independent — it can ship as its own sub-phase any time after M1's event-name lint-rule lands (to avoid double-instrumentation rework).

---

## MVP Definition for v1.3

### Launch With (the "v1.3 GA" cut — per PROJECT.md megamilestone scope)

ALL 17 features above are in scope for v1.3 GA per the user's 2026-05-17 brief (Path 1 chosen, mobile v1.4 slips a quarter). Ruthless de-scope within each:

- **M1 admin** — bulk actions limited to top-5-most-frequent (CSV/tag/comp/ban/force-reset); per-module Edge Function permission checks done as a baseline pass not exhaustively
- **M1 PostHog hardening** — event taxonomy + server-side capture for SIGNUP/PAYMENT/ACTIVATION only at GA; expand coverage post
- **M-A paywall A/B** — single test (mid-trial-on-activation vs end-of-trial), not multi-variant offer-stacking
- **M-A multi-tier affiliate** — 3 tiers (Standard / Gold / Lifetime) with locked-once-earned, NOT downgrade-on-volume-drop
- **M-A page-builder A/B** — page-level only (block-level deferred to v1.5)
- **M-A ad-spend ETL** — Meta + Google at GA; TikTok added as fast-follow if growth team needs (TikTok API is the most fragile)
- **M-B embed blocks** — 3 providers only (Calendly + YouTube + Tally); no "generic embed" block
- **M-B Spanish i18n** — UI + transactional email + KB; in-app help articles only via Crowdin OTA (no localized marketing for non-LATAM)
- **M-B pharmacology paywall** — only forward-projection blur; past + safety free always
- **M-C clinic orgs** — manual-approval signup only; self-serve in v1.5
- **M-C HIPAA** — Supabase Team tier BAA + Vercel Enterprise BAA + Resend OR Paubox BAA + Sentry Business BAA + Anthropic ZDR ONLY. SOC 2 Type II in-progress at GA, completed post. NO HITRUST.
- **M2 onboarding** — anonymous-trial + magic link + single-question-per-screen + smart defaults; pre-fill-from-Rx-photo deferred
- **M3 gamification** — XP + levels + streak freeze + weekly challenges + opt-in personal leaderboard; cross-tenant leaderboards out
- **M3 review prompt** — web first (Trustpilot/G2); native iOS/Android review APIs land with P16 (v1.4)
- **M5b NBA recommender** — NBA cards + weekly Claude email + win-back; cross-user pattern detection deferred
- **M6 helpdesk** — widget + email-to-ticket + AI draft (agent-reviewed) + KB; auto-resolve confidence-gated to refund-request + password-reset only
- **M7 cancellation** — pause + discount + extended-trial offers; save-call CTA only for >$50/mo MRR
- **M7 status page** — Better Stack vendor service

### Add After Validation (v1.3.x patches in the 3 months post-v1.3)

- Multi-tier affiliate downgrade rules (if VIP partner abuse surfaces)
- Block-level A/B for page builder
- TikTok Ads API integration
- Per-creative ROI tracking
- Onboarding AI Rx photo pre-fill
- AI auto-resolve expanded categories (refund + password reset only at GA)

### Future Consideration (v1.4+)

- Native iOS/Android review prompts (depends on P16 v1.4)
- HITRUST certification (if a specific enterprise deal demands)
- M4 Community (deferred to v1.5)
- M5b full anomaly + churn model (deferred to v1.5)

---

## Feature Prioritization Matrix

| Workstream | User Value | Implementation Cost | Priority | Dependencies |
|---|---|---|---|---|
| M1 Foundation (admin + event tax) | HIGH (operator) | M-L | P1 | none — entry phase |
| M2 Onboarding Overhaul | HIGH | L-XL | P1 | depends on M1 lint rule |
| M-A Multi-tier Affiliate | MEDIUM-HIGH (growth) | M | P1 | v1.2 Phase 19 ✓ |
| M-A Mid-trial Paywall A/B | HIGH (revenue) | M | P1 | M1 + M2 |
| M-A Page-builder A/B | MEDIUM | M-L | P1 | v1.2 Phase 15 ✓ + M1 |
| M-A Ad-spend ETL | HIGH (CAC) | L | P1 | M1 |
| M-B Embed blocks | MEDIUM | S-M | P1 | v1.2 Phase 15 ✓ |
| M-B Pharmacology paywall test | MEDIUM (revenue) / HIGH (brand risk) | S | P1 | none — decision |
| M-B Spanish i18n | HIGH (TAM expansion) | L | P1 | independent |
| M-C Clinic orgs + B2B billing | HIGH (B2B revenue) | L-XL | P1 | v1.2 Phase 14 ✓ |
| M-C HIPAA BAA chain | LOAD-BEARING (B2B blocker) | L (process) | P1 | parallel legal track |
| M3 Gamification | HIGH (retention) | M-L | P1 | M1 + v1.0 streaks + v1.2 DS-10 ✓ |
| M3 Review prompt | MEDIUM | M | P1 | M2 + M5a |
| M5b Recommender (partial) | MEDIUM | M-L | P1 | M5a |
| M6 Helpdesk core | HIGH (operator) | L | P1 | independent |
| M7 Cancellation save | HIGH (retention) | M | P1 | v1.2 Phase 14 ✓ |
| M7 Status page | MEDIUM | S | P1 | independent |

**Highest cost-to-value:** Spanish i18n (translation labor) + M-C clinic orgs (schema sprawl + HIPAA chain). De-scope aggressively within each.

**Highest leverage:** M1 Foundation (everything downstream needs the event taxonomy) + M2 Onboarding (the activation event unblocks paywall + review + recommender).

**Hidden risk:** M2 anonymous-to-authenticated session merge schema change — highest-risk migration in v1.3. Plan for dedicated migration phase + e2e tests.

---

## Recommended Build Order (for ROADMAP phase ordering)

1. **Wave A — M1 Foundation (event taxonomy + admin shell modularization + PostHog server-side capture + cohort builder)** — Precondition for almost everything downstream. Ships event-name lint rule to prevent rework.
2. **Wave B — M2 Onboarding Overhaul** — Defines activation event (unblocks M-A paywall + M3 review prompt). Anonymous-trial schema migration is the load-bearer.
3. **Wave C (parallel) — M-A Multi-tier Affiliate + M-B Embed Blocks + M-B Spanish i18n + M-C Clinic Org Schema** — All can start in parallel once M1/M2 are stable.
4. **Wave D (parallel) — M-A Mid-trial Paywall A/B + M-A Page-builder A/B + M3 Gamification + M-C Clinic Billing + M5b Recommender** — Mid-cycle. Stat-sig measurement begins.
5. **Wave E (parallel) — M-A Ad-spend ETL + M3 Review Prompt + M6 Helpdesk Core + M-B Pharmacology Paywall Test + M7 Cancellation** — Late-cycle features riding on M1/M2/M-A infrastructure.
6. **Wave F — M-C HIPAA Chain closure + M7 Status Page + GA polish** — Final cross-cutting closeout. Legal/vendor BAAs run in parallel from Wave A onward but legal-paperwork-closing-as-blocker lands here.

### Rationale

- **M1 + M2 as serial pre-requisites** — without them, downstream A/B + review + recommender + paywall A/B all ship without proper instrumentation
- **HIPAA legal work IN PARALLEL from day 1** — per PROJECT.md "HIPAA work starts immediately in parallel"; engineering doesn't gate on it but Wave F closure does
- **Clinic orgs in Wave C-D** — schema is C, billing is D; allows parallel work on white-label theming
- **Helpdesk + Cancellation late** — they ride on every other workstream's user touchpoint (AI helpdesk benefits from M5b context; cancellation saves benefit from M-A multi-tier affiliate cross-sell)

---

## Sources

### Affiliate Programs
- [Rewardful Commission Guide 2026](https://www.rewardful.com/articles/affiliate-commission-explained) (MEDIUM)
- [BoldDesk Best SaaS Affiliate Programs 2026](https://www.bolddesk.com/blogs/best-saas-affiliate-programs) (MEDIUM)
- [Tapfiliate SaaS Commission Guide](https://tapfiliate.com/blog/a-complete-guide-for-saas-affiliate-commissions/) (MEDIUM)

### Mid-Trial Paywalls + Activation
- [Pulseahead Trial-to-Paid Benchmarks](https://www.pulseahead.com/blog/trial-to-paid-conversion-benchmarks-in-saas) (MEDIUM)
- [Stackmatix Trial Conversion Levers](https://www.stackmatix.com/blog/saas-trial-to-paid-conversion) (MEDIUM)
- [PostHog Experiments Docs](https://posthog.com/docs/experiments/creating-an-experiment) (HIGH)
- [PostHog Testing & Launching Experiments](https://posthog.com/docs/experiments/testing-and-launching) (HIGH)

### Ad-Spend ETL + Attribution
- [Google Ads API Rate Sheet](https://developers.google.com/google-ads/api/docs/api-policy/rate-sheet) (HIGH)
- [Meta Marketing API attribution restrictions 2026](https://ppc.land/meta-restricts-attribution-windows-and-data-retention-in-ads-insights-api/) (MEDIUM)
- [Improvado TikTok Ads API challenges](https://improvado.io/blog/tiktok-ads-data-challenges) (MEDIUM)
- [Cometly Ad Platform API Integration](https://www.cometly.com/post/ad-platform-api-integration) (MEDIUM)
- [AdLibrary Attribution 2026](https://adlibrary.com/posts/ad-attribution-tracking-explained-2026) (MEDIUM)

### HIPAA / BAA / SOC 2 / HITRUST
- [HIPAA Journal BAA 2026 Guide](https://www.hipaajournal.com/hipaa-business-associate-agreement/) (HIGH)
- [Total HIPAA — SOC2 cannot replace BAA](https://www.totalhipaa.com/what-is-soc2-audit-and-can-it-replace-a-baa/) (HIGH)
- [Linford & Co SaaS HIPAA Guide](https://linfordco.com/blog/saas-hipaa-considerations/) (HIGH)
- [ThreeFlow HIPAA vs SOC 2 vs HITRUST](https://www.threeflow.com/post/hipaa-vs-soc-2-vs-hitrust-what-brokers-need-to-know) (MEDIUM)
- [Vanta SOC 2 + HIPAA overlap](https://www.vanta.com/collection/hipaa/hipaa-and-soc-2) (MEDIUM)

### Gamification
- [Orizon Duolingo Gamification Secrets](https://www.orizon.co/blog/duolingos-gamification-secrets) (MEDIUM)
- [Trophy Duolingo Case Study 2026](https://trophy.so/blog/duolingo-gamification-case-study) (MEDIUM)
- [DEV Duolingo Dark Patterns Critique](https://dev.to/yaptech/duolingos-shallow-learning-trap-gamified-streaks-harmful-habits-4134) (MEDIUM)
- [StriveCloud Duolingo Gamification](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo) (MEDIUM)

### Helpdesk + AI Deflection
- [ServiceDeskAgents AI Deflection Benchmarks 2026](https://servicedeskagents.com/deflection-rates/) (MEDIUM)
- [Duckie AI Resolution vs Deflection 2026](https://www.duckie.ai/blog/ai-ticket-resolution-vs-deflection-why-90-resolution-beats-40-deflection) (MEDIUM)
- [Kustomer AI Ticket Deflection 2026 Guide](https://www.kustomer.com/resources/blog/ai-powered-ticket-deflection/) (MEDIUM)

### Cancellation Saves
- [SmartSMS Subscription Save Playbook](https://smartsmssolutions.com/resources/blog/business/article-3-spoke-subscription-save-offers-pause-cancel-winback) (MEDIUM)
- [ChurnWard SaaS Cancellation Flow Guide](https://churnward.com/blog/saas-cancellation-flow/) (MEDIUM)
- [Userpilot Cancellation Flow Examples](https://userpilot.com/blog/cancellation-flow-examples/) (MEDIUM)

### i18n
- [Crowdin React i18n Tutorial](https://crowdin.com/blog/react-i18n) (MEDIUM)
- [react-i18next ICU Format Docs](https://react.i18next.com/misc/using-with-icu-format) (HIGH)
- [SimpleLocalize SaaS i18n Guide](https://simplelocalize.io/blog/posts/i18n-for-saas-teams/) (MEDIUM)
- [Crowdin ICU Message Format Guide 2026](https://crowdin.com/blog/icu-guide) (MEDIUM)

### B2B Billing
- [Dodo Hybrid Billing Models 2026](https://dodopayments.com/blogs/hybrid-billing-models-saas) (MEDIUM)
- [Vozo Healthcare Software Pricing](https://www.vozohealth.com/blog/the-ultimate-guide-to-healthcare-software-pricing-models) (MEDIUM)
- [Schematic Usage Billing Software 2026](https://schematichq.com/blog/usage-billing-software) (MEDIUM)

### Onboarding 2026
- [Arcade Onboarding Best Practices 2026](https://www.arcade.software/post/customer-onboarding-best-practices) (MEDIUM)
- [UXPin Progressive Disclosure 2026](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/) (MEDIUM)
- [Themasterly SaaS Onboarding UX Guide 2026](https://www.themasterly.com/blog/saas-onboarding-ux-guide) (MEDIUM)

### pgvector / Recommender
- [Supabase pgvector docs](https://supabase.com/docs/guides/database/extensions/pgvector) (HIGH)
- [pgvector GitHub](https://github.com/pgvector/pgvector) (HIGH)

### Review Prompts
- [Apple Ratings & Reviews](https://developer.apple.com/app-store/ratings-and-reviews/) (HIGH)
- [Appcues Mobile Review Request Examples](https://www.appcues.com/blog/mobile-app-review-request-examples) (MEDIUM)

### Status Page
- [Better Stack Statuspage Alternatives 2026](https://betterstack.com/community/comparisons/statuspage-alternatives/) (MEDIUM)
- [StatusGator Upptime Alternatives 2026](https://statusgator.com/blog/7-upptime-alternatives-for-better-incident-communication/) (MEDIUM)

---
*Feature research for: LeanShot v1.3 Platform Expansion — Revenue + Depth + B2B + HIPAA + onboarding/retention engine*
*Researched: 2026-05-17 (builds on v1.2 FEATURES.md from 2026-05-13)*
