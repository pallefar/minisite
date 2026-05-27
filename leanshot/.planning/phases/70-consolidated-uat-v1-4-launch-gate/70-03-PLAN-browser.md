---
plan: "70-03-browser"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-01
  - UAT-03
  - UAT-04
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/browser/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-03-PLAN-browser.md
fixture_group: "browser"
estimated_duration: "4-5 hours operator time across desktop Chrome/Safari/Firefox sessions"
must_haves:
  - "browser-S01-share-card-mint-twitter-validator"
  - "browser-S04-save-offer-rule-create-and-cancel-flow"
  - "browser-S06-mux-video-upload-roundtrip"
  - "browser-S07-mention-email-delivery"
  - "browser-S08-cross-tab-realtime-broadcast"
  - "browser-S09-tier-locked-discovery-card"
  - "browser-S10-public-knowledge-hub-render"
  - "browser-S11-protocol-creator-2-person-review"
  - "browser-S12-insights-research-blog-publish"
  - "browser-S13-state-privacy-opt-out-propagation"
  - "browser-S15-audience-landing-render"
  - "browser-S16-demo-org-auto-purge"
  - "browser-S17-ui-auditor-final-pass"
  - "browser-S18-dark-mode-vr-diff"
  - "browser-S19-lighthouse-mobile-min-90"
  - "browser-S20-ds-gates-fire-on-pr"
---

<objective>
Plan 03 — Browser. All desktop-browser walkthroughs at staging URL (the Vercel preview that comes online after 69.7 cloud-settings fix). Lifts the v1.3-deferred browser signals from Phase 35 (Twitter Card + LinkedIn Inspector), Phase 36 (consumer + admin NPS smoke), Phase 40 (admin save-offer rule + end-to-end cancel flow accept + decline), Phase 44 (Mux video upload roundtrip, @mention email, cross-tab realtime, tier-locked discovery), AND new v1.4 browser signals from Phase 60 (RAG citations + admin curation + public knowledge hub), Phase 61 (Protocol Creator 2-person review + clinician-adopt → patient-prefill), Phase 62 (k-anonymity research blog publish + RAG feedback ingestion), Phase 64 (state-privacy opt-out propagation, DMCA walkthrough), Phase 68 (audience landing render + demo-org auto-purge ≤7d), Phase 69 design-polish UAT (gsd-ui-auditor final-pass + dark-mode VR diff + Lighthouse mobile ≥90), Phase 69.7 deferred (DS-01/02/03 CI gates fire on PR + VR baselines reviewed).

Single-operator session in 2-3 sittings. Use a current Chrome (primary), then spot-check Safari + Firefox for the consumer-critical surfaces (landing pages, dose-log modal, sign-in).

Purpose: UAT-01 v1.3 carry-over browser signals + UAT-03 new v1.4 + UAT-04 design polish coverage.

Output: signoff checkboxes filled inline + screenshots (full page, timestamp visible) + CLI/network outputs captured to `evidence/browser/<signal-slug>/`.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/milestones/v1.3-uat-deferred.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md
@.planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md

**Staging URL prerequisite:** Plan 01 NOT a hard dep, but Plan 01 S02 (Vercel SHARE_TOKEN_SECRET) + Plan 01 S07 (Mux secrets) needed for full coverage of S01 + S06. If staging URL is still missing (Vercel cloud-settings drift unresolved per 69.7-SUMMARY), operator MUST fix rootDirectory at https://vercel.com/karstens-projects-16afd0e4/leanshot-marketing/settings before running this plan.
</context>

<tasks>

<task id="03-S01" name="Signal — Mint share URL + Twitter Card Validator">
  <type>verification</type>
  <signal_id>browser-S01-share-card-mint-twitter-validator</signal_id>
  <criticality>non-critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 35 — Signal 3
  </read_first>
  <action>
1. Sign in to staging as a test user with level ≥ 5 (seed via Phase 35 admin tools if needed).
2. Trigger LevelUpBurst → click "Share level" → copy generated URL (format `https://leanshot.app/share/<token>`).
3. Open https://cards-dev.twitter.com/validator in a new tab → paste URL → "Preview card".
4. Expect: 1200x630 PNG card rendered, title "Reached Level N on LeanShot", `summary_large_image` type, description present, image loads via HTTPS.
5. Screenshot the validator preview.
  </action>
  <acceptance_criteria>
    - 1200x630 PNG card rendered
    - title + summary_large_image present
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S01-share-card-mint-twitter-validator/
  </acceptance_criteria>
  <defer_clause>Defer-OK. Twitter dev preview is courtesy; production cards still render when shared.</defer_clause>
