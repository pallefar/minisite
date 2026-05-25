# Phase 42: v1.3 Polish Closeout - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

v1.3 milestone-closing polish across 7 cross-cutting REQs:

1. **Smart notifications** (POLISH-05/06) — 5 categories × 3 channels with sensible defaults, frequency caps, dismissal-rate sentiment, per-category snooze; self-serve `/settings/notifications` center.
2. **WCAG 2.2 AA gate** (POLISH-09) — axe-core in CI scanning every route with baseline tracking; Critical+Serious blocking; VoiceOver HUMAN-UAT on top-5 v1.3 user flows.
3. **PWA + offline read-only** (POLISH-07) — vite-plugin-pwa; offline-view of existing data (logging disabled with banner); branded deferred install prompt; non-blocking SW update toast.
4. **Dark mode parity** (POLISH-08) — extends existing data-theme attribute to ALL v1.3 new surfaces (admin shell + helpdesk + onboarding builder + clinic dashboard + community + courses).
5. **"What's New" drawer** (POLISH-11) — changelog-style entries surfaced post-deploy with per-user dismissal state.
6. **Quarterly NPS survey** (POLISH-12) — SEPARATE instrument from P36 review-prompt; email-first with in-app fallback; tenure × plan × cohort segmentation in admin dashboard.

**Out of scope (explicitly):**
- Log-with-sync-queue offline (read-only only in v1.3; sync queue v1.4 polish).
- Claude theme-clustering on quarterly NPS responses (verbatim only in v1.3; v1.4 polish).
- Contracted accessibility audit (VoiceOver self-audit in v1.3; revisit for v1.5 enterprise).
- v1.1/v1.2 pre-existing a11y debt fix-all (baseline-grandfathered; v1.3 + new only blocks).
- Sentiment-aware via Claude scoring (dismissal-rate heuristic in v1.3; Claude scoring v1.4 if surface demand).

</domain>

<decisions>
## Implementation Decisions

### Smart Notifications (POLISH-05/06)

- **D-01: 5 categories × 3 channels = 15 channel-category combos.** Categories: `dose-reminders`, `ai-insights`, `clinic-alerts`, `billing`, `marketing`. Channels: `email`, `web-push`, `in-app`. Each combo independently togglable in `notification_settings(user_id, category, channel, enabled boolean default <smart-default>)`.
- **D-02: Sensible per-channel defaults (NOT default-off, NOT default-on for everything).**
  - `dose-reminders`: push + email ON; in-app ON
  - `ai-insights`: in-app + push ON; email OFF
  - `clinic-alerts` (URGENT): email + push ON; in-app ON
  - `billing`: email ON; push + in-app OFF
  - `marketing`: email ON only; push + in-app OFF
- **D-03: URGENT escalation for clinic-alerts.** Push notifications for `clinic-alerts` request URGENT priority via Web Push `urgency: 'high'` header (FCM/APNS bypass quiet-hours). Justified clinically. Other categories use normal priority.
- **D-04: Frequency caps per category (clinical-uncapped pattern).**
  - `dose-reminders`: unlimited (clinical safety > attention budget)
  - `ai-insights`: max 3/day
  - `clinic-alerts`: unlimited (URGENT)
  - `billing`: max 1/week
  - `marketing`: max 1/week
  - Admin-tunable in `notification_category_config` table (Plan picks shape); user-tunable in /settings/notifications only DOWNWARD (user can lower their own cap, never raise).
