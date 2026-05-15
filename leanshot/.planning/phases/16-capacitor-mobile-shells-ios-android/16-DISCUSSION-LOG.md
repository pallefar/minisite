# Phase 16 — Discussion Log

**Date:** 2026-05-15
**Mode:** default (interactive AskUserQuestion)
**Areas discussed:** 6 (RevenueCat tier + reconciliation; Capacitor 8 plugins + biometric; Universal Links + bundle ID; Build pipeline + release cadence; Privacy Manifest + ASO assets; Cross-platform tier sync)
**Decisions captured:** 25 (D-01 through D-25)

---

## Area 1: RevenueCat tier model + reconciliation

**Q1.1 — RevenueCat product structure** → "1 RevenueCat entitlement, 2 products (Recommended)" → **D-01**
**Q1.2 — Tier reconciliation location** → "Edge Function on every write (Recommended)" → **D-02**
**Q1.3 — Apple StoreKit Product ID naming** → "`app.leanshot.plus.monthly` + `.yearly` (Recommended)" → **D-03**
**Q1.4 — Refund + cancellation race** → "Immediate on RevenueCat webhook (Recommended)" → **D-04** — *note: deliberate asymmetry with Stripe grace-period*

---

## Area 2: Capacitor 8 plugin set + biometric

**Q2.1 — Capacitor major version** → "Capacitor 8.x (Recommended)" → **D-05**
**Q2.2 — Biometric plugin** → "@capgo/capacitor-native-biometric (Recommended)" → **D-06**
**Q2.3 — Plugin set (multi-select)** → ALL 4 options selected (Core 11 + Keyboard/Network + Filesystem/Clipboard + RevenueCat) → **D-07** — *user picked max-coverage*
**Q2.4 — Photo OOM mitigation stack** → "react-virtuoso + Supabase Storage transforms (Pro) (Recommended)" → **D-08** — *requires Pro tier upgrade*

---

## Area 3: Universal Links + bundle ID strategy

**Q3.1 — AASA host** → "Both — publish AASA on leanshot.app AND app.leanshot.app" → **D-09** — *user picked max-coverage*
**Q3.2 — Bundle ID strategy** → "`app.leanshot.ios` + `app.leanshot.android` (Recommended)" → **D-10**
**Q3.3 — Deep-link route map (multi-select)** → ALL 4 categories selected (auth + share + clinic + marketing) → **D-11** — *user picked max-coverage*
**Q3.4 — Capacitor web asset source** → "Hybrid bundled fallback + Capacitor Live Updates" → **D-12**

**Follow-up Q3.5 — Apple §3.1.1 + §4.7 review risk on D-11 + D-12** → "Accept both risks; mitigate at plan-phase" → **D-13** — *planner adds platform-aware /pricing fork + scoped Live Updates*

---

## Area 4: Build pipeline + release cadence

**Q4.1 — Build pipeline foundation** → "fastlane + GitHub Actions (Recommended)" → **D-14**
**Q4.2 — TestFlight + Play Internal soak** → "7-day TestFlight + 3-day Play Internal (Recommended given regulator-audience)" → **D-15**
**Q4.3 — Code-signing key custody** → "fastlane match in a private GitHub repo + 1Password Vault backup (Recommended)" → **D-16**
**Q4.4 — Sentry Capacitor SDK depth** → "Capacitor SDK + native Sentry Cocoa + Sentry Android (Recommended, max coverage)" → **D-17**

---

## Area 5: Privacy Manifest + ASO assets

**Q5.1 — PrivacyInfo.xcprivacy strategy** → "Hand-crafted from plugin inventory (Recommended)" → **D-18**
**Q5.2 — Store screenshot strategy** → "Playwright-captured screens + designer overlay (Recommended)" → **D-19**
**Q5.3 — Store listing localization** → "EN + ES + DE + FR (top 4 by GLP-1 market size)" → **D-20** — *user picked MAX over recommended EN-only; adds ~25-30 hours to scope*
**Q5.4 — App Store preview video** → "Hand-recorded screen capture + iMovie edit (Recommended)" → **D-21**

---

## Area 6: Cross-platform tier sync edge cases

**Q6.1 — Trial-already-used policy** → "Block 2nd trial (Recommended for revenue protection)" → **D-22**
**Q6.2 — iOS app tier display when Stripe-yearly + iOS cancellation** → "iOS app shows `tier='paid'` (sourced from web sub, Recommended)" → **D-23**
**Q6.3 — Clinic-owner IAP visibility** → "Hide IAP for clinic owners (Recommended)" → **D-24**
**Q6.4 — Tier-flip propagation speed** → "Realtime via Supabase Realtime channel (Recommended)" → **D-25**

---

## Aggregate patterns observed

- **User selected the max-coverage option in 4 of 25 questions** where I framed it as such (D-07 plugin set, D-09 dual-AASA, D-11 deep-link routes, D-17 Sentry triple-SDK, D-20 4-locale). Consistent with `feedback_aggressive_foundations.md` and refines the regulator-vs-user-audience pattern: regulator surfaces (D-18 hand-crafted manifest, D-19 reproducible screenshots, D-21 hand-recorded video) got conservative-recommended picks.
- **User accepted ALL 21 "Recommended" choices** where I framed them. High alignment with my framing — no scope creep, no deferrals to v1.3 within phase scope.
- **D-04 + D-23 form a coherent stance:** honest tier representation (immediate downgrade + unified MAX display) over UX softening (grace period + per-platform display).
- **D-11 + D-12 + D-13 form a single calculated risk:** maximum deep-link coverage AND Live Updates, with planner-phase mitigation for the Apple §3.1.1 / §4.7 review risk.

---

## Scope expansion flagged for plan-phase

| Item | Source | Estimated added scope |
|---|---|---|
| 3 non-EN store listings (ES/DE/FR) | D-20 | ~25-30 hours translation + screenshot localization |
| Supabase Pro tier upgrade | D-08 | ~$25/mo recurring + project migration check |
| Capgo Live Updates account | D-12 | ~$15-30/mo recurring + integration ~4-6 hours |
| RevenueCat account + 2 products | D-01 | Net-new vendor, ~2 hours setup |
| `leanshot-fastlane-match` private repo | D-16 | ~5min create + ~2 hours initial cert sync |

---

## No scope creep observed

User stayed within Phase 16 boundaries (mobile shells + IAP + deep links + build pipeline + ASO). No drift into Phase 17 (push), Phase 18 (health), Phase 20 (ads), Phase 21 (watch).

---

*Phase 16 — Capacitor Mobile Shells (iOS + Android)*
*Discussion: 2026-05-15*