</task>

<task id="03-S02" name="Signal — LinkedIn Post Inspector + Instagram DM preview">
  <type>verification</type>
  <signal_id>browser-S02-linkedin-instagram-card-preview</signal_id>
  <criticality>non-critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 35 — Signal 4 + 5
  </read_first>
  <action>
1. **LinkedIn Post Inspector**: https://www.linkedin.com/post-inspector/ → paste the same share URL from S01 → "Inspect". Expect: image + title + description.
2. **Instagram DM** (mobile companion device for this step): open Instagram mobile → DM to yourself → paste share URL → expect preview card renders inline in chat.
3. Capture screenshots.
  </action>
  <acceptance_criteria>
    - LinkedIn shows card OR `defer:linkedin-defer`
    - Instagram DM shows preview OR `defer:instagram-defer`
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S02-linkedin-instagram-card-preview/
  </acceptance_criteria>
  <defer_clause>Defer-OK per platform.</defer_clause>
</task>

<task id="03-S03" name="Signal — NPS consumer + admin smoke (Phase 36)">
  <type>verification</type>
  <signal_id>browser-S03-nps-consumer-admin-smoke</signal_id>
  <criticality>non-critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 36 — Signal 4
  </read_first>
  <action>
1. **Consumer flow**: sign in as test user → trigger admissible event (e.g. complete activation: `activation_completed`). Wait — NPSPromptModal should render within 1-2s.
2. Submit 5★. Expect: external CTA opens to Trustpilot (or vendor-gated fallback per Plan 01 S03 state).
3. Refresh, trigger another admissible event in a separate user account, submit 1★. Expect: ticket lands in `/admin/helpdesk` inbox tagged `nps-feedback` within 60s.
4. **Admin flow**: sign in as admin → `/admin/reviews` → create rule via RuleFormPanel. View `FunnelDashboardPage` with a seeded variant set. Click "Ship Winner" → expect 200 success (or 503 vendor-gated if Plan 01 S05 PostHog not yet set — that's traceable to S05).
5. **Multi-device cooldown E2E** (live spec, run from local repo):
   `cd leanshot && PLAYWRIGHT_RUN_P36=1 SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co npx playwright test e2e/nps-cooldown-multi-device.spec.ts`
   Expected: spec passes.
  </action>
  <acceptance_criteria>
    - NPSPromptModal renders on consumer flow
    - 1★ ticket lands in helpdesk inbox
    - admin "Ship Winner" returns 200 (S05 set) or 503 (S05 deferred)
    - Playwright cooldown spec passes
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S03-nps-consumer-admin-smoke/
  </acceptance_criteria>
  <defer_clause>Defer-OK if Plan 01 S05 deferred (PostHog experiment).</defer_clause>
</task>

<task id="03-S04" name="Signal — Admin save-offer rule + end-to-end cancel flow (Phase 40 B+C)">
  <type>verification</type>
  <signal_id>browser-S04-save-offer-rule-create-and-cancel-flow</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 40 — Signal B + Signal C
  </read_first>
  <action>
1. **Admin rule create** (Signal B): sign in as admin → `/admin/cancellation` → Rules tab → "Add rule". Configure: Offer type=Discount, Coupon=`SAVE-25-3MO`, Tenure=30-180d, Reason="Too expensive", Priority=10, Active=ON. Save → verify row in rule list.
2. **End-to-end cancel flow, decline path** (Signal C, half 1): test user with active Stripe test subscription (tenure 30-180d) → Settings → Account → "Cancel subscription".
   - Step 1: pick reason "Too expensive" → Continue.
   - Step 2: discount offer card renders (BadgePercent icon + SAVE-25-3MO details).
   - Click "No thanks" → Step 3 → "Cancel anyway" → 6s undo banner appears → don't click undo → verify in Stripe Dashboard or:
     `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/subscriptions/&lt;sub-id&gt;" | jq '.cancel_at_period_end'`
     Expected: `true`.
3. **Accept path** (Signal C, half 2): different test user with active sub, same tenure. Same cancel flow → accept offer instead of declining → verify in Stripe:
   `curl ... | jq '.discounts[0].coupon.id'`
   Expected: `SAVE-25-3MO` (or whichever coupon admin rule attached).
4. Screenshots: rule list, discount offer card, 6s undo banner, Stripe Dashboard for both subs.
  </action>
  <acceptance_criteria>
    - admin rule visible in /admin/cancellation rule list
    - decline path: cancel_at_period_end=true in Stripe
    - accept path: discounts[] populated with the SAVE-* coupon
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S04-save-offer-rule-create-and-cancel-flow/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 40 cancellation flow is consumer-retention critical.</defer_clause>
</task>

<task id="03-S05" name="Signal — Notification + email template copy reviews (Phase 35 + Phase 40 + Phase 65)">
  <type>verification</type>
  <signal_id>browser-S05-copy-review</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 35 — Signal 6
    - .planning/milestones/v1.3-uat-deferred.md §Phase 40 — Signal D
    - .planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md (31 email templates)
  </read_first>
  <action>
1. Open the following files and confirm copy passes ethical-only review (no urgency-escalation, no FOMO, no shame, no dark patterns):
   - `supabase/functions/lifecycle-behavior-triggered/templates.ts` — Phase 35 streak_warn + challenge_kickoff + challenge_nudge
   - `supabase/functions/_shared/email-templates/pause-reminder-t7.ts` — Phase 40
   - `supabase/functions/_shared/email-templates/pause-resumed-t0.ts` — Phase 40
   - `supabase/functions/_shared/email-templates/` — all 31 Phase 65 templates (dunning + refund + win-back). Sample 5 randomly.
2. Phase 35 + Phase 40 templates already pre-assessed `copy-ok` per executor 2026-05-21 — re-confirm or flag.
3. If anything reads as urgency/FOMO/shame: record `copy-needs-revision: <specific concern>` and file via `scripts/uat-defer.sh copy-revision-needed-<template> '<concern>'`.
  </action>
  <acceptance_criteria>
    - all sampled templates pass ethical review OR concern filed
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S05-copy-review/notes.md
  </acceptance_criteria>
  <defer_clause>Defer-OK for copy revisions on non-critical templates; critical-flow templates (refund, dunning) MUST not defer if revision needed.</defer_clause>
</task>

<task id="03-S06" name="Signal — Mux video upload roundtrip (Phase 44 Signal A)">
  <type>verification</type>
  <signal_id>browser-S06-mux-video-upload-roundtrip</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 44 — Signal A
    - Plan 01 S07 (Mux secrets)
  </read_first>
  <action>
1. Sign in as a Pro-tier test user (use Plan 02 S04 lifetime user, or seed manually).
2. Open a Free-tier community space → click "Add video" → upload `test-30s.mp4` (or any 5-30s mp4 ≤ 100 MB; if none on hand, record a 10s screen recording).
3. Wait ≤90s. Confirm `video_status='ready'` + thumbnail appears in the post card. CLI cross-check:
   `supabase db query --linked "SELECT id, mux_playback_id, video_status FROM public.community_videos WHERE created_by='&lt;user-id&gt;' ORDER BY created_at DESC LIMIT 1;"`
4. Click the thumbnail. Confirm MuxPlayer loads and the video plays (audio + video; close after 5s).
5. Capture screenshots of: (a) upload progress, (b) ready thumbnail, (c) MuxPlayer playing.
  </action>
  <acceptance_criteria>
    - video_status='ready' within 90s
    - MuxPlayer plays
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S06-mux-video-upload-roundtrip/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Community video is Pro-tier value-prop hook.</defer_clause>
</task>

<task id="03-S07" name="Signal — @Mention email delivery + opt-out (Phase 44 Signal B)">
  <type>verification</type>
  <signal_id>browser-S07-mention-email-delivery</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 44 — Signal B
  </read_first>
  <action>
1. Seed two test users `alice` + `bob` in the same community space.
2. As alice → post `Hello @bob` in the space.
3. Open bob's inbox within 60s. Expect: email subject contains "mentioned you" + body links to the post URL.
4. Toggle off `community_mentions` notifications for bob: Settings → Notifications → toggle off (or direct SQL: `UPDATE public.user_notification_prefs SET community_mentions=false WHERE user_id='&lt;bob&gt;';`).
5. As alice → post another `@bob` in the space.
6. Verify NO email arrives at bob's inbox within 60s.
7. Capture both states (1 email landed, 0 emails landed).
  </action>
  <acceptance_criteria>
    - mention email arrives within 60s when opted in
    - mention email suppressed when opted out
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S07-mention-email-delivery/
  </acceptance_criteria>
  <defer_clause>Cannot defer. COMMUNITY-03 critical.</defer_clause>
</task>

<task id="03-S08" name="Signal — Cross-tab realtime broadcast (Phase 44 Signal C)">
  <type>verification</type>
  <signal_id>browser-S08-cross-tab-realtime-broadcast</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 44 — Signal C
  </read_first>
  <action>
1. Open the same community space in 2 browser tabs (or 2 browser profiles): Tab A as User A, Tab B as User B (different accounts, same space).
2. Tab A: post a comment "Realtime test 1".
3. Tab B: verify new comment appears within 2s WITHOUT manual reload. Capture screenshot of both tabs side-by-side.
4. Tab A: click 🎯 reaction on the comment.
5. Tab B: verify reaction count increments within 2s.
6. Capture both reactions.
  </action>
  <acceptance_criteria>
    - comment appears in Tab B within 2s
    - reaction count updates in Tab B within 2s
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S08-cross-tab-realtime-broadcast/
  </acceptance_criteria>
  <defer_clause>Cannot defer. COMMUNITY-05 critical.</defer_clause>
</task>

<task id="03-S09" name="Signal — Tier-locked discovery card + upgrade CTA (Phase 44 Signal D)">
  <type>verification</type>
  <signal_id>browser-S09-tier-locked-discovery-card</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 44 — Signal D
  </read_first>
  <action>
1. Sign in as a Free-tier test user → community space list (/community or equivalent).
2. Identify a Pro-only space → confirm it renders as a locked card with title + thumbnail but NO post body visible.
3. Click "Upgrade" CTA on the locked card → expect navigation to `/pricing`.
4. Sign in as a Pro-tier user → same Pro-only space → confirm full content renders normally.
5. Screenshot both states.
  </action>
  <acceptance_criteria>
    - Pro-only space hides post bodies for Free user
    - Upgrade CTA routes to /pricing
    - Pro user sees full space content
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S09-tier-locked-discovery-card/
  </acceptance_criteria>
  <defer_clause>Cannot defer. COMMUNITY-06 critical for tier monetization.</defer_clause>
</task>

<task id="03-S10" name="Signal — Public knowledge hub render + AI-coach citation footnotes (Phase 60)">
  <type>verification</type>
  <signal_id>browser-S10-public-knowledge-hub-render</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/60-rag-knowledge-base-completion-waves-2-4/
    - ROADMAP Phase 60 row
  </read_first>
  <action>
1. Open `https://leanshot.app/knowledge/` (or staging equivalent) in incognito → confirm hub landing page renders with category tiles + featured articles.
2. Click into a knowledge article → confirm it renders with body content + sources + last-updated date.
3. Sign in → open AI Coach panel → ask a question that should pull from the knowledge base (e.g. "What's the half-life of semaglutide?").
4. Confirm AI response includes citation footnotes (e.g. `[1]`, `[2]`) + a "Sources" block at the bottom with clickable links back to knowledge articles.
5. Sign in as admin → `/admin/knowledge` → confirm article curation UI loads + can edit + can mark `published=true/false`.
6. Capture screenshots of hub, article, AI response with citations, admin curation UI.
  </action>
  <acceptance_criteria>
    - public hub loads in incognito (no auth wall)
    - AI Coach response includes ≥1 citation footnote when answering a knowledge-base question
    - admin can publish/unpublish articles
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S10-public-knowledge-hub-render/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 60 RAG + knowledge hub is v1.4 headline feature.</defer_clause>
</task>

<task id="03-S11" name="Signal — Protocol Creator 2-person review + clinician-adopt → patient-prefill (Phase 61)">
  <type>verification</type>
  <signal_id>browser-S11-protocol-creator-2-person-review</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/61-admin-protocol-creator/
  </read_first>
  <action>
1. Sign in as Admin A (clinician role) → `/admin/protocols/new` → fill out a protocol (e.g. "GLP-1 Semaglutide titration"): dose schedule + side-effect notes + adjustment triggers. Submit as "Pending review".
2. Sign in as Admin B (different clinician) → `/admin/protocols/pending` → find Admin A's draft → review → approve.
3. Confirm protocol status transitions to `approved` + becomes available in the "Adopt protocol" picker for clinicians.
4. Sign in as Clinician C → `/admin/patients/<test-patient-id>` → "Adopt protocol" → select Admin A's protocol → confirm.
5. Sign in as the test patient → confirm dose-log modal prefills with the adopted protocol's schedule (titration steps, dates, doses).
6. CLI cross-check:
   `supabase db query --linked "SELECT id, name, status, created_by, reviewed_by FROM public.protocols WHERE name LIKE 'GLP-1 Semaglutide%' ORDER BY created_at DESC LIMIT 1;"`
7. Screenshots: A drafted, B reviewed, C adopted, patient prefilled.
  </action>
  <acceptance_criteria>
    - 2-person review enforced (Admin A cannot self-approve)
    - status=approved after Admin B approves
    - patient prefill renders adopted protocol's schedule
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S11-protocol-creator-2-person-review/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 61 clinical-safety guard (2-person review) critical.</defer_clause>
</task>

<task id="03-S12" name="Signal — Insights research-blog publish + k-anonymity-enforcement (Phase 62)">
  <type>verification</type>
  <signal_id>browser-S12-insights-research-blog-publish</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/62-insights-research-engine/
  </read_first>
  <action>
1. Sign in as admin → `/admin/insights/new` → compose a research blog post drawing on cohort data. Run a cohort query that intentionally selects fewer than 5 users (e.g. `WHERE age>90 AND state='WY'`). Confirm the chart preview shows "Cohort suppressed — fewer than 5 users" placeholder (NOT the actual data).
2. Run a query that returns ≥5 users → confirm chart renders with anonymized aggregate values.
3. Publish the post → confirm it appears at `/insights/<slug>` publicly (incognito test).
4. **RAG feedback ingestion**: leave a 👍/👎 feedback on a published insight or knowledge article → confirm `rag_feedback_log` row inserted:
   `supabase db query --linked "SELECT user_id, source_id, signal, created_at FROM public.rag_feedback_log ORDER BY created_at DESC LIMIT 3;"`
5. Screenshots: suppressed cohort placeholder, public insight page, feedback log row.
  </action>
  <acceptance_criteria>
    - cohort &lt;5 suppressed; cohort ≥5 renders
    - published insight visible incognito
    - rag_feedback_log row inserted on feedback
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S12-insights-research-blog-publish/
  </acceptance_criteria>
  <defer_clause>Cannot defer. K-anonymity is a privacy compliance guard, not a feature.</defer_clause>
</task>

<task id="03-S13" name="Signal — State-privacy opt-out propagation (Phase 64)">
  <type>verification</type>
  <signal_id>browser-S13-state-privacy-opt-out-propagation</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/64-legal-refresh/
  </read_first>
  <action>
1. Sign in as a test user → Settings → Privacy → "Opt out of personalization / sharing for advertising" → toggle ON. Save.
2. Within 24h (recommended: immediately and recheck after 1h):
   - Confirm PostHog property `opted_out_advertising=true` set on the person (PostHog → Persons → search by email).
   - Confirm AdMob/AdSense IDFA/AAID flag flipped on next request (network tab; or check via `cookies()` or `localStorage` for the consent string).
3. CLI:
   `supabase db query --linked "SELECT user_id, opted_out_at, propagated_at FROM public.privacy_optout_log WHERE user_id='&lt;test-user-uuid&gt;' ORDER BY created_at DESC LIMIT 1;"`
   Expected: opted_out_at + propagated_at both within 24h.
4. **DMCA email-to-action walkthrough** (non-critical sub-signal): send a test DMCA email to the configured DMCA-agent inbox → confirm admin UI receives a ticket at `/admin/legal/dmca-tickets` within 5 minutes (uses email→Edge Fn webhook).
5. Screenshots: settings toggle, PostHog property, privacy_optout_log row.
  </action>
  <acceptance_criteria>
    - opt-out flag propagated to PostHog + ad networks within 24h
    - privacy_optout_log shows propagated_at timestamp
    - DMCA email lands in admin ticket inbox (non-critical sub-signal)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S13-state-privacy-opt-out-propagation/
  </acceptance_criteria>
  <defer_clause>Cannot defer the opt-out core; DMCA sub-signal can `defer:dmca-agent-not-registered` (Phase 70 vendor account).</defer_clause>
</task>

<task id="03-S14" name="Signal — ES locale smoke (Phase 58 i18n)">
  <type>verification</type>
  <signal_id>browser-S14-es-locale-smoke</signal_id>
  <criticality>non-critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/58-spanish-i18n-wiring-contractor-delivered/
  </read_first>
  <action>
1. Set browser language to Spanish (or hit `https://leanshot.app/?lang=es` if URL param supported).
2. Confirm landing page, sign-up flow, dose-log modal, onboarding, and settings all render in Spanish.
3. Spot-check 5 random consumer screens to confirm no English string leaks (untranslated keys).
4. Confirm date + currency formatting matches `es-ES` or `es-MX` locale (DD/MM/YYYY, $ before number).
5. Screenshots of 5 surfaces.
  </action>
  <acceptance_criteria>
    - 5 surfaces render in Spanish without untranslated leaks
    - dates + currency locale-correct
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S14-es-locale-smoke/
  </acceptance_criteria>
  <defer_clause>Defer-OK if contractor i18n delivery incomplete; record specific gaps with `defer:i18n-gaps-<list>`.</defer_clause>
</task>

<task id="03-S15" name="Signal — Audience landing page renders per-audience (Phase 68)">
  <type>verification</type>
  <signal_id>browser-S15-audience-landing-render</signal_id>
  <criticality>critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/68-audience-landing-sales-enablement/
  </read_first>
  <action>
1. Visit each audience landing URL in incognito (do not sign in):
   - `https://leanshot.app/patients` → confirm B2C copy + sign-up CTA + AdSense banner (if Plan 01 S19 approved)
   - `https://leanshot.app/doctors` → confirm read-share + report value-prop copy + book-a-call CTA + ZERO ads (Phase 56 clinic-zero-ads requirement)
   - `https://leanshot.app/clinics` → confirm B2B copy + demo-org CTA + Stripe Tax compliance badge + ZERO ads
2. For each: capture full-page screenshot + page-source view-source confirms no AdMob/AdSense scripts on doctors + clinics paths.
3. Click "Demo org" CTA on `/clinics` → confirm a fresh demo org provisions for the operator's session (UUID-keyed; not the production org).
  </action>
  <acceptance_criteria>
    - 3 audience pages render with correct content
    - doctors + clinics paths have zero ads (page-source check)
    - demo org provisions on /clinics CTA
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S15-audience-landing-render/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 68 audience pages are sales-enablement headline.</defer_clause>
</task>

<task id="03-S16" name="Signal — Demo-org auto-purge ≤7d (Phase 68)">
  <type>verification</type>
  <signal_id>browser-S16-demo-org-auto-purge</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/68-audience-landing-sales-enablement/
    - supabase/functions/demo-org-purge (per 69.7-SUMMARY)
  </read_first>
  <action>
1. Find demo orgs already past 7d (or seed one with `created_at = now() - interval '8 days'`):
   `supabase db query --linked "SELECT id, created_at FROM public.organizations WHERE is_demo=true AND created_at &lt; now() - interval '7 days' LIMIT 5;"`
2. Trigger demo-org-purge Edge Fn manually:
   `curl -X POST -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/demo-org-purge/run"`
3. Re-run the query. Expected: those orgs purged (rows deleted or marked `purged_at`).
4. **Exact 7d timing** is non-critical (defer-OK per CONTEXT.md Area 1) — what matters is that the cron job + Fn work end-to-end.
  </action>
  <acceptance_criteria>
    - demo-org-purge Fn returns 200
    - target orgs purged from the table after run
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S16-demo-org-auto-purge/
  </acceptance_criteria>
  <defer_clause>Defer-OK for exact-timing precision per CONTEXT.md Area 1 non-critical list.</defer_clause>
</task>

<task id="03-S17" name="Signal — gsd-ui-auditor final-pass evidence (Phase 69 UAT-04)">
  <type>verification</type>
  <signal_id>browser-S17-ui-auditor-final-pass</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69-layout-design-polish/
  </read_first>
  <action>
1. Run gsd-ui-auditor in final-pass mode against staging:
   `cd /Users/karstenhaldan/minisite/leanshot && npm run audit:ui -- --target https://&lt;staging-url&gt; --report .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/browser/S17-ui-auditor-final-pass/audit-report.md`
   (If npm script not wired, run the auditor binary directly per Phase 69 CI gate config.)
2. Review report. Confirm:
   - 0 ERROR-level findings
   - All advisory FLAGs from Phase 60 + Phase 69 (9 total per CONTEXT.md non-critical list) are documented as accepted
   - No undefined `@theme` tokens (per `feedback_ui_auditor_catches_undefined_theme_tokens` — Tailwind v4 silently no-ops these)
3. If new ERROR-level finding: halt + open a follow-up phase. If only FLAGs: acceptable, document them.
  </action>
  <acceptance_criteria>
    - audit-report.md exists, 0 ERROR-level findings
    - all FLAGs explicitly accepted
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S17-ui-auditor-final-pass/audit-report.md
  </acceptance_criteria>
  <defer_clause>Cannot defer ERROR-level. FLAGs are non-critical advisory by design.</defer_clause>
</task>

<task id="03-S18" name="Signal — Dark-mode VR snapshot diff (Phase 69 UAT-04)">
  <type>verification</type>
  <signal_id>browser-S18-dark-mode-vr-diff</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md §"5 HUMAN signals" row 4
  </read_first>
  <action>
1. Capture VR baselines against working staging URL (after Vercel rootDirectory drift resolved):
   `cd leanshot && npx playwright test --config playwright.config.vr.ts --update-snapshots`
2. Manually review every updated baseline file under `leanshot/tests/__visual_baselines__/` (or wherever the VR config writes). Reject anything visually-broken; accept anything that's intentional v1.4 design polish.
3. Switch theme to dark mode (toggle in app) → re-run VR with the same config (or use the dark-mode-specific config if Phase 69 shipped one). Confirm:
   - dark-mode VR snapshots also captured
   - diff between light + dark versions is the expected token swap (not random layout shifts)
4. Commit reviewed baselines:
   `git add leanshot/tests/__visual_baselines__/ && git commit -m "test(70-03-S18): v1.4 launch VR baselines reviewed + accepted"`
  </action>
  <acceptance_criteria>
    - both light + dark VR baseline sets committed
    - operator review confirms no broken layouts
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S18-dark-mode-vr-diff/ + git SHA of baseline commit
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 69 design-polish UAT-04 critical.</defer_clause>
</task>

<task id="03-S19" name="Signal — Lighthouse mobile ≥90 on 3 audience landing pages (UAT-04)">
  <type>verification</type>
  <signal_id>browser-S19-lighthouse-mobile-min-90</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69-layout-design-polish/
    - .planning/phases/68-audience-landing-sales-enablement/
  </read_first>
  <action>
1. Run Lighthouse CLI against the 3 audience landing pages in mobile preset:
   `for path in /patients /doctors /clinics; do npx lighthouse "https://&lt;staging&gt;${path}" --preset=mobile --quiet --output=json --output-path=".planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/browser/S19-lighthouse-mobile-min-90/lighthouse${path//\//-}.json"; done`
2. Parse each report. Confirm scores: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90, SEO ≥ 90.
3. If any score &lt; 90: capture top 3 opportunities from the report; if all are pre-existing-known issues (FID from heavy chart.js + framer-motion bundle), accept with documented carry-over to v1.5; if new regression, halt.
  </action>
  <acceptance_criteria>
    - all 4 lighthouse categories ≥ 90 on each of 3 audience pages
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S19-lighthouse-mobile-min-90/ — 3 JSON reports + summary
  </acceptance_criteria>
  <defer_clause>Cannot defer the threshold. If pre-existing bundle issue, defer the FIX, not the gate (open issue tagged `v1.5-perf-followup`).</defer_clause>
</task>

<task id="03-S20" name="Signal — DS-01/02/03 CI gates fire on PR (Phase 69.7 deferred)">
  <type>verification</type>
  <signal_id>browser-S20-ds-gates-fire-on-pr</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md §"5 HUMAN signals" row 5
    - .planning/phases/69-layout-design-polish/
  </read_first>
  <action>
1. Create a synthetic test branch: `git checkout -b uat/ds-gate-smoke`.
2. Introduce a typography violation deliberately. Example: in any `.tsx` add `<p style={{ fontFamily: 'Comic Sans' }}>oops</p>` or use a font-size class not in the design system (e.g. `text-[14.5px]`).
3. Commit + push + open a PR via `gh pr create --title 'DS gate smoke — DO NOT MERGE' --body 'Phase 70 S20 smoke'`.
4. Wait for CI. Expected: DS-01 (typography) gate FAILS with a specific line-pointing error. DS-02 + DS-03 (spacing + color) gates pass (since only DS-01 was violated). Capture failing check log.
5. Close the PR + delete the branch: `gh pr close --delete-branch &lt;num&gt;`.
6. Repeat the experiment with DS-02 (spacing) + DS-03 (color) violations in 2 follow-up smoke PRs to confirm each gate fires independently.
  </action>
  <acceptance_criteria>
    - DS-01 smoke PR fails on DS-01 gate; closed cleanly
    - DS-02 smoke PR fails on DS-02 gate; closed cleanly
    - DS-03 smoke PR fails on DS-03 gate; closed cleanly
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/browser/S20-ds-gates-fire-on-pr/ — 3 PR URLs + 3 CI failure logs
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 69 design-system gates are post-launch maintenance safety net.</defer_clause>
</task>

<task id="03-S21" name="Signal — Evidence directory bootstrap">
  <type>verification</type>
  <signal_id>browser-S21-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/browser/`
2. Create S01..S20 subdirs.
3. Confirm staging URL works: `curl -sI https://&lt;staging&gt;/ | head -3` returns 200.
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - staging reachable
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical — but bootstrap before S01.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: every critical signal signed off; evidence dir contains 20 signal subdirs with screenshots + CLI outputs + JSON reports.
</verification>

<success_criteria>
- All 16 critical signals signed off (S04, S06, S07, S08, S09, S10, S11, S12, S13, S15, S17, S18, S19, S20 — and the bootstrap dependencies).
- Non-critical signals (S01, S02, S03, S05, S14, S16, S21) signed OR `defer:<reason>` with GH issue.
- Evidence under `evidence/browser/`.
</success_criteria>

## Resume State

- [ ] **S01** — Twitter Card validator (non-critical) — signoff: __________
- [ ] **S02** — LinkedIn + Instagram preview (non-critical) — signoff: __________
- [ ] **S03** — NPS consumer + admin smoke (non-critical) — signoff: __________
- [ ] **S04** — Admin save-offer rule + cancel flow — signoff: __________
- [ ] **S05** — Copy reviews (non-critical) — signoff: __________
- [ ] **S06** — Mux video upload roundtrip — signoff: __________
- [ ] **S07** — @mention email delivery + opt-out — signoff: __________
- [ ] **S08** — Cross-tab realtime broadcast — signoff: __________
- [ ] **S09** — Tier-locked discovery card — signoff: __________
- [ ] **S10** — Public knowledge hub + AI citations — signoff: __________
- [ ] **S11** — Protocol Creator 2-person review — signoff: __________
- [ ] **S12** — Insights research blog + k-anonymity — signoff: __________
- [ ] **S13** — State-privacy opt-out propagation — signoff: __________
- [ ] **S14** — ES locale smoke (non-critical) — signoff: __________
- [ ] **S15** — Audience landing per-audience render — signoff: __________
- [ ] **S16** — Demo-org auto-purge (non-critical) — signoff: __________
- [ ] **S17** — gsd-ui-auditor final-pass — signoff: __________
- [ ] **S18** — Dark-mode VR snapshot diff — signoff: __________
- [ ] **S19** — Lighthouse mobile ≥90 — signoff: __________
- [ ] **S20** — DS-01/02/03 CI gates fire on PR — signoff: __________
- [ ] **S21** — Evidence dir bootstrap — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 21 signals green |
| `approved — non-criticals-deferred` | 16 critical signals green; non-criticals deferred with GH issues |
| `blocked: <reason>` | Any critical signal cannot land |

<output>
Update PLAN.md inline. Plan 08 aggregates this file's checkbox state.
</output>
