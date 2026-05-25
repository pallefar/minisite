# Phase 42: v1.3 Polish Closeout — Research

**Researched:** 2026-05-19
**Domain:** Accessibility CI gate · Smart notifications · PWA offline · Dark-mode parity · Changelog UX · Quarterly NPS
**Confidence:** HIGH (Standard Stack / Patterns) · MEDIUM (Pitfalls — multiple verified) · HIGH (User Constraints)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Smart Notifications (POLISH-05/06)**

- **D-01:** 5 categories × 3 channels = 15 channel-category combos. Categories: `dose-reminders`, `ai-insights`, `clinic-alerts`, `billing`, `marketing`. Channels: `email`, `web-push`, `in-app`. `notification_settings(user_id, category, channel, enabled boolean default <smart-default>)`.
- **D-02:** Sensible per-channel defaults (NOT default-off, NOT default-on for everything):
  - `dose-reminders`: push + email ON; in-app ON
  - `ai-insights`: in-app + push ON; email OFF
  - `clinic-alerts` (URGENT): email + push ON; in-app ON
  - `billing`: email ON; push + in-app OFF
  - `marketing`: email ON only; push + in-app OFF
- **D-03:** URGENT escalation for clinic-alerts via Web Push `urgency: 'high'` header.
- **D-04:** Frequency caps per category (clinical-uncapped pattern). dose-reminders + clinic-alerts unlimited; ai-insights 3/day; billing + marketing 1/week. Admin-tunable in `notification_category_config`; user-tunable DOWNWARD only.
- **D-05:** Dismissal-rate sentiment-aware (NOT Claude-scored). Rolling 7d; ≥3 consecutive dismissals → cap HALVED for next 7d; banner in /settings/notifications.
- **D-06:** Per-category snooze 1d / 7d / 30d → `notification_settings.snoozed_until`.
- **D-07:** Self-serve `/settings/notifications` center; reuses P22 settings drawer pattern.
- **D-08:** Email channel routes through `_shared/email-router.ts` (P25 D-03). PHI (clinic-alerts) → SES; non-PHI → Resend.

**WCAG 2.2 AA + axe-core CI Gate (POLISH-09)**

- **D-09:** Scan EVERY route with baseline tracking. `accessibility-baseline.json` captures per-route violation count; CI blocks ONLY on NEW violations (count > baseline).
- **D-10:** axe-core severity gate — block on Critical + Serious; warn on Moderate; ignore Minor. Pure Node axe-core (jsdom; no headless browser).
- **D-11:** VoiceOver HUMAN-UAT on top-5 v1.3 flows (signup, dose log, share-link, clinic invite accept, NPS modal).
- **D-12:** CI via @axe-core/react + Playwright-light wrapper. Playwright NOT default; only for routes with dynamic content / focus traps.

**PWA + Offline (POLISH-07)**

- **D-13:** Offline scope = read-only. Logging DISABLED offline with banner. No sync queue (v1.4).
- **D-14:** Share-link viewing offline = NOT supported.
- **D-15:** vite-plugin-pwa `generateSW` mode with workbox. Precache: index + dashboard route shell + lazy chunks for visited tabs. Runtime: `NetworkFirst` for Supabase API (5 min TTL); `CacheFirst` for assets (1 day).
- **D-16:** Custom deferred install prompt via `beforeinstallprompt`; show after 3rd dashboard visit AND no `installed=true` mark.
- **D-17:** SW update = non-blocking toast. `registerType: 'autoUpdate'` with `skipWaiting: false`.
- **D-18:** PWA disabled inside Capacitor (`Capacitor.isNativePlatform()` check).

**Quarterly NPS (POLISH-12)**

- **D-19:** SEPARATE instrument from P36 — dedicated `quarterly_nps_responses` table; new admin module `/admin/nps/quarterly`. Does NOT share P36 cooldown / 5-lifetime cap.
- **D-20:** V13-3 BLOCKER lint (`no-conditional-native-review.cjs`) ALSO covers quarterly NPS.
- **D-21:** Email-first with in-app fallback. Resend via `_shared/email-router.ts`; signed query-param links (`/nps/respond?score=N&token=...`). In-app fallback: 30-day window; 5-star modal (P36 D-09 pattern).
- **D-22:** Quarterly cadence — `pg_cron` first-of-quarter UTC (Jan 1 / Apr 1 / Jul 1 / Oct 1).
- **D-23:** Eligibility = active in last 90d.
- **D-24:** Admin dashboard at `/admin/nps/quarterly` (reuses Phase 33 chart pattern).

### Claude's Discretion

- **Dark mode parity (POLISH-08).** Audit each v1.3 surface (admin shell + helpdesk + onboarding builder + clinic dashboard + community + courses). Per-surface manual vs Playwright VR diff approach.
- **"What's New" drawer (POLISH-11).** Admin-curated changelog (NOT git-log auto-gen). Tables: `changelog_entries(slug, title, body_md, published_at)` + `user_changelog_dismissed(user_id, last_seen_published_at)`. Trigger: subtle dot on header avatar.
- **Push web-push setup.** VAPID keys (vendor-gated; HUMAN-UAT); `web-push` library; permission flow inside settings.
- **`notification_categories` config seed.** Planner picks initial admin-configurable shape.
- **Notification rendering pipeline.** `user_notifications` table; React subscribes via Supabase Realtime; toast renders.

### Deferred Ideas (OUT OF SCOPE)

- Offline log-with-sync-queue (v1.4 polish).
- Claude sentiment scoring for notification frequency (v1.4).
- Claude theme-clustering on quarterly NPS verbatim (v1.4).
- Contracted accessibility audit (v1.5 enterprise).
- v1.1/v1.2 pre-existing a11y fix-all (baseline-grandfathered).
- Push notification advanced features (rich notifications, action buttons, image attachments) — v1.4.
- Per-notification action buttons (Dismiss / Snooze 1h / View inline) — v1.4.
- Silent background SW update — v1.4 polish.
- Quarterly NPS feature-usage segmentation — v1.4.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POLISH-05 | Smart notifications (email + web-push + in-app) with frequency-capping + snoozable + sentiment-aware per `notification_settings` | §Standard Stack notifications, §Architecture Pattern 1 + 2, §Pitfall 3/4/8 |
| POLISH-06 | Self-serve notification preference center with per-category opt-out | §Architecture Pattern 1, §Code Example "settings matrix" |
| POLISH-07 | PWA + offline mode via vite-plugin-pwa + native-feeling install prompt | §Standard Stack PWA, §Architecture Pattern 3, §Pitfall 1/2/5/9 |
| POLISH-08 | Dark mode parity across all v1.3 new surfaces | §Standard Stack dark-mode, §Architecture Pattern 5, §Pitfall 7 |
| POLISH-09 | WCAG 2.2 AA via axe-core in CI + keyboard/SR/contrast/focus verified | §Standard Stack a11y, §Architecture Pattern 4, §Pitfall 6/10, §Code Example axe-baseline |
| POLISH-11 | "What's New" in-app drawer with per-user dismissal state | §Architecture Pattern 6 |
| POLISH-12 | Quarterly NPS survey w/ admin segmentation | §Architecture Pattern 7, §Pitfall 11 |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- React 19 + Vite 6 + TS strict + Tailwind v4 beta + Zustand. SPA, browser-only, no SSR.
- **Local-first must continue to work** — PWA caching extends this, doesn't replace it. Service worker MUST coexist with Zustand `persist`.
- Bundle size aggressive: per-chunk ceilings (admin-shell 30 kB, helpdesk-widget 25 kB, gamification-burst 8 kB, community-feed 20 kB, course-player 30 kB) — **service worker registration code MUST stay out of index chunk** (lazy-load via dynamic import).
- Accessibility is a constraint, not a nice-to-have (audience includes patients with chronic conditions).
- ESLint already enforces alphabetized imports + a11y rules (jsx-a11y) + custom `no-restricted-syntax` rules — Phase 42 EXTENDS, doesn't conflict.
- Strict TypeScript + `tsc -b --noEmit` is the typecheck gate (CLAUDE.md scripts).
- All entry through GSD workflow.

## Summary

Phase 42 closes v1.3 with six cross-cutting polish workstreams: an axe-core baseline-tracked WCAG 2.2 AA CI gate (block-only-on-new-violations), a 5-category × 3-channel notification preference system with dismissal-rate sentiment auto-throttling, vite-plugin-pwa read-only offline mode with a custom deferred install prompt, dark-mode parity across all six new v1.3 surfaces, an admin-curated "What's New" drawer, and a quarterly NPS instrument that is **separate** from Phase 36's review-prompt engine. All decisions are locked in CONTEXT.md (24 of them); planner's freedom is in dark-mode audit approach, "What's New" UI shape, push setup mechanics, and rendering pipeline.

