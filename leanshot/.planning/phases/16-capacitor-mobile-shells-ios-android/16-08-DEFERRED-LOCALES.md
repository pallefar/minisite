<!--
Source: Plan 16-08 (`16-08-aso-playwright-capture-en-only-PLAN.md`) Task 3.
R4 explicit scope split. CONTEXT.md D-20 = 4-locale ASO; P16 ships EN only,
the remaining 3 locales land in v1.2.1 as a store-listing-only update.
-->

# Phase 16 Plan 16-08 -- Deferred Locales Ledger

This document records the R4 scope split for MOBILE-04 (ASO assets). It is
the canonical reference for what P16 ships in EN and what is explicitly
carried forward to v1.2.1.

## Deferred to v1.2.1 (R4 explicit scope split)

The following items are NOT shipping in Phase 16 and are explicitly carried
forward to a v1.2.1 store-listing-only update:

- DE / ES / FR translations of `apps/ios/store-listing-en.md` to
  `apps/ios/store-listing-{de,es,fr}.md`
- DE / ES / FR translations of `apps/android/store-listing-en.md` to
  `apps/android/store-listing-{de,es,fr}.md`
- DE / ES / FR re-captures of the 6-viewport screenshot set with localized
  in-app UI (requires app-side i18n, not in scope for v1.2)
- Per-locale audio for the App Store Preview video (D-21 already permits
  silent video with caption overlays for v1.2; per-locale audio is a v1.2.1
  follow-up only)

## What ships in P16 (EN scope honored fully)

The following deliverables ship fully in Phase 16, satisfying the EN slice
of MOBILE-04:

- Full EN App Store listing copy at `apps/ios/store-listing-en.md` (Title,
  Subtitle, Promotional Text, Description, Keywords, Support URL,
  Marketing URL).
- Full EN Play Store listing copy at `apps/android/store-listing-en.md`
  (Title, Short description, Full description).
- Full 6-viewport screenshot set in en-US for both platforms:
  - `apps/ios/marketing/screenshots/en-US/` (iPhone 15 Pro Max, iPhone 14,
    iPad Pro 12.9)
  - `apps/android/marketing/screenshots/en-US/` (Pixel Phone, Pixel Tablet,
    Wear OS)
- 30-second App Store Preview video at `apps/ios/marketing/preview.mov`
  (silent, caption-overlay style per D-21).

## Why deferred (R4 rationale)

- Researcher recommendation (16-RESEARCH.md Open Question Q3): EN-only
  first submission unblocks the first launch; DE / ES / FR add an estimated
  25-30 hours of translation work plus screenshot re-captures that are
  NOT on the App Store / Play Store binary-approval path.
- App Store Connect and Google Play Console both allow store-listing-only
  updates without resubmitting the binary, so adding 3 more locales in
  v1.2.1 has zero re-submission cost and zero risk to the v1.2 binary.
- D-20 (4-locale ASO -- EN + DE + ES + FR) is honored as the long-term
  commitment: full EN ships in P16; the remaining 3 locales become a
  v1.2.1 ASO-only follow-up. This is NOT a silent omission -- it is an
  explicit, documented scope split with a working checklist below.

## v1.2.1 follow-up checklist (carried forward)

- [ ] DE translation of `apps/ios/store-listing-en.md` and
      `apps/android/store-listing-en.md` (DeepL Pro API per RESEARCH.md
      Pitfall 8 recommendation; mandatory human review of medical-tone
      terms before submission).
- [ ] ES translation (same provider + review gate).
- [ ] FR translation (same provider + review gate).
- [ ] DE / ES / FR screenshot re-captures (requires in-app i18n, which is
      a separate v1.2.1 phase -- track as its own plan when the i18n
      infrastructure is in place).
- [ ] Add `aso-capture-de.spec.ts`, `aso-capture-es.spec.ts`, and
      `aso-capture-fr.spec.ts` mirroring the EN spec, OR refactor the EN
      spec to iterate VIEWPORTS x LOCALES in a single file.
- [ ] Per-locale Promotional Text refresh (App Store Connect allows this
      without re-submission; Play Console supports localized "What's new"
      release notes).
- [ ] Update `playwright.config.ts` `aso` project comment if the spec
      generalization changes invocation shape.

## REQ-ID coverage statement

MOBILE-04 (ASO assets) is satisfied in P16 by the EN slice. The phase
requirement does NOT mandate 4-locale completeness at P16 close; D-20 was
the CONTEXT-level scope expansion that established 4-locale as the
long-term target. R4 documents the partial-completion path that still
ships the binary on time (App Store + Play Store both accept EN-only at
first submission).

When the v1.2.1 follow-up lands the DE / ES / FR work, MOBILE-04 will be
fully closed against D-20.