- **D-05: Dismissal-rate sentiment-aware (NOT Claude-scored).** Server tracks per-category dismissal events over rolling 7d. If user dismisses ≥3 consecutive notifications in a category, that category's frequency cap is HALVED for the next 7d. Self-correcting; transparent to user via /settings/notifications banner ("We've reduced AI Insights frequency because you've dismissed several. Restore?"). No Claude calls.
- **D-06: Per-category snooze with 1d / 7d / 30d options.** User snoozes a category from in-app notification long-press OR /settings/notifications; snooze writes `notification_settings.snoozed_until`. Server checks before fire. Snooze can stack with cap (snoozed = 0 notifications regardless of cap).
- **D-07: Self-serve /settings/notifications center** with toggle matrix (5 cats × 3 channels), snooze controls, frequency caps (down-only), and current dismissal-rate-suppression banners. Reuses Phase 22 settings drawer pattern.
- **D-08: Email channel routes through `_shared/email-router.ts` (P25 D-03).** PHI-bearing notifications (clinic-alerts) → SES; non-PHI (dose/ai/billing/marketing) → Resend.

### WCAG 2.2 AA Scope + axe-core CI Gate (POLISH-09)

- **D-09: Scan EVERY route (v1.1 + v1.2 + v1.3) with baseline tracking.** Initial baseline file `accessibility-baseline.json` captures current violation count per route. CI blocks ONLY on NEW violations (count > baseline). Pre-existing a11y debt is tracked but not blocking. Forces no-regression posture without blocking ship on legacy debt.
- **D-10: axe-core severity gate — block on Critical + Serious; warn on Moderate; ignore Minor.** Pure Node axe-core (jsdom; no headless browser). Fast (~30s for all routes). Critical+Serious block PR merge; Moderate logged in PR comment; Minor ignored.
- **D-11: VoiceOver HUMAN-UAT on top-5 v1.3 user flows.** Founder runs VoiceOver on macOS for:
  1. Signup flow (P34 onboarding hybrid 3-card)
  2. Dose log entry
  3. Share-link generation (Phase 8 doctor read-share)
  4. Clinic invite acceptance (P28)
  5. Quarterly NPS modal (Phase 42 D-23 in-app fallback)
  Documented as HUMAN-UAT checkpoint in PLAN.md; not blocking ship but flagged in commit notes.
- **D-12: CI integration via @axe-core/react + Playwright-light wrapper.** Pure Node axe-core via the React-aware adapter; Playwright NOT used (skipped per D-10 to keep CI fast). If specific routes need real-browser scan (dynamic content, focus traps), planner can add @axe-core/playwright for those routes only.

### PWA + Offline Mode (POLISH-07)

- **D-13: Offline scope = read-only.** User can VIEW existing data (charts, history, projections, AI coach history). Logging (injection, weight, symptom, workout) is DISABLED offline with clear banner: "You're offline — logging resumes when reconnected." No sync queue (deferred to v1.4).
- **D-14: Share-link viewing offline = NOT supported.** Share-link rendering queries Supabase for the LATEST patient data; offline doctor sees the placeholder ("Reconnect to view this share"). Explicit deferral; not a regression because v1.2 share-links also required network.
- **D-15: Service worker precache strategy.** vite-plugin-pwa's `generateSW` mode with workbox; precache: index + dashboard route shell + lazy chunks for tabs the user has visited. Runtime cache: Supabase API responses (5min TTL); image responses (1 day). Strategy: `NetworkFirst` for API, `CacheFirst` for assets.
- **D-16: Install prompt = custom deferred prompt.** Capture `beforeinstallprompt` event; suppress default browser UI. Show branded "Install LeanShot" card AFTER engagement signal: user's 3rd dashboard visit AND no `installed=true` mark. Card has primary "Install" + secondary "Maybe later" (sets snooze 30d). Per [web.dev/install-criteria](https://web.dev/install-criteria/).
- **D-17: Service worker update notification = non-blocking toast.** vite-plugin-pwa's `autoUpdate` with `skipWaiting: false`. Service worker registers new version → emits message → useToast shows "New version available. Reload to update." with Reload button. User reloads at own pace; no data loss mid-form. Toast persists across nav until clicked.
- **D-18: PWA coexistence with v1.4 Capacitor mobile shell.** PWA is web-only; Capacitor wraps the SAME web bundle for iOS/Android. Service worker disabled inside Capacitor (Capacitor.isNativePlatform() check on registration). PWA install prompt suppressed inside Capacitor. Avoids dual-update-system conflict.