**Primary recommendation:** Use `vite-plugin-pwa@1.3.0` (`generateSW` mode with `registerType: 'autoUpdate'` + `skipWaiting: false`), `axe-core@4.11.4` + `@axe-core/react@4.11.3` running in vitest with jsdom (NOT Playwright by default), `web-push@3.6.7` for VAPID push, and Tailwind v4's `@theme dark` selector pattern on existing `data-theme` attribute. Build the smart notification engine as a server-driven (Edge Function) firing decision over `notification_settings` + `notification_category_config` + `notification_dismissal_state` tables, with in-app rendering subscribed via Supabase Realtime on `user_notifications`. Quarterly NPS uses `pg_cron` first-of-quarter with the existing vault service_role pattern.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Notification firing decision (cap check, snooze check, sentiment throttle) | API / Edge Function | Database (RLS-protected reads) | PHI-aware; per-user state; must be server-authoritative |
| Notification delivery — email | API / Edge Function | External (Resend/SES via email-router) | Email-router is server-only (P25 D-03) |
| Notification delivery — web-push | API / Edge Function | External (FCM/APNS via web-push library) | VAPID signing requires server private key |
| Notification delivery — in-app | Database (Realtime) | Browser (subscribe) | `user_notifications` table → Realtime channel → toast |
| Notification preference UI (`/settings/notifications`) | Browser | API (mutations) | Read/write `notification_settings`; reuses P22 settings drawer |
| Dismissal-rate sentiment computation | API / Edge Function | Database (`notification_dismissal_state`) | Rolling 7d windowed query; runs at fire-decision time |
| axe-core CI gate | CI runner (Node/jsdom) | — | Pre-commit / PR check; no runtime tier |
| WCAG baseline tracking | Repo (committed JSON file) | CI runner | Per-route violation count diff |
| PWA service worker | Browser | CDN (precache origin) | Standard SW scope; runtime cache for Supabase API |
| PWA install prompt orchestration | Browser | Database (`installed=true` mark optional) | `beforeinstallprompt` event handler |
| Dark-mode tokens | Browser (CSS custom props) | — | `data-theme` attribute on `<html>`; CSS-only |
| Dark-mode audit | CI runner (Playwright VR optional) | — | Visual regression diff if planner picks that route |
| "What's New" drawer | Browser | Database (`changelog_entries` + `user_changelog_dismissed`) | Admin writes entries; user reads + dismisses |
| Quarterly NPS cron | Database (pg_cron) | API (Edge Function `nps-quarterly-cron`) | First-of-quarter UTC enqueues batch |
| Quarterly NPS email landing | API / Edge Function | Browser (in-app fallback) | Signed token verification + write response |
| Quarterly NPS admin dashboard | Browser | Database (rollup view) | Reuses Phase 33 chart pattern |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vite-plugin-pwa` | `^1.3.0` `[VERIFIED: npm view 2026-05-19]` | PWA / service worker / manifest / precaching | Zero-config, framework-agnostic Vite plugin; wraps Workbox; canonical choice for Vite SPAs `[CITED: github.com/vite-pwa/vite-plugin-pwa]` |
| `workbox-window` | `^7.4.1` `[VERIFIED: npm view 2026-05-19]` | Client-side SW lifecycle (update events) | Bundled internally by vite-plugin-pwa for `virtual:pwa-register`; expose for SW update toast `[CITED: vite-pwa docs]` |
| `axe-core` | `^4.11.4` `[VERIFIED: npm view 2026-05-19]` | WCAG rule engine | Industry-standard a11y testing engine; Deque Labs; backs every major CI a11y tool `[CITED: github.com/dequelabs/axe-core API.md]` |
| `@axe-core/react` | `^4.11.3` `[VERIFIED: npm view 2026-05-19]` | React-aware axe runtime adapter | Bridges React Fiber tree to axe-core; per D-12 the runtime adapter for component-level scans |
| `web-push` | `^3.6.7` `[VERIFIED: npm view 2026-05-19]` | VAPID push notification dispatch | Node-compat library; works in Deno via npm: specifier; only canonical option for self-hosted web-push |
| `resend` | `^6.12.3` `[VERIFIED: npm view 2026-05-19]` | Non-PHI email send (Phase 42 leverages — already shipped via P25) | Already in stack; routed via `_shared/email-router.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@axe-core/playwright` | `^4.11.3` `[VERIFIED: npm view 2026-05-19]` | Playwright-based axe scan | OPT-IN per D-12; only for routes with dynamic content / focus traps that jsdom can't render correctly |
| `@vite-pwa/assets-generator` | `^1.0.2` `[VERIFIED: npm view 2026-05-19]` | PWA icon / splash asset generation | One-off pipeline at build for manifest icons; bundle-size neutral |
| `jsdom` | latest minor of vitest's bundled jsdom | DOM for Node-side axe scan | Already used by vitest (`src/test-setup.ts` exists); reuse |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `vite-plugin-pwa` | Hand-rolled `workbox-cli` + manifest | Same Workbox runtime; plugin gives Vite asset-hashing integration + `virtual:pwa-register` for free; hand-roll adds 200+ lines and breaks on Vite asset hash changes `[ASSUMED]` |
| Pure Node axe via jsdom | `@axe-core/playwright` for all routes | Playwright accurate but 5-10× slower; user locked D-10 to "Pure Node axe-core (jsdom; no headless browser). Fast (~30s for all routes)" |
| Self-hosted NPS table | Delighted/Wootric integration | User locked D-19 to self-hosted (`quarterly_nps_responses`); vendor adds BAA chain complexity + cost |
| Native browser SW update prompt | `workbox-window` event-driven toast | Native prompt is jarring; D-17 picked toast for UX continuity |
| Hand-rolled web-push fetch + VAPID JWT | `web-push` library | VAPID JWT signing is ECDSA P-256 — easy to get wrong; `web-push` is the only Node-compat library with current maintenance `[VERIFIED: npm view web-push 3.6.7]` |

**Installation (additions to `package.json`):**

```bash
# Dev dependencies (CI + tests)
npm install -D vite-plugin-pwa@^1.3.0 \
              workbox-window@^7.4.1 \
              axe-core@^4.11.4 \
              @axe-core/react@^4.11.3 \
              @vite-pwa/assets-generator@^1.0.2
# Optional, per-route opt-in
npm install -D @axe-core/playwright@^4.11.3

