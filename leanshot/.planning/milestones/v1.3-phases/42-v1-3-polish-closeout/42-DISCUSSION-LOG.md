# Phase 42 — Discussion Log

**Date:** 2026-05-19
**Phase:** 42 — v1.3 Polish Closeout
**Mode:** discuss (default; batched)

---

## Gray-area selection

ALL 4 — Smart notifications · WCAG audit · PWA + offline · Quarterly NPS

Dark mode (POLISH-08) + What's New drawer (POLISH-11) deferred to Claude's discretion (engineering execution; established patterns).

---

## Area 1: Smart notifications (POLISH-05/06)

- Per-channel routing → **Sensible defaults: dose=push+email; AI=in-app+push; clinic=email+push (URGENT); billing=email; marketing=email-only** → D-02
- Frequency capping → **Per-category daily caps; dose+clinic UNCAPPED (clinical safety); AI=3/day; billing+marketing=1/week** → D-04
- Sentiment + snooze → **Dismissal-rate sentiment (NOT Claude); per-category snooze 1d/7d/30d** → D-05 + D-06

D-03 URGENT escalation for clinic-alerts (Web Push urgency=high); D-07 settings center; D-08 email via _shared/email-router.ts.

---

## Area 2: WCAG 2.2 AA scope + axe-core CI gate (POLISH-09)

- Route scan scope → **Every route (v1.1+v1.2+v1.3) with baseline tracking; block on NEW only** → D-09
- Severity + integration → **Block Critical+Serious; warn Moderate; ignore Minor. Pure Node axe-core (jsdom)** → D-10
- Manual SR testing → **VoiceOver on top-5 v1.3 flows; HUMAN-UAT in PLAN.md** → D-11

D-12 CI integration via @axe-core/react; Playwright NOT used.

---

## Area 3: PWA + offline (POLISH-07)

- Offline scope → **Read-only (view existing data; logging DISABLED with banner)** → D-13
- Install prompt → **Custom deferred prompt; branded card after 3rd dashboard visit** → D-16
- SW update UX → **Non-blocking toast with Reload button** → D-17

D-14 share-link viewing offline NOT supported; D-15 vite-plugin-pwa generateSW + workbox; D-18 PWA+Capacitor coexistence (Capacitor.isNativePlatform check).

---

## Area 4: Quarterly NPS + interaction with P36 (POLISH-12)

- Instrument scope → **SEPARATE: dedicated quarterly_nps_responses schema; no P36 cooldown/cap sharing** → D-19
- Delivery channel → **Email-first via Resend + in-app fallback if user logs in within 30d** → D-21
- Segmentation + dashboard → **Tenure + plan + cohort breakdown; verbatim responses paginated** → D-24

D-20 V13-3 BLOCKER lint extends to quarterly NPS; D-22 pg_cron quarterly (first-of-quarter UTC); D-23 active-in-90d eligibility.

---

## Claude's discretion captured

- POLISH-08 dark mode parity (audit + extend data-theme tokens for v1.3 surfaces)
- POLISH-11 What's New drawer (admin-curated changelog_entries + per-user dismissal)
- Push notification web-push VAPID setup (vendor-gated HUMAN-UAT)
- Notification rendering pipeline (Supabase Realtime + Toast component)

## Out-of-scope items raised

- Offline log-with-sync-queue (v1.4)
- Claude sentiment scoring for notifications (v1.4)
- Claude theme-clustering on NPS verbatim (v1.4)
- Contracted a11y audit (v1.5 enterprise)
- v1.1/v1.2 pre-existing a11y fix-all (future polish-debt phase)
- Rich web-push (action buttons, images) (v1.4)
- Silent SW update (v1.4)
- Per-feature-usage NPS segmentation (v1.4)