### Quarterly NPS Survey (POLISH-12)

- **D-19: SEPARATE instrument from P36 — dedicated `quarterly_nps_responses` schema.** New table; new admin module at `/admin/nps/quarterly`. Does NOT share P36 cooldown or 5-lifetime cap (a user who hit P36's cap CAN still receive a quarterly NPS — different instrument purpose). Both can fire on the same user.
- **D-20: V13-3 BLOCKER lint extends to quarterly-NPS surfacing.** P36 D-03's ESLint AST rule (no-conditional-native-review) ALSO covers quarterly NPS code. UNCONDITIONAL native-fire principle is universal across NPS instruments.
- **D-21: Delivery — email-first with in-app fallback.** Quarterly NPS campaign sends via Resend (`_shared/email-router.ts`; consumer credential per P25). Email body: NPS question + 0-10 buttons as signed query-param links (`/nps/respond?score=N&token=...`); click → landing page with open-text follow-up. **In-app fallback:** if user hasn't responded within 30 days AND logs in during that window, show in-app NPS modal (5-star scale per P36 D-09 pattern; same DS Modal primitive). One channel only counts; once responded via either, the quarter is complete.
- **D-22: Quarterly cadence = once per calendar quarter per user.** `pg_cron` job runs first-of-quarter (Jan 1 / Apr 1 / Jul 1 / Oct 1 UTC); identifies eligible users (active in last 90d; not yet responded this quarter); enqueues Resend campaign batch. Per-user lifetime tracking in `quarterly_nps_responses(user_id, quarter, score, comment, responded_via channel, responded_at)`.
- **D-23: Eligibility = active in last 90d.** Tightens the "active users" definition from ROADMAP. Avoids spamming churned users; preserves response-rate signal.
- **D-24: Admin dashboard at /admin/nps/quarterly.** Layout: top-line current-quarter NPS score + delta-vs-prior-quarter; trend chart (4-quarter rolling) with optional dim by tenure-bucket / plan-tier / cohort; verbatim open-text responses paginated below, filterable by score range. ROADMAP-literal. Reuses Phase 33 admin dashboard chart pattern.

### Claude's Discretion (POLISH-08, POLISH-11, others)

- **Dark mode parity (POLISH-08).** Existing useTheme + applyThemeToDOM + data-theme attribute pattern (v1.1). Audit each v1.3 new surface (admin shell + helpdesk + onboarding builder + clinic dashboard + community + courses) for token coverage. Add missing dark variants via CSS custom properties in src/index.css. Planner picks per-surface manual review vs Playwright VR diff approach.
- **"What's New" drawer (POLISH-11).** Admin-curated changelog entries (NOT auto-generated from git log — too noisy). Stored in `changelog_entries(slug, title, body_md, published_at)`. Per-user dismissal state in `user_changelog_dismissed(user_id, last_seen_published_at)`. Drawer surfaces entries with `published_at > user.last_seen_published_at`. Trigger: subtle dot indicator on header avatar; user click opens drawer. Planner picks UI shape.
- **Push notification web-push setup.** VAPID keys (vendor-gated; Plan needs HUMAN-UAT for VAPID key generation + Supabase secret); web-push library (Node-compat); user permission flow inside settings center.
- **`notification_categories` config seed.** Planner picks initial admin-configurable shape (per-category daily cap, channels enabled, URGENT escalation flag) seeded via migration.
- **Notification rendering pipeline.** in-app notifications stored in `user_notifications` table; React subscribes via Supabase Realtime; toast component renders.

</decisions>

<canonical_refs>
## Canonical References

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 42: v1.3 Polish Closeout" — 5 success criteria
- `.planning/REQUIREMENTS.md` §WS-Polish lines 236–243 — POLISH-05/06/07/08/09/11/12 verbatim

### Prior-phase load-bearing
- `.planning/phases/22-*/` — settings drawer + cookie-consent (D-07 settings center pattern; D-16 install-prompt consent)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — D-13 server-side PostHog (notification fire events captured server-side); D-18..20 bundle ceilings (PWA service worker stays out of index chunk)
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — D-03 SES/Resend split (D-08 email routing)
- `.planning/phases/27-modular-admin-shell-extensions/` — admin shell + dashboard chart pattern
- `.planning/phases/33-*/` — admin-CAC dashboard chart pattern (D-24 quarterly NPS dashboard reuses)
- `.planning/phases/36-m3-review-prompt-engine-web-only/36-CONTEXT.md` — V13-3 BLOCKER lint (D-20 extension); 5-star modal pattern (D-21 in-app fallback)
- `.planning/phases/37-m6-helpdesk-core/37-CONTEXT.md` — notification frequency / dismissal patterns

### Codebase
- `leanshot/src/hooks/useTheme.ts` — dark mode primitive (POLISH-08 audit basis)
- `leanshot/src/index.css` — `data-theme` CSS custom properties (extends per v1.3 surface)
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx` — D-07 extends with /settings/notifications subtab
- `leanshot/src/lib/analytics/events.ts` — extend with notification events (`notification_sent`, `notification_dismissed`, `notification_clicked`, `notification_snoozed`, `nps_quarterly_sent`, `nps_quarterly_responded`)
- `leanshot/src/lib/org.ts` — `surfaceCheck('admin.nps.quarterly')` for admin dashboard
- `leanshot/eslint-rules/no-conditional-native-review.cjs` (P36 D-03) — extends per D-20
- `leanshot/vite.config.ts` — add vite-plugin-pwa (POLISH-07)
- `leanshot/src/test-setup.ts` — extend with @axe-core/react setup for CI integration
- `supabase/functions/_shared/email-router.ts` (P25 D-03) — D-08 + D-21 reuses
- New tables: `notification_settings`, `notification_category_config`, `user_notifications`, `changelog_entries`, `user_changelog_dismissed`, `quarterly_nps_responses`

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STACK.md` — vite-plugin-pwa added here
- `.planning/codebase/TESTING.md` — extend with axe-core CI gate

### Memory pointers
- [[reference_supabase_migration_filename_regex]]
- [[reference_supabase_migration_gotchas]]
- [[reference_supabase_pg_cron_vault_service_role_pattern]] — D-22 quarterly cron
- [[reference_postgres_dollar_quote_nesting_in_cron_body]] — for D-22 cron body
- [[reference_supabase_functions_deploy_no_linked_flag]]
- [[feedback_planner_missed_status_enum_widening]] — `notification_settings` snooze status, `quarterly_nps_responses` channel enum
- [[feedback_planner_iter1_anti_patterns]]
- [[reference_grep_gate_comment_strip]]
- [[feedback_scaffolding_for_deferred_mobile_pattern]] — D-18 PWA-vs-Capacitor coexistence

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- useTheme + applyThemeToDOM (v1.1) — POLISH-08 dark mode base
- DS Modal + Card + Toast primitives — D-21 in-app NPS + D-17 SW update toast + D-08 placeholder
- useReducedMotion (v1.1) — install-prompt animation gating
- _shared/email-router.ts (P25 D-03) — D-08 + D-21 routing
- Phase 33 admin dashboard chart pattern — D-24 quarterly NPS dashboard
- Phase 22 settings drawer + cookie consent — D-07 settings extension + D-16 consent flow
- Phase 36 V13-3 BLOCKER lint + 5-star modal — D-20 extension + D-21 fallback
- audit_logs schema (P25) — quarterly NPS admin actions audit

### Established Patterns
- pg_cron + SECDEF + vault.decrypted_secrets pattern (D-22 quarterly cron)
- Append-only history tables (user_notifications, quarterly_nps_responses follow audit_logs / xp_ledger pattern)
- Append-only settings with composite key (notification_settings(user_id, category, channel) UNIQUE)
- baseline-track-then-block-on-new pattern (D-09 a11y) — mirrors lint debt baseline approach
- vite-plugin-pwa generateSW mode for PWA (D-15)
- _shared/email-router.ts phi-aware routing — extends naturally to notification categories

### Integration Points
- App.tsx — register service worker (D-15); install-prompt orchestrator (D-16); push permission flow
- Settings drawer — extend with /notifications subtab (D-07)
- Header → avatar — What's New drawer trigger (POLISH-11)
- Edge Fns: `notification-send`, `notification-dismiss`, `notification-snooze`, `nps-quarterly-cron`, `nps-quarterly-respond`
- vite.config.ts — vite-plugin-pwa addition (D-15)
- CI workflow — add axe-core scan step (D-09/D-10)
- New cron jobs: quarterly-nps-cron (first-of-quarter UTC)

</code_context>

<specifics>
## Specific Ideas

- The SEPARATE quarterly NPS instrument (D-19) vs P36 event-triggered NPS is a deliberate decoupling. Different cadence, different question, different downstream consumer (admin dashboard vs review-routing). Same V13-3 BLOCKER (D-20) keeps the safety rule universal.
- Read-only offline (D-13) is the right v1.3 scope — sync queue requires conflict-resolution semantics, IndexedDB write patterns, idempotency tokens, and partial-sync error UX. All deferred to a v1.4 polish phase if usage data shows offline-logging demand.
- Branded deferred install prompt (D-16) is a meaningful UX investment but worth it — install-rate research shows custom prompts with delayed timing significantly outperform browser defaults.
- Dismissal-rate sentiment (D-05) is intentionally NOT Claude-scored. Avoids per-user Claude cost + PHI surface; the heuristic is simple, transparent, user-controllable.
- Clinical-uncapped notifications (D-04) prioritize patient safety over attention budget. Plan-checker enforces: NO admin UI surface lets admin set `dose-reminders` or `clinic-alerts` daily cap to anything but unlimited.
- VoiceOver HUMAN-UAT on top-5 flows (D-11) is the right calibration — full WCAG audit ($2-5K + 2-3 weeks) is over-investment for v1.3 timeline; pure-automated misses focus management.
- PWA + Capacitor coexistence (D-18) prevents the classic "service worker fights native shell" trap. Single web bundle, two delivery wrappers.

</specifics>

<deferred>
## Deferred Ideas

### Offline log-with-sync-queue
Read-only in v1.3. Sync-queue (IndexedDB write + conflict resolution + idempotency) is v1.4 polish if surface demand.

### Claude sentiment scoring for notification frequency
Dismissal-rate heuristic in v1.3. Claude-scored sentiment is v1.4 polish if dismissal-heuristic proves insufficient.

### Claude theme-clustering on quarterly NPS responses
Verbatim only in v1.3. Auto-clustering verbatim into themes is v1.4 polish.

### Contracted accessibility audit
VoiceOver self-audit in v1.3. Hired consultant ($2-5K + 2-3 weeks) deferred to v1.5 enterprise tier.

### v1.1/v1.2 pre-existing a11y fix-all
Baseline-grandfathered in v1.3. New code can't add violations; pre-existing debt acknowledged but not fixed. Bulk fix-all in a future polish-debt phase.

### Push notification web-push beyond fundamentals
v1.3 ships basic web-push. Advanced features (rich notifications, action buttons, image attachments) deferred to v1.4.

### Per-notification action buttons (e.g., "Dismiss" / "Snooze 1h" / "View" inline)
v1.3 ships basic notifications. Per-platform action button support (varies wildly across browsers) deferred.

### Service worker update silently in background + show on next manual refresh
v1.3 uses toast prompt. Silent background update is v1.4 polish.

### Quarterly NPS — segmentation by feature usage
v1.3 segments by tenure + plan + cohort. Feature-usage segmentation (e.g., "AI coach heavy users" vs "tracking-only users") deferred to v1.4.

</deferred>

---

*Phase: 42-v1-3-polish-closeout*
*Context gathered: 2026-05-19*