# Runtime (Edge Function only — Deno via npm: specifier)
# supabase/functions/notification-send/index.ts:
#   import webpush from 'npm:web-push@3.6.7'
```

**Version verification (npm registry, 2026-05-19):**

| Package | Version | Publish/Source Verified |
|---------|---------|-------------------------|
| `vite-plugin-pwa` | 1.3.0 | `npm view vite-plugin-pwa version` → `1.3.0` |
| `workbox-window` | 7.4.1 | `npm view workbox-window version` → `7.4.1` |
| `axe-core` | 4.11.4 | `npm view axe-core version` → `4.11.4` |
| `@axe-core/react` | 4.11.3 | `npm view @axe-core/react version` → `4.11.3` |
| `@axe-core/playwright` | 4.11.3 | `npm view @axe-core/playwright version` → `4.11.3` |
| `web-push` | 3.6.7 | `npm view web-push version` → `3.6.7` |
| `@vite-pwa/assets-generator` | 1.0.2 | `npm view @vite-pwa/assets-generator version` → `1.0.2` |
| `resend` | 6.12.3 | already in stack from P25 |

## Architecture Patterns

### System Architecture Diagram

```text
                       ┌─────────────────────────────────────────┐
                       │   Phase 42 Six Workstreams              │
                       └─────────────────────────────────────────┘
                                          │
       ┌───────────────────────┬──────────┼──────────┬─────────────────────┐
       │                       │          │          │                     │
   [A11Y]                [NOTIFICATIONS]  │      [DARK MODE]          [NPS / WHAT'S NEW]
       │                       │          │          │                     │
       ▼                       ▼          ▼          ▼                     ▼
   axe-core CI gate     Edge Fns:    PWA / SW     CSS @theme dark    pg_cron + admin
       │             [send,dismiss,snooze]  │      tokens                  │
       │                       │          │          │                     │
       ▼                       ▼          ▼          ▼                     ▼
   ┌─────────┐         ┌──────────────┐ ┌──────┐ ┌──────────┐       ┌──────────────┐
   │baseline.│         │notification_ │ │SW    │ │data-     │       │quarterly_nps │
   │   json  │         │settings      │ │cache │ │theme="d" │       │_responses    │
   │ (repo)  │         │+ category    │ │+pre- │ │CSS vars  │       │              │
   │         │         │_config       │ │cache │ │          │       │              │
   └─────────┘         │+ dismissal   │ └──────┘ └──────────┘       └──────────────┘
                       │_state        │     │                              │
                       │+ user_       │     ▼                              ▼
                       │notifications │  Browser                      Admin chart
                       └──────────────┘  install                      (P33 reuse)
                              │          prompt
                              ▼
                       ┌──────────────────────────────────┐
                       │  Delivery fan-out                │
                       │                                  │
                       │  ┌──────────┐  ┌──────────┐    │
                       │  │ Email    │  │ Web-Push │    │
                       │  │ via      │  │ VAPID    │    │
                       │  │ email-   │  │ via      │    │
                       │  │ router   │  │ web-push │    │
                       │  │ (P25)    │  │ library  │    │
                       │  └──────────┘  └──────────┘    │
                       │       │             │           │
                       │       ▼             ▼           │
                       │   Resend/SES    FCM/APNS        │
                       │                                  │
                       │  ┌──────────────────────┐       │
                       │  │ In-app: INSERT into  │       │
                       │  │ user_notifications   │       │
                       │  │ → Supabase Realtime  │       │
                       │  │ → React toast        │       │
                       │  └──────────────────────┘       │
                       └──────────────────────────────────┘
```

### Recommended Project Structure

```text
leanshot/
├── vite.config.ts                              # ADD: VitePWA() plugin
├── public/
│   ├── pwa-192x192.png                         # ADD: generated by @vite-pwa/assets-generator
│   ├── pwa-512x512.png                         # ADD
│   └── apple-touch-icon.png                    # ADD
├── src/
│   ├── lib/
│   │   ├── pwa/
│   │   │   ├── register.ts                     # ADD: virtual:pwa-register wrapper (lazy)
│   │   │   ├── install-prompt.ts               # ADD: beforeinstallprompt orchestrator
│   │   │   └── offline-store.ts                # ADD: read-only banner + logging gate
│   │   ├── notifications/
│   │   │   ├── settings-store.ts               # ADD: client-side cache of notification_settings
│   │   │   ├── permission.ts                   # ADD: web-push permission flow
│   │   │   └── realtime.ts                     # ADD: user_notifications channel subscribe
│   │   ├── changelog/
│   │   │   └── drawer-trigger.ts               # ADD: unread-dot computation
│   │   ├── nps/
│   │   │   └── quarterly-modal.ts              # ADD: in-app fallback trigger
│   │   ├── a11y/
│   │   │   └── axe-dev.ts                      # ADD: @axe-core/react dev-only mount
│   │   └── analytics/events.ts                 # EXTEND: 6 new event types
│   ├── components/
│   │   ├── dashboard/settings/
│   │   │   └── NotificationsSubtab.tsx         # ADD: 5×3 matrix + snooze + caps
│   │   ├── changelog/
│   │   │   └── WhatsNewDrawer.tsx              # ADD: Sheet primitive reuse
│   │   ├── nps/
│   │   │   └── QuarterlyNPSModal.tsx           # ADD: 5-star modal (P36 reuse)
│   │   └── pwa/
│   │       ├── InstallPromptCard.tsx           # ADD: branded deferred prompt
│   │       └── OfflineBanner.tsx               # ADD: top banner when offline
│   ├── hooks/
│   │   ├── useTheme.ts                         # NO CHANGE — already exists
│   │   ├── useOfflineState.ts                  # ADD: navigator.onLine + SW state
│   │   └── useInstallPrompt.ts                 # ADD: beforeinstallprompt state
│   ├── index.css                               # EXTEND: dark-mode tokens for v1.3 surfaces
│   └── test-setup.ts                           # EXTEND: axe-core register
├── supabase/
│   ├── migrations/
│   │   ├── <ts>_notification_tables.sql        # ADD
│   │   ├── <ts>_changelog_tables.sql           # ADD
│   │   ├── <ts>_quarterly_nps_tables.sql       # ADD
│   │   └── <ts>_quarterly_nps_cron.sql         # ADD: pg_cron + vault pattern
│   └── functions/
│       ├── notification-send/index.ts          # ADD: fire decision + fan-out
│       ├── notification-dismiss/index.ts       # ADD
│       ├── notification-snooze/index.ts        # ADD
│       ├── push-subscribe/index.ts             # ADD: store endpoint + keys
│       ├── nps-quarterly-enqueue/index.ts      # ADD: pg_cron target
│       └── nps-quarterly-respond/index.ts      # ADD: signed-token verify
├── tests/
│   ├── a11y/
│   │   ├── accessibility-baseline.json         # ADD: per-route baseline counts
│   │   ├── routes-manifest.ts                  # ADD: list of routes to scan
│   │   └── axe-baseline.test.ts                # ADD: vitest scan + diff
│   ├── rls/
│   │   ├── notification-settings-rls.test.ts   # ADD: cross-tenant proof (P22 pattern)
│   │   ├── changelog-rls.test.ts               # ADD
│   │   └── quarterly-nps-rls.test.ts           # ADD
│   └── integration/
│       └── notification-frequency-cap.test.ts  # ADD: cap enforcement + sentiment halving
├── e2e/
│   ├── pwa-offline.spec.ts                     # ADD: Playwright offline scenario
│   └── nps-modal-fallback.spec.ts              # ADD
└── eslint-rules/
    └── no-conditional-native-review.cjs        # EXTEND: cover quarterly NPS (D-20)
```

### Pattern 1: Notification Preference Matrix (5×3 grid)

**What:** Self-serve settings UI rendering the 15 (category × channel) combos with current toggle state, snooze controls, and cap displays.

**When to use:** `/settings/notifications` subtab in P22 settings drawer (D-07).

**Example:**

```typescript
// Source: project pattern + DS primitives (P22 settings drawer)
// File: src/components/dashboard/settings/NotificationsSubtab.tsx

const CATEGORIES = ['dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing'] as const;
const CHANNELS = ['email', 'web-push', 'in-app'] as const;

export function NotificationsSubtab() {
  const settings = useNotificationSettings(); // RLS-scoped fetch
  const updateSetting = useUpdateSetting();

  return (
    <Card>
      <CardHeader title="Notifications" />
      <table aria-label="Notification preferences">
        <thead><tr><th>Category</th>{CHANNELS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {CATEGORIES.map((cat) => (
            <tr key={cat}>
              <th scope="row">{labelFor(cat)}</th>
              {CHANNELS.map((ch) => (
                <td key={ch}>
                  <Toggle
                    aria-label={`${cat} ${ch}`}
                    checked={settings.get(cat, ch).enabled}
                    onChange={(v) => updateSetting({ category: cat, channel: ch, enabled: v })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <SnoozeControls />
      <FrequencyCapControls />
      <DismissalSuppressionBanner />
    </Card>
  );
}
```

### Pattern 2: Server-Side Fire Decision (Edge Function)

**What:** All firing decisions made server-side so cap / snooze / sentiment / category-config are authoritative.

**When to use:** Every notification fires via `notification-send` Edge Fn; no client-side fire path (avoids race + tamper).

**Example:**

```typescript
// Source: project pattern + Supabase Edge Function conventions
// File: supabase/functions/notification-send/index.ts

interface FireRequest { user_id: string; category: Category; payload: object; }

async function shouldFire(req: FireRequest, supa: SupabaseClient): Promise<FireDecision> {
  // 1. RLS-bypass service_role read of notification_settings
  const { data: prefs } = await supa.from('notification_settings')
    .select('channel, enabled, snoozed_until')
    .eq('user_id', req.user_id).eq('category', req.category);

  // 2. Category config (admin-set caps + URGENT flag)
  const { data: cfg } = await supa.from('notification_category_config')
    .select('daily_cap, urgent_escalation').eq('category', req.category).single();

  // 3. Dismissal state (D-05 sentiment)
  const { data: dismissal } = await supa.from('notification_dismissal_state')
    .select('consecutive_dismissals, throttle_until')
    .eq('user_id', req.user_id).eq('category', req.category).single();

  const effectiveCap = dismissal && Date.now() < new Date(dismissal.throttle_until).getTime()
    ? Math.floor(cfg.daily_cap / 2)
    : cfg.daily_cap;

  // 4. Today's fire count
  const { count: firedToday } = await supa.from('user_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user_id).eq('category', req.category)
    .gte('fired_at', startOfDayUTC());

  // 5. Per-channel decisions
  return {
    email: prefs.find((p) => p.channel === 'email')?.enabled
      && (firedToday < effectiveCap || effectiveCap === Infinity)
      && (!prefs.snoozed_until || new Date(prefs.snoozed_until) < new Date()),
    push: /* same */, in_app: /* same */,
    urgent: cfg.urgent_escalation,
  };
}
```

### Pattern 3: vite-plugin-pwa Configuration

**What:** Standard `generateSW` mode with `registerType: 'autoUpdate'` + `skipWaiting: false` (per D-15/D-17). User reload triggered manually via toast.

**Example:**

```typescript
// Source: vite-plugin-pwa docs [CITED: github.com/vite-pwa/vite-plugin-pwa/docs/guide/auto-update.md]
// File: vite.config.ts (extends existing config)

import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',          // D-17 (with manual prompt toast)
      injectRegister: false,                // we register manually via lazy chunk to keep index bundle small
      strategies: 'generateSW',             // D-15
      manifest: {
        name: 'LeanShot',
        short_name: 'LeanShot',
        theme_color: '#0B1413',
        background_color: '#EFEBE0',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: false,                  // D-17: explicit user reload
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',         // D-15
            options: {
              cacheName: 'supabase-api-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 }, // 5 min TTL
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|avif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 }, // 1 day
            },
          },
        ],
      },
    }),
  ],
});
```

```typescript
// Source: vite-plugin-pwa docs [CITED: docs/frameworks/index.md]
// File: src/lib/pwa/register.ts (lazy-imported from App.tsx after first paint)

import { registerSW } from 'virtual:pwa-register';
import { Capacitor } from '@/lib/native/capacitor-shim'; // D-18

export function initializePWA(onUpdateAvailable: () => void) {
  // D-18: do NOT register inside Capacitor
  if (Capacitor.isNativePlatform()) return;

  const updateSW = registerSW({
    onNeedRefresh: onUpdateAvailable,  // D-17: show toast
    onOfflineReady: () => {/* no-op */},
  });

  return { update: () => updateSW(true) }; // toast Reload button calls this
}
```

### Pattern 4: axe-core Baseline-Tracked CI Gate

**What:** Per-route violation count baseline committed to repo; CI fails ONLY when violation count exceeds baseline (D-09).

**When to use:** Vitest job in CI (the existing `test:unit` step or a new `test:a11y` step).

**Example:**

```typescript
// Source: axe-core API.md [CITED: github.com/dequelabs/axe-core/blob/develop/doc/API.md]
// File: tests/a11y/axe-baseline.test.ts

import { describe, it, expect } from 'vitest';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import baseline from './accessibility-baseline.json';
import { routesManifest } from './routes-manifest';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']; // D-09 WCAG 2.2 AA scope
const BLOCK_SEVERITIES = new Set(['critical', 'serious']);                   // D-10

describe('a11y baseline', () => {
  for (const route of routesManifest) {
    it(`route ${route.path} has ≤ baseline violations`, async () => {
      const dom = await renderRoute(route.path);     // mount React tree into JSDOM
      const result = await axe.run(dom.window.document, {
        runOnly: { type: 'tag', values: WCAG_TAGS },
      });
      const blocking = result.violations.filter((v) => BLOCK_SEVERITIES.has(v.impact));
      const baselineCount = baseline[route.path]?.blocking ?? 0;
      expect(blocking.length, formatViolations(blocking)).toBeLessThanOrEqual(baselineCount);
    });
  }
});
```

```json
// File: tests/a11y/accessibility-baseline.json
// Initial baseline captured by `npm run test:a11y -- --update-baseline`
{
  "/dashboard": { "blocking": 0, "moderate": 2 },
  "/admin": { "blocking": 0, "moderate": 1 },
  "/admin/users": { "blocking": 0, "moderate": 3 },
  "/helpdesk": { "blocking": 0, "moderate": 0 },
  "/clinic/:slug/dashboard": { "blocking": 0, "moderate": 0 },
  "/community/feed": { "blocking": 0, "moderate": 0 },
  "/courses/:slug": { "blocking": 0, "moderate": 0 }
}
```

### Pattern 5: Tailwind v4 Dark-Mode Token Extension

**What:** Existing `data-theme="dark"` attribute on `<html>` (set by `useTheme.applyThemeToDOM`); extend `src/index.css` `@theme` block with dark variants for v1.3 surfaces.

**When to use:** Per-surface dark-mode parity (admin shell, helpdesk, onboarding builder, clinic dashboard, community, courses).

**Example:**

```css
/* Source: existing src/index.css pattern + Tailwind v4 @theme docs [ASSUMED — v4 beta] */
/* File: src/index.css */

@import 'tailwindcss';

@theme {
  --color-surface: #efebe0;
  --color-fg: #0b1413;
  --color-admin-shell-bg: #ffffff;
  --color-helpdesk-msg-bg: #f5f5f0;
  /* ... v1.1/v1.2 tokens already exist */
}

[data-theme='dark'] {
  --color-surface: #0b1413;
  --color-fg: #efebe0;
  --color-admin-shell-bg: #111a19;      /* POLISH-08 v1.3 new */
  --color-helpdesk-msg-bg: #161f1e;     /* POLISH-08 v1.3 new */
  --color-clinic-dashboard-card: #0f1817;
  --color-community-post-bg: #131c1b;
  --color-course-player-bg: #0a1110;
  --color-onboarding-builder-canvas: #0d1615;
}

/* Usage in components: `className="bg-[var(--color-admin-shell-bg)]"` */
/* OR via Tailwind v4 arbitrary value or theme reference. */
```

**Audit approach (Claude's discretion per CONTEXT):** Recommend **manual per-surface review + a Playwright VR snapshot in dark mode for the 6 surfaces** rather than full VR diff. Visual regression on the entire app is brittle; targeted snapshots on a known-good frame per surface are cheaper to maintain.

### Pattern 6: "What's New" Drawer (Admin-Curated Changelog)

**What:** Admin writes markdown changelog entries; users see dot indicator on header avatar when entries published after their `last_seen_published_at`.

**Example:**

```typescript
// Source: project pattern (no external library)
// File: src/components/changelog/WhatsNewDrawer.tsx (uses Sheet primitive)

export function WhatsNewDrawer() {
  const { entries, hasUnread, markRead } = useChangelog();
  // entries: SELECT * FROM changelog_entries WHERE published_at > $lastSeen ORDER BY published_at DESC
  // markRead: UPDATE user_changelog_dismissed SET last_seen_published_at = NOW()

  return (
    <Sheet trigger={<AvatarButton unreadDot={hasUnread} aria-label="What's new" />}>
      <SheetHeader title="What's new" />
      <div>
        {entries.map((e) => (
          <article key={e.slug}>
            <time dateTime={e.published_at}>{formatDate(e.published_at)}</time>
            <h3>{e.title}</h3>
            <Markdown source={e.body_md} sanitize />  {/* react-markdown + dompurify from HELP-07 */}
          </article>
        ))}
      </div>
      <Button onClick={markRead}>Got it</Button>
    </Sheet>
  );
}
```

### Pattern 7: Quarterly NPS pg_cron + Signed Token Response

**What:** First-of-quarter `pg_cron` enqueues Resend campaign; signed query-param tokens let users respond from email without auth.

**Example:**

```sql
-- Source: project pattern [[reference_supabase_pg_cron_vault_service_role_pattern]]
-- File: supabase/migrations/<ts>_quarterly_nps_cron.sql

SELECT cron.schedule(
  'quarterly-nps-enqueue',
  '0 0 1 1,4,7,10 *',           -- D-22: first-of-quarter UTC midnight
  $cron$
    SELECT net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/nps-quarterly-enqueue',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      )
    );
  $cron$
);
```

```typescript
// File: supabase/functions/nps-quarterly-respond/index.ts (Deno)
// Signed token verifies score + user_id without auth — token = HMAC(score || user_id || quarter)

import { createHmac, timingSafeEqual } from 'node:crypto';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const score = Number(url.searchParams.get('score'));
  const token = url.searchParams.get('token');
  // verify HMAC; on success: INSERT INTO quarterly_nps_responses (user_id, quarter, score, responded_via, responded_at)
  // serve open-text follow-up page
});
```

### Anti-Patterns to Avoid

- **Client-side fire decision.** Always server-side; client can't be trusted with cap enforcement.
- **Calling `Notification.requestPermission()` on page load.** Browsers penalize this (Chrome blocks abusive permission prompts). Only inside an explicit user gesture in `/settings/notifications`.
- **Caching authenticated Supabase API responses without per-user keying.** Workbox runtime cache shares across users in a shared PWA install context — DO NOT cache `Authorization`-bearing responses by URL alone unless URL includes user-discriminator. Safer: cache only public reads.
- **Putting `vite-plugin-pwa` register call in `main.tsx`.** Adds to index chunk. Lazy-import after first paint per D-15.
- **Treating `data-theme="dark"` + `prefers-color-scheme: dark` as interchangeable.** They aren't — user override stored in `localStorage` per existing `useTheme.ts` is authoritative.
- **Auto-generating "What's New" entries from git log.** Noisy + leaks internal commits. Admin-curated only (CONTEXT explicit).
- **Sharing `quarterly_nps_responses` table with P36 `review_responses`.** Different instruments per D-19; planner must not coalesce schemas.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service worker + manifest + precache | Custom Workbox config + `register()` call | `vite-plugin-pwa` | Handles Vite asset-hashing integration, `virtual:pwa-register` lifecycle, dev-mode SW, asset injection. 200+ lines vs 20 |
| Accessibility rule engine | Custom DOM walker checking ARIA | `axe-core` | 100+ rules, WCAG-tagged, maintained by Deque (industry standard); custom rules will miss 80% of real violations `[CITED: axe-core API.md]` |
| Web-push VAPID JWT signing | Custom ECDSA P-256 signer + AES-GCM payload encryption | `web-push` library | RFC 8030 (Web Push Protocol) + RFC 8291 (Message Encryption) are easy to mis-implement; library handles ECDH key agreement |
| Markdown rendering for "What's New" / NPS verbatim follow-up | Custom regex-to-HTML | `react-markdown` + `dompurify` | Already in stack (HELP-07); XSS protection critical for admin-pasted content |
| Per-route a11y scan harness | Hand-rolled JSDOM mount + axe glue | `@axe-core/react` for dev + `axe-core` direct for CI | The React adapter handles Fiber-tree → DOM-node mapping, suppresses re-scans on render churn |
| PNG/SVG icon resizing | Manual export from Figma → 5 sizes | `@vite-pwa/assets-generator` | One source → all PWA manifest icons + Apple touch icon + favicon |
| Email send to user | `fetch('https://api.resend.com/...')` | `_shared/email-router.ts` (P25 D-03) | PHI routing logic + retry + audit log already implemented |
| pg_cron + service_role auth | Hand-rolled GUC | `vault.decrypted_secrets` + hardcoded URL | Documented project rule [[reference_supabase_pg_cron_vault_service_role_pattern]] |

**Key insight:** Phase 42's six workstreams are each individually well-trodden domains with canonical libraries. The risk is integration friction (PWA + Capacitor, axe + dynamic React content, dismissal-rate state machine), not novel algorithms. Lean on libraries; spend complexity budget on the LeanShot-specific glue.

## Runtime State Inventory

**Not applicable** — Phase 42 is greenfield additions (new tables, new files, new SW). No rename/refactor of existing identifiers. Verified by reviewing the 7 REQ-IDs (all `[ ]`-pending) and the canonical_refs in CONTEXT.md — every reference is either NEW (new tables) or EXTEND-by-addition (notification subtab, dark-mode token additions, ESLint rule extension to cover new code path, eslint extension by adding a literal). No identifiers are being renamed.

## Common Pitfalls

### Pitfall 1: Service worker caches stale authenticated API responses

**What goes wrong:** Workbox `NetworkFirst` for Supabase API caches the response keyed by URL — when User B logs in on the same PWA install (or User A's session refreshes a JWT), they may see User A's cached data. PHI implications.

**Why it happens:** Default Workbox cache is global per `cacheName`; `Authorization` header is part of the request but NOT part of the cache key.

**How to avoid:** Either (a) only cache anonymous / public reads (e.g., `kb_articles WHERE public=true`), OR (b) include a user discriminator in the URL (e.g., `?u={jwt-sub}`), OR (c) use a `plugins: [{ cacheKeyWillBeUsed }]` Workbox plugin to namespace cache keys by Authorization header hash. Safest for v1.3 + HIPAA posture: only cache assets + truly public endpoints; let user-scoped API hit network (with explicit offline banner).

**Warning signs:** Cross-user data appearance in offline mode; HIPAA audit flag; `cache-control` header on Supabase API not respected.

`[VERIFIED: Workbox runtime caching default — github.com/vite-pwa/vite-plugin-pwa generate-sw.md confirms cache keys are URL-based; namespace pattern documented in workbox-strategies.]`

### Pitfall 2: PWA install prompt suppressed forever after user dismissal

**What goes wrong:** Browser fires `beforeinstallprompt` ONCE per page load. If you call `.prompt()` and user picks "no", you don't get another event without a fresh engagement signal. Storing a localStorage `installed=true` mark after user clicks "Maybe later" effectively suppresses the prompt forever even though they may want it later.

**Why it happens:** `beforeinstallprompt` is browser-fired based on heuristics; we can't trigger it on demand.

**How to avoid:** Distinguish three states: (1) installed (system reports `appinstalled`); (2) snoozed (user picked "Maybe later" + timestamp; re-show after 30d per D-16); (3) actively dismissed (user picked "no" in native prompt; respect for longer e.g. 90d). Don't write `installed=true` until `window.matchMedia('(display-mode: standalone)').matches` returns true.

**Warning signs:** Install rate flatlines after week 1 even though new users still see beforeinstallprompt; users complain "I can't install".

`[ASSUMED — based on web.dev documentation of install criteria and beforeinstallprompt semantics]`

### Pitfall 3: Web-Push permission asked too eagerly

**What goes wrong:** Calling `Notification.requestPermission()` on page load or right after signup triggers Chrome's "abusive permission prompt" heuristic. The browser blocks future prompts for the origin. Worse: Chrome may show a "blocked notifications" badge in the URL bar permanently.

**Why it happens:** Browsers penalize sites that ask for permissions without user context.

**How to avoid:** Only call `requestPermission()` from inside a click handler on a button labeled clearly ("Enable push notifications" inside `/settings/notifications`). Show user-friendly pre-prompt explaining value first; let them opt in to the prompt itself.

**Warning signs:** "Notifications: blocked" appears for many users in DevTools; PostHog shows `notification_permission_denied` rate >40%.

`[VERIFIED: Chrome quiet permission UI — chromestatus.com + Chrome documentation]`

### Pitfall 4: Frequency caps don't account for clock skew / timezones

**What goes wrong:** "Max 3 per day" measured in UTC dumps users at boundary times. A West-Coast user might get 3 notifications between 5pm-midnight then 3 more at 12:01am.

**Why it happens:** Caps measured against UTC-day; user perceives caps against their wall clock.

**How to avoid:** Store user timezone (already in `profiles` per CLAUDE.md tz convention); compute "day" boundary in user's timezone. Cron-windowed counts use `AT TIME ZONE profiles.timezone` in SQL.

**Warning signs:** Notification-fatigue complaints concentrated in specific timezone offsets; dismissal-rate spikes on UTC-day boundaries.

`[ASSUMED — common pitfall in cap-enforcement systems; project already stores timezone per GAME-02]`

### Pitfall 5: vite-plugin-pwa breaks Vite dev server

**What goes wrong:** Default dev-time SW registration can confuse HMR (service worker caches old chunks; HMR-refresh shows stale JS).

**Why it happens:** SW intercepts module requests; dev server expects to serve fresh modules.

**How to avoid:** Set `devOptions: { enabled: false }` (default) for dev. Test PWA via `npm run build && npm run preview`. If you must dev-test SW, `devOptions: { enabled: true, type: 'module' }` is supported but expect HMR weirdness.

**Warning signs:** Developer reports "my changes don't show up" after vite-plugin-pwa is added.

`[CITED: vite-plugin-pwa docs — devOptions guidance]`

### Pitfall 6: axe-core in jsdom misses focus management bugs

**What goes wrong:** Tab order, focus traps in modals, and `aria-live` announcements depend on real browser focus behavior that jsdom doesn't fully simulate. axe will report 0 violations while a screen reader user is trapped.

**Why it happens:** jsdom is a static DOM; focus events / `document.activeElement` semantics are limited.

**How to avoid:** Pair axe-core (jsdom) with VoiceOver HUMAN-UAT (D-11) AND opt-in @axe-core/playwright for routes with modals/focus traps (D-12). The opt-in routes list should include: signup flow, dose log modal, NPS modal, settings drawer, "What's New" drawer.

**Warning signs:** axe-core CI green but VoiceOver UAT finds focus-trap bugs.

`[VERIFIED: axe-core API.md describes scan-time DOM limitations; common knowledge in a11y community]`

### Pitfall 7: Tailwind v4 beta `[data-theme='dark']` specificity collision

**What goes wrong:** Tailwind v4 beta's default dark variant is `prefers-color-scheme: dark`. Combining with `[data-theme='dark']` (project pattern) can cause specificity conflicts where utility classes with `dark:` prefix work but custom var-overrides via `[data-theme]` selector don't.

**Why it happens:** Tailwind v4's CSS-first config + `@variant` system differs from v3.

**How to avoid:** Configure Tailwind v4's dark variant to use the attribute selector: `@variant dark (&:where([data-theme='dark'], [data-theme='dark'] *))` in `index.css`. Verify after adding any new dark-mode token that BOTH `dark:bg-{token}` utility AND `[data-theme='dark'] { --color-{token}: ... }` work.

**Warning signs:** Dark mode "mostly works" but specific components revert to light mode tokens; CSS computed-style debugging in DevTools shows custom prop is the light value.

`[ASSUMED — Tailwind v4 beta still evolving; verify against current beta release]`

### Pitfall 8: `pg_cron` `$$`-quoting collision with `cron.schedule`

**What goes wrong:** `cron.schedule('job', '...', $$ DO $$ DECLARE ... $$ $$)` silently closes the outer dollar-quote at the first inner `$$`, throwing "syntax error at or near DECLARE".

**Why it happens:** Postgres dollar-quoting is non-nesting by default.

**How to avoid:** Use named tags for nested quotes: `cron.schedule(..., $cron$ DO $inner$ ... $inner$; $cron$)`.

**Warning signs:** Migration push errors with "syntax error at or near" near a cron body containing PL/pgSQL.

`[VERIFIED — memory pointer [[reference_postgres_dollar_quote_nesting_in_cron_body]]]`

### Pitfall 9: Service worker registration leaks into index chunk

**What goes wrong:** Static-importing `virtual:pwa-register` from `main.tsx` adds Workbox glue to the index chunk; pushes index over 50 kB gz ceiling (project hard rule).

**Why it happens:** Static imports are bundled into the entry chunk.

**How to avoid:** Lazy-import after first paint: in `App.tsx` `useEffect`, dynamically `import('@/lib/pwa/register').then(({ initializePWA }) => initializePWA(toast))`. Verify via `npm run build` + bundle-size script.

**Warning signs:** `npm run check-bundle-budget` fails after adding PWA; bundle analyzer shows `workbox-*` in index chunk.

`[VERIFIED — project memory `feedback_planner_iter1_anti_patterns` + bundle-budget script pattern; supported by Vite's static-import bundling behavior]`

### Pitfall 10: Baseline-tracked a11y gate gets stale

**What goes wrong:** Baseline lets pre-existing violations through; over time the baseline calcifies, masking regressions in long-standing components.

**Why it happens:** No expiry / re-baseline pressure.

**How to avoid:** Document a quarterly "baseline review" cadence: every quarter, attempt to reduce baseline counts by ≥1 per route. CI prints baseline-vs-current diff in PR comment to surface "you could lower this".

**Warning signs:** Baseline counts haven't changed in 6 months despite refactors.

`[ASSUMED — common debt-baseline anti-pattern; mirrors `project_lint_debt_import_x_order` baseline approach]`

### Pitfall 11: Quarterly NPS signed-token URL leak

**What goes wrong:** User forwards their NPS email (e.g., to a friend, or it's caught by a corporate email scanner that follows links). The token + score is processed as that user's response.

**Why it happens:** HMAC-signed query params are bearer tokens; anyone who has the URL can submit.

**How to avoid:** (a) Single-use enforcement: `quarterly_nps_responses` UNIQUE on `(user_id, quarter)` — first response wins; second submission with same token returns "already responded". (b) Token includes quarter + nonce; nonce stored server-side and invalidated on use. (c) For follow-up open-text: require login on the follow-up form, OR carry the nonce into the follow-up POST.

**Warning signs:** Same user shows two response rows for same quarter; corporate-email-scanner UA strings in response logs.

`[ASSUMED — standard URL-token security threat model]`

## Code Examples

### Notification fire decision with cap + sentiment + snooze

See **Pattern 2** above.

### vite.config.ts VitePWA block

See **Pattern 3** above.

### axe-core baseline diff test

See **Pattern 4** above.

### Dark-mode token extension

See **Pattern 5** above.

### Quarterly NPS pg_cron + signed token

See **Pattern 7** above.

### Service worker update toast

```typescript
// Source: vite-plugin-pwa docs [CITED: docs/guide/auto-update.md]
// File: src/App.tsx (lazy-init after first paint)

useEffect(() => {
  import('@/lib/pwa/register').then(({ initializePWA }) => {
    initializePWA(() => {
      showToast({
        title: 'New version available',
        action: { label: 'Reload', onClick: () => window.location.reload() },
        persist: true,  // D-17: persists across nav until clicked
      });
    });
  });
}, []);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `workbox-cli` + custom manifest generation | `vite-plugin-pwa` with `generateSW` | ~2022 | Vite-native; Workbox abstracted; manifest auto-generated |
| Per-route `cy.injectAxe()` + `cy.checkA11y()` (Cypress) | `axe-core` in Node + jsdom + baseline.json | This phase choice | 5-10× faster CI; baseline pattern prevents merge-blocking on legacy debt |
| `next-pwa` (Next.js) / hand-rolled SW for SPAs | `vite-plugin-pwa` | 2022+ | Project on Vite; only relevant for migration discussion |
| `notification.requestPermission()` on page load | Permission inside explicit user gesture in settings | ~2020 (Chrome quiet UI) | Avoids browser permission-block penalty |
| Self-hosted NPS with bespoke schema | Sometimes Delighted/Wootric (vendor) | varies | User locked D-19 to self-hosted to avoid vendor BAA chain |
| Tailwind v3 `darkMode: 'class'` | Tailwind v4 `@variant dark (...)` + `@theme` | 2024+ | v4 still beta; project already on v4 beta |

**Deprecated/outdated:**

- `pgsodium` for secret encryption (per memory `reference_phase7_research_findings`) — use `vault` instead. Quarterly NPS cron pattern uses vault (D-22).
- `workbox.precaching.precache()` direct API — replaced by `precacheAndRoute(self.__WB_MANIFEST)` in generateSW mode (vite-plugin-pwa handles).
- `Notification.permission === 'default'` polling — use `permissions.query({ name: 'notifications' })` for change-event subscription.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `vite-plugin-pwa` generateSW mode integrates cleanly with existing Vite 6 + Tailwind v4 beta plugin order | Standard Stack, Pattern 3 | LOW — plugin is framework-agnostic; build will error loudly if conflict |
| A2 | Tailwind v4 beta's `@variant` + attribute-selector dark mode works with the project's `[data-theme='dark']` pattern | Pattern 5, Pitfall 7 | MEDIUM — v4 beta API can shift; planner should pin Tailwind v4 version + verify in a small test before fanout |
| A3 | PWA install rate uplift from custom-branded prompts vs default browser UI is "significant" (CONTEXT D-16 specifics) | (referenced from CONTEXT) | LOW — even without uplift, the deferred timing avoids early-user friction |
| A4 | jsdom + axe-core completes "~30s for all routes" (D-10 claim) | Architecture Pattern 4 | LOW — depends on route count; if exceeded, opt routes into Playwright fallback per D-12 |
| A5 | `web-push@3.6.7` works in Supabase Edge Functions (Deno) via `npm:` specifier | Standard Stack | MEDIUM — Edge Fn Deno runtime mostly supports npm: but VAPID ECDSA crypto may need polyfill check; planner should spike before commit |
| A6 | `prefers-color-scheme: dark` and `[data-theme='dark']` can coexist in Tailwind v4 without specificity bug | Pitfall 7 | MEDIUM — v4 beta dark-variant config differs per minor release |
| A7 | Workbox `NetworkFirst` 3-second `networkTimeoutSeconds` is a reasonable default for Supabase API | Pattern 3 | LOW — adjustable; affects only offline-fallback latency |
| A8 | "What's New" entries fit under per-chunk ceiling (the drawer + markdown render stays out of index) | Project Structure | LOW — lazy-load drawer per project bundle pattern |
| A9 | Baseline-tracked a11y CI integrates with existing `npm run test:unit` step | Validation Architecture | LOW — vitest config straightforward to extend; if not, add `test:a11y` script |
| A10 | `notification_settings` UNIQUE constraint `(user_id, category, channel)` is the right shape (vs `(user_id, category)` with channel array column) | Pattern 1 implicit | LOW — row-per-combo simpler for RLS + admin debugging; matches CONTEXT D-01 |
| A11 | The "active in last 90d" eligibility for quarterly NPS (D-23) can be computed at cron-time from a single existing activity signal | Pattern 7 | LOW — `xp_ledger` or `user_notifications.fired_at` or `auth.users.last_sign_in_at` all viable |
| A12 | `react-markdown` + `dompurify` are already in stack via HELP-07 path | Don't Hand-Roll | MEDIUM — verify Phase 37 shipped these deps before Phase 42 plans assume reuse; if not, Phase 42 picks them up |

## Open Questions

1. **`@axe-core/playwright` opt-in route list final**
   - What we know: D-12 says opt-in per planner; logical candidates are modal-bearing flows.
   - What's unclear: exact route list (signup, NPS modal, settings drawer, "What's New", clinic invite, others?).
   - Recommendation: Plan lists ~5-6 routes; verifier confirms post-execution.

2. **`web-push` Deno compatibility in Supabase Edge Functions**
   - What we know: Edge Functions support `npm:` specifiers; `web-push` is Node-targeted.
   - What's unclear: whether ECDSA P-256 VAPID signing works without polyfill; whether `applicationServerKey` formatting matches Deno's crypto interface.
   - Recommendation: Spike a "hello world" web-push send in an Edge Fn before P42 W1 dispatch; if blocked, fall back to hand-rolled VAPID via Deno's `crypto.subtle` (only one signing operation; manageable).

3. **Tailwind v4 beta version pin**
   - What we know: project on `^4.0.0-beta.7`; v4 spec is still mutating.
   - What's unclear: which beta to pin for stable `@variant dark` syntax.
   - Recommendation: Pin to current `^4.0.0-beta.7` in Phase 42; document upgrade path. Test the dark-variant config on one v1.3 surface before fanout.

4. **Dark-mode parity audit approach**
   - What we know: planner's discretion per CONTEXT.
   - What's unclear: Playwright VR diff vs manual review.
   - Recommendation: 6 targeted Playwright VR snapshots (one per v1.3 surface, light + dark) — 12 total. Quarterly re-snapshot. Less brittle than full-page VR; catches token regressions.

5. **Quarterly NPS-vs-P36 user-perception risk**
   - What we know: Two NPS instruments per D-19; both can fire on the same user.
   - What's unclear: User may perceive as "asked again" → low response rate.
   - Recommendation: Distinct subject lines, email-first for quarterly (D-21) vs in-app for P36; copy emphasizes "quarterly check-in" vs P36's event-triggered framing. Monitor combined dismissal rate per user post-launch.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All build / test / CI | ✓ | v22.18.0 (CLAUDE.md) | — |
| npm | Package install | ✓ | bundled | — |
| Vite 6 | PWA plugin host | ✓ | 6.0.1 | — |
| TypeScript 5.6 | Strict typecheck | ✓ | ~5.6.3 | — |
| Vitest 4 | a11y baseline test runner | ✓ | ^4.1.5 | — |
| Playwright | e2e + optional @axe-core/playwright | ✓ | already installed (e2e dir exists) | — |
| Supabase project (linked) | Migrations + Edge Fns | ✓ | project ref `ytnsipxxmzgaebkqmokp` (CLAUDE.md) | — |
| Resend account + API key | Email send (quarterly NPS, notifications) | ✓ | already wired via `_shared/email-router.ts` (P25) | — |
| AWS SES BAA path | PHI clinic-alerts email | ✓ | already wired via `_shared/email-router.ts` (P25 D-03) | — |
| `pg_cron` extension | Quarterly enqueue cron | ✓ | already used in P14/P33/P30 | — |
| `vault` extension | service_role secret for cron | ✓ | already used in pattern | — |
| VAPID keypair | Web-push signing | ✗ | — | **HUMAN-UAT required** — generate via `npx web-push generate-vapid-keys` + Supabase Function Secret `VAPID_PRIVATE_KEY` + `VAPID_PUBLIC_KEY` |
| PWA assets (192/512 png, apple-touch) | manifest | ✗ | — | Generate via `@vite-pwa/assets-generator` at build (one-off) |

**Missing dependencies with no fallback:**
- None blocking; VAPID keys are HUMAN-UAT-gated but generation is trivial.

**Missing dependencies with fallback:**
- VAPID keys → planner adds HUMAN-UAT checkpoint with `npx web-push generate-vapid-keys` + Supabase secret upload steps.
- PWA icons → generate from existing logo via `@vite-pwa/assets-generator`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.5 + Playwright (e2e) |
| Config file | `vitest-e2e.config.ts` (RLS), `playwright.config.ts`, will add `vitest.config.ts` for a11y |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test` (vitest run && playwright test) |
| Bundle gate | `npm run check-bundle-budget` |
| Typecheck | `npm run typecheck` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POLISH-05 | Frequency cap enforcement (3/day for ai-insights) | integration | `vitest run tests/integration/notification-frequency-cap.test.ts` | ❌ Wave 0 |
| POLISH-05 | Dismissal-rate halves cap | integration | `vitest run tests/integration/notification-sentiment-throttle.test.ts` | ❌ Wave 0 |
| POLISH-05 | Snooze respected (1d/7d/30d) | integration | `vitest run tests/integration/notification-snooze.test.ts` | ❌ Wave 0 |
| POLISH-05 | URGENT escalation for clinic-alerts | integration | `vitest run tests/integration/notification-urgent.test.ts` | ❌ Wave 0 |
| POLISH-05 | Cross-tenant proof for notification_settings | RLS | `vitest run --config vitest-e2e.config.ts tests/rls/notification-settings-rls.test.ts` | ❌ Wave 0 |
| POLISH-06 | Settings center matrix renders + writes | unit (RTL) | `vitest run src/components/dashboard/settings/NotificationsSubtab.test.tsx` | ❌ Wave 0 |
| POLISH-06 | Cap user-downward enforcement (cannot raise) | integration | `vitest run tests/integration/notification-user-cap-downward.test.ts` | ❌ Wave 0 |
| POLISH-07 | Service worker registers + caches assets | e2e | `playwright test e2e/pwa-offline.spec.ts` | ❌ Wave 0 |
| POLISH-07 | Offline banner appears + logging disabled | e2e | `playwright test e2e/pwa-offline.spec.ts -g "logging disabled"` | ❌ Wave 0 |
| POLISH-07 | Install prompt deferred to 3rd visit | e2e | `playwright test e2e/pwa-install-prompt.spec.ts` | ❌ Wave 0 |
| POLISH-07 | SW disabled inside Capacitor | unit | `vitest run src/lib/pwa/register.test.ts` | ❌ Wave 0 |
| POLISH-08 | Dark mode VR snapshots per surface | e2e (visual) | `playwright test e2e/visual/dark-mode.spec.ts --project=mobile` | ❌ Wave 0 |
| POLISH-08 | Contrast ratios on v1.3 surfaces | unit (axe rule) | (covered by POLISH-09) | reuses POLISH-09 |
| POLISH-09 | Baseline-tracked a11y on every route | integration | `vitest run tests/a11y/axe-baseline.test.ts` | ❌ Wave 0 |
| POLISH-09 | Critical+Serious block on NEW violations | integration | (assertion inside axe-baseline.test.ts) | reuses above |
| POLISH-09 | VoiceOver UAT on top-5 flows | HUMAN-UAT | manual checklist in PLAN | not automated (D-11) |
| POLISH-11 | What's New dot indicator + drawer dismissal | unit (RTL) | `vitest run src/components/changelog/WhatsNewDrawer.test.tsx` | ❌ Wave 0 |
| POLISH-11 | RLS: user only sees their dismissal row | RLS | `vitest run --config vitest-e2e.config.ts tests/rls/changelog-rls.test.ts` | ❌ Wave 0 |
| POLISH-12 | Quarterly cron fires on Jan/Apr/Jul/Oct 1 | integration | `vitest run tests/integration/quarterly-nps-cron.test.ts` | ❌ Wave 0 |
| POLISH-12 | Signed-token response single-use | integration | `vitest run tests/integration/quarterly-nps-respond.test.ts` | ❌ Wave 0 |
| POLISH-12 | In-app fallback after 30d non-response | integration | `vitest run tests/integration/quarterly-nps-fallback.test.ts` | ❌ Wave 0 |
| POLISH-12 | Admin dashboard surfaces score + trend + verbatim | unit (RTL) | `vitest run src/components/admin/QuarterlyNPSDashboard.test.tsx` | ❌ Wave 0 |
| POLISH-12 | Cross-tenant proof for quarterly_nps_responses | RLS | `vitest run --config vitest-e2e.config.ts tests/rls/quarterly-nps-rls.test.ts` | ❌ Wave 0 |
| POLISH-* | Bundle budget (per-chunk ceilings) | shell | `npm run check-bundle-budget` | ✓ exists |
| POLISH-* | TypeScript strict | shell | `npm run typecheck` | ✓ exists |
| POLISH-* | Lint extends D-20 (no-conditional-native-review) | unit | `vitest run eslint-rules/no-conditional-native-review.test.cjs` | ✓ exists; extend |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run lint && vitest run <touched-files>`
- **Per wave merge:** `npm run test:unit && npm run check-bundle-budget`
- **Phase gate:** Full suite green (`npm run test`) + `npm run check-bundle-budget` + axe baseline diff = 0 increases + VoiceOver UAT checklist signed

### Wave 0 Gaps

- [ ] `tests/a11y/axe-baseline.test.ts` — covers POLISH-09 (Wave 0 init script populates baseline)
- [ ] `tests/a11y/accessibility-baseline.json` — populated by `npm run test:a11y -- --update-baseline` on Wave 0
- [ ] `tests/a11y/routes-manifest.ts` — enumerate all v1.1 + v1.2 + v1.3 routes
- [ ] `tests/integration/notification-frequency-cap.test.ts`
- [ ] `tests/integration/notification-sentiment-throttle.test.ts`
- [ ] `tests/integration/notification-snooze.test.ts`
- [ ] `tests/integration/notification-urgent.test.ts`
- [ ] `tests/integration/notification-user-cap-downward.test.ts`
- [ ] `tests/rls/notification-settings-rls.test.ts` (use P22 fixture pattern)
- [ ] `tests/rls/changelog-rls.test.ts`
- [ ] `tests/rls/quarterly-nps-rls.test.ts`
- [ ] `tests/integration/quarterly-nps-cron.test.ts`
- [ ] `tests/integration/quarterly-nps-respond.test.ts` (signed-token single-use)
- [ ] `tests/integration/quarterly-nps-fallback.test.ts`
- [ ] `e2e/pwa-offline.spec.ts`
- [ ] `e2e/pwa-install-prompt.spec.ts`
- [ ] `e2e/visual/dark-mode.spec.ts` — 6 surfaces × {light, dark}
- [ ] `eslint-rules/no-conditional-native-review.test.cjs` — extend to assert it catches quarterly NPS surfacing

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Quarterly NPS signed-token responses are explicitly unauth — control: HMAC + single-use + nonce; for in-app fallback uses existing Supabase Auth session |
| V3 Session Management | yes | Existing Supabase session for /settings/notifications and admin dashboards; PWA install does not create separate session |
| V4 Access Control | yes | RLS on all new tables (`notification_settings`, `user_notifications`, `notification_category_config` admin-only write, `changelog_entries` admin-only write, `quarterly_nps_responses` user-can-only-insert-own); cross-tenant proof tests required (project rule) |
| V5 Input Validation | yes | zod schemas on Edge Fn inputs (notification-send, push-subscribe, quarterly-nps-respond); markdown rendered with dompurify for "What's New" + NPS verbatim |
| V6 Cryptography | yes | VAPID ECDSA P-256 via `web-push` library; HMAC for NPS signed tokens via Node `crypto` |
| V7 Error handling & logging | yes | TAXO event registry (`notification_sent`, `notification_dismissed`, `notification_clicked`, `notification_snoozed`, `nps_quarterly_sent`, `nps_quarterly_responded`) |
| V9 Communications | yes | Supabase API over HTTPS; web-push over HTTPS; FCM/APNS TLS |
| V12 Files & Resources | yes | PWA precache excludes PHI body content per HIPAA posture |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SW caches PHI cross-user | Information Disclosure | Don't cache authenticated API responses; or namespace cache by user JWT (see Pitfall 1) |
| Notification permission abuse (eager prompt) | Repudiation (browser blocks future prompts) | Permission only inside explicit user gesture (Pitfall 3) |
| NPS signed-token replay / sharing | Spoofing | Single-use enforcement via UNIQUE(user_id, quarter); nonce store + invalidate (Pitfall 11) |
| Service worker caches expired auth tokens | Tampering | Workbox cache excludes Authorization-bearing requests; or short TTL |
| Admin writes XSS in changelog markdown | Injection | dompurify + react-markdown (Don't Hand-Roll) |
| Admin can raise user's notification cap above default | Elevation of Privilege | UI gate + server check: user-tunable caps clamp DOWNWARD only (D-04); admin sets defaults via separate admin table |
| Push subscription leaks identifying endpoint | Information Disclosure | Push endpoint is a high-entropy URL; treat as low-PII; do not log to client-side analytics |
| Cross-tenant read of clinic-alerts notifications | Information Disclosure | RLS on `user_notifications`; cross-tenant proof test |
| PWA install on shared device | Information Disclosure | Standard PWA caveat; documented in privacy policy; user can clear via app uninstall |
| axe-core baseline gamed by deleting test | Tampering | CI checks baseline.json exists + non-empty; PR review surface |

## Sources

### Primary (HIGH confidence)

- `[Context7] /vite-pwa/vite-plugin-pwa` — registerType, workbox runtimeCaching, autoUpdate, SKIP_WAITING (verified 2026-05-19)
- `[Context7] /dequelabs/axe-core` — WCAG tag list (`wcag22aa`, `wcag21aa`, ...), API.md (verified 2026-05-19)
- `[npm registry]` — all package versions verified via `npm view <pkg> version` (2026-05-19): vite-plugin-pwa 1.3.0, axe-core 4.11.4, @axe-core/react 4.11.3, @axe-core/playwright 4.11.3, web-push 3.6.7, workbox-window 7.4.1, @vite-pwa/assets-generator 1.0.2, resend 6.12.3
- `https://vite-pwa-org.netlify.app/guide/auto-update.html` — registerType: 'autoUpdate' semantics
- `https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/workbox/generate-sw.md` — runtimeCaching strategies
- `https://github.com/dequelabs/axe-core/blob/develop/doc/API.md` — tag taxonomy
- `.planning/codebase/STACK.md` — Vite/Tailwind v4/Zustand stack
- `./CLAUDE.md` — project constraints (local-first, bundle ceilings, a11y as constraint)
- `./.planning/phases/42-v1-3-polish-closeout/42-CONTEXT.md` — 24 locked decisions
- `./.planning/REQUIREMENTS.md` lines 236–243 — POLISH-05..12 requirements verbatim

### Secondary (MEDIUM confidence)

- Memory pointers (project-internal patterns): `reference_supabase_pg_cron_vault_service_role_pattern`, `reference_postgres_dollar_quote_nesting_in_cron_body`, `feedback_planner_iter1_anti_patterns`, `feedback_scaffolding_for_deferred_mobile_pattern`, `reference_supabase_migration_filename_regex`
- Phase 22, 25, 27, 33, 36 CONTEXT.md (load-bearing prior-phase decisions cited in CONTEXT)

### Tertiary (LOW confidence)

- General PWA install-rate uplift claims for branded prompts (not verified against current research; CONTEXT decision already locked regardless)
- Tailwind v4 beta `@variant` precise syntax (beta API; verify against current beta release before fanout)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every package + version verified against npm registry; library choices match canonical patterns confirmed by Context7
- Architecture: HIGH — patterns match project conventions (server-side fire decisions, Supabase Realtime for in-app, vault pattern for cron, baseline-track-then-block CI gate)
- Pitfalls: MEDIUM — Pitfalls 1, 3, 5, 6, 8, 9 verified against docs / project memory; Pitfalls 2, 4, 7, 10, 11 informed by domain experience and tagged ASSUMED in Assumptions Log

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (30 days for stable PWA / a11y stack; re-verify Tailwind v4 beta API + Supabase Edge Fn `web-push` Deno compat before plan dispatch)

---

## RESEARCH COMPLETE — Return Payload

```json
{
  "research_areas_count": 6,
  "tools_recommended": [
    "vite-plugin-pwa@^1.3.0",
    "workbox-window@^7.4.1",
    "axe-core@^4.11.4",
    "@axe-core/react@^4.11.3",
    "@axe-core/playwright@^4.11.3 (opt-in)",
    "web-push@^3.6.7",
    "@vite-pwa/assets-generator@^1.0.2",
    "resend@^6.12.3 (already in stack via _shared/email-router.ts)"
  ],
  "pitfalls_count": 11,
  "files_modified": [
    ".planning/phases/42-v1-3-polish-closeout/42-RESEARCH.md"
  ]
}
```
