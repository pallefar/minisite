---
phase: 16-capacitor-mobile-shells-ios-android
plan: 08
type: execute
wave: 3
depends_on: ["16-01"]
files_modified:
  - e2e/aso/aso-capture.spec.ts
  - playwright.config.ts
  - apps/ios/store-listing-en.md
  - apps/android/store-listing-en.md
  - apps/ios/marketing/screenshots/en-US/.gitkeep
  - apps/android/marketing/screenshots/en-US/.gitkeep
  - apps/ios/marketing/preview.mov
  - .planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md
  - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-SUMMARY.md
autonomous: false
requirements: ["MOBILE-04"]
tags: ["aso", "playwright", "screenshots", "store-listing", "phase-16"]

must_haves:
  truths:
    - "EN store-listing copy exists for both iOS and Android with title, subtitle, description, keywords, and promo text."
    - "Six required marketing viewports (iPhone 15 Pro Max 6.7\", iPhone 14 6.1\", iPad Pro 12.9\", Pixel Phone, Pixel Tablet, Wear OS) are captured deterministically by a Playwright spec."
    - "Captured screenshots land at apps/ios/marketing/screenshots/en-US/ and apps/android/marketing/screenshots/en-US/ for the matching viewport set per store."
    - "A 30-second App Store Preview video (preview.mov) is committed at apps/ios/marketing/preview.mov."
    - "Locale scope split is explicit: EN ships in P16; DE/ES/FR are documented as deferred to v1.2.1 in a dedicated 16-08-DEFERRED-LOCALES.md (not a silent omission)."
  artifacts:
    - path: "e2e/aso/aso-capture.spec.ts"
      provides: "Playwright multi-viewport screenshot capture spec for ASO assets"
      contains: "VIEWPORTS array with all 6 D-19 viewports; describe('ASO capture — EN-only'); per-viewport setViewportSize + screenshot loops over key SCREENS"
    - path: "playwright.config.ts"
      provides: "Adds a dedicated `aso` Playwright project (testDir e2e/aso) so the capture spec can be opted into without polluting the default e2e run"
    - path: "apps/ios/store-listing-en.md"
      provides: "EN App Store listing copy"
      contains: "## Title (<=30)\\n## Subtitle (<=30)\\n## Promotional Text (<=170)\\n## Description (<=4000)\\n## Keywords (<=100)\\n## Support URL\\n## Marketing URL"
    - path: "apps/android/store-listing-en.md"
      provides: "EN Google Play listing copy"
      contains: "## Title (<=30)\\n## Short description (<=80)\\n## Full description (<=4000)"
    - path: "apps/ios/marketing/screenshots/en-US/.gitkeep"
      provides: "Directory landing pad for iOS screenshots"
    - path: "apps/android/marketing/screenshots/en-US/.gitkeep"
      provides: "Directory landing pad for Android screenshots"
    - path: "apps/ios/marketing/preview.mov"
      provides: "30-second App Store Preview video (manual QuickTime capture)"
    - path: ".planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md"
      provides: "Explicit scope-split document recording what DE/ES/FR work is deferred to v1.2.1, what survives in P16 (full EN), and the rationale (R4)"
      contains: "## Deferred to v1.2.1 (R4 explicit scope split); DE/ES/FR store-listing translations; DE/ES/FR screenshot re-captures"
  key_links:
    - from: "e2e/aso/aso-capture.spec.ts"
      to: "apps/ios/marketing/screenshots/en-US/ + apps/android/marketing/screenshots/en-US/"
      via: "page.screenshot({ path: ... }) with viewport-named files"
      pattern: "page\\.screenshot\\(\\{\\s*path:"
    - from: "apps/ios/store-listing-en.md + apps/android/store-listing-en.md"
      to: "store dashboards (App Store Connect + Play Console)"
      via: "manual copy-paste at submission time; not auto-uploaded in P16"
      pattern: "manual paste at Plan 16-09 submission step"
---

<objective>
Implement the EN-only slice of MOBILE-04 (ASO assets). This plan ships:

1. A deterministic Playwright capture spec (`e2e/aso/aso-capture.spec.ts`) that iterates over the 6 store-required viewports (D-19) and saves screenshots to `apps/ios/marketing/screenshots/en-US/` and `apps/android/marketing/screenshots/en-US/`.
2. EN store-listing copy at `apps/ios/store-listing-en.md` + `apps/android/store-listing-en.md` filled to Apple + Google character-budget templates so Plan 16-09's submission lanes have ready-to-paste copy.
3. A 30-second App Store Preview video committed at `apps/ios/marketing/preview.mov`, captured via a human QuickTime recording checkpoint (D-21, ~3-4 hr of manual work).
4. A `16-08-DEFERRED-LOCALES.md` document explicitly recording the R4 scope split: EN ships in Phase 16; DE/ES/FR translations + per-locale screenshot re-captures are deferred to v1.2.1.

Purpose: Unblock first App Store + Play Store submission (Plan 16-10 launch gate) without paying the 25-30 hour translation tax up front (R4). MOBILE-04 covers ASO assets generally; the locale split is an explicit, documented scope reduction that honors D-20 (full EN ships in P16; remaining 3 locales become v1.2.1 follow-up) rather than a silent omission.

Output: 6 viewports per spec × 3 key marketing screens (home, photo gallery, drug-level chart) split across iOS-eligible (3) + Android-eligible (3) viewport sets, producing ~9 PNGs per platform, EN store copy, 30s preview video, and an explicit deferred-locale ledger.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@leanshot/e2e/clinic-ad-free.spec.ts
@leanshot/playwright.config.ts

<interfaces>
<!-- Key APIs and patterns the executor needs. Extracted from analog clinic-ad-free.spec.ts + 16-PATTERNS.md -->

Playwright per-viewport screenshot pattern (from 16-PATTERNS.md `e2e/aso/aso-capture.spec.ts` section):

VIEWPORTS array shape — 6 entries from D-19, each with { name, width, height, store }:
- iphone-15-pro-max: 430 x 932, store=ios
- iphone-14:         390 x 844, store=ios
- ipad-pro-12.9:    1024 x 1366, store=ios
- pixel-phone:       393 x 873, store=android
- pixel-tablet:     1600 x 2560, store=android
- wear-os:           384 x 384, store=android

SCREENS array shape — 3 marketing surfaces, each with { slug, path }:
- home: '/'
- photo-gallery: '/?tab=body'
- med-level: '/?tab=medication'

Per-viewport test factory pattern (mirrors clinic-ad-free.spec.ts for-loop):
- for each VIEWPORT, create a test that loops SCREENS, calls page.setViewportSize, page.goto(path, {waitUntil:'networkidle'}), then page.screenshot({path: `apps/${vp.store}/marketing/screenshots/en-US/${vp.name}-${screen.slug}.png`, fullPage: false}).

Playwright config — adding a project (from existing playwright.config.ts):
- Append projects[] entry: { name: 'aso', testDir: './e2e/aso', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' } }
- Do NOT add 'aso' to the default-run set; it must be opt-in via --project=aso.

Apple App Store Connect character budgets (2025):
- Title: <= 30 chars
- Subtitle: <= 30 chars
- Promotional Text: <= 170 chars (editable without re-submission)
- Description: <= 4000 chars
- Keywords: <= 100 chars (comma-separated)

Google Play Console character budgets:
- Title: <= 30 chars
- Short description: <= 80 chars
- Full description: <= 4000 chars
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement ASO capture Playwright spec + project wiring</name>
  <files>e2e/aso/aso-capture.spec.ts, playwright.config.ts, apps/ios/marketing/screenshots/en-US/.gitkeep, apps/android/marketing/screenshots/en-US/.gitkeep</files>
  <read_first>
    - leanshot/e2e/clinic-ad-free.spec.ts (analog: per-route Playwright iteration with for-loop test factory)
    - leanshot/playwright.config.ts (existing project structure -- needs a new `aso` project entry)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md `e2e/aso/aso-capture.spec.ts` section + the Multi-viewport screenshot pattern
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md D-19 viewport list
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md Validation Architecture table row MOBILE-04
  </read_first>
  <action>
Create `e2e/aso/aso-capture.spec.ts` per the pattern in 16-PATTERNS.md.

1. Define a `VIEWPORTS` const array with the 6 entries from D-19, each shaped { name, width, height, store } where store is 'ios' or 'android'. Use these exact widths/heights (per the interfaces block above):
   - iphone-15-pro-max: 430 x 932, store=ios
   - iphone-14: 390 x 844, store=ios
   - ipad-pro-12.9: 1024 x 1366, store=ios
   - pixel-phone: 393 x 873, store=android
   - pixel-tablet: 1600 x 2560, store=android
   - wear-os: 384 x 384, store=android

2. Define a `SCREENS` const array with 3 key marketing screens: { slug: 'home', path: '/' }, { slug: 'photo-gallery', path: '/?tab=body' }, { slug: 'med-level', path: '/?tab=medication' }. The `?tab=` deep-link convention is already supported by the existing `selectViewLogged` / tab handler in `src/App.tsx`; verify the deep-link routes by grep before relying on them, and if the convention differs, fall back to navigating via in-app clicks via `page.getByRole('tab', { name: ... })`.

3. For each VIEWPORT, create one `test()` named `${vp.name} -- capture key screens` that loops over SCREENS, calls `await page.setViewportSize({ width: vp.width, height: vp.height })`, then for each screen `await page.goto(screen.path, { waitUntil: 'networkidle' })` followed by `await page.screenshot({ path: \`apps/${vp.store}/marketing/screenshots/en-US/${vp.name}-${screen.slug}.png\`, fullPage: false })`. Use the for-loop test-factory pattern from `clinic-ad-free.spec.ts` (top-level `for (const vp of VIEWPORTS) { test(...) }`).

4. Header comment must include:
   - "Phase 16 Plan 16-08 -- ASO multi-viewport capture (EN-only per R4)"
   - Reference to D-19 viewport list
   - Reference to the deferred-locales doc path (`.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md`)
   - Maintenance contract: "Any new D-19 viewport added in v1.2.1 must be appended to VIEWPORTS here. Any new locale must be added as a separate aso-capture-<locale>.spec.ts or generalize VIEWPORTS x LOCALES."

5. Create `apps/ios/marketing/screenshots/en-US/.gitkeep` and `apps/android/marketing/screenshots/en-US/.gitkeep` (empty files) so the directories are tracked even before the spec actually runs.

6. Edit `leanshot/playwright.config.ts`: append a new project entry `{ name: 'aso', testDir: './e2e/aso', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' } }` to the `projects` array (or to whatever the existing `projects` config shape is -- read it first and mirror its style). The `aso` project MUST NOT be in the default-run set (kept opt-in via `--project=aso`); confirm by ensuring no `defaultProjects` or test-matrix include catches `e2e/aso/**`.

7. NO emojis in code or comments. Absolute paths in `read_first`, relative paths in source.

DO NOT yet generate the screenshots themselves -- that requires a built app + running dev server, which is gated as Task 4 (human checkpoint). Task 1 only lands the spec, the playwright project entry, and the empty target directories.
  </action>
  <verify>
    <automated>cd leanshot && npx playwright test --project=aso --list 2>&1 | grep -E "aso-capture\.spec\.ts" | grep -cE "(iphone|pixel|ipad|wear)" | awk '$1 >= 6 {exit 0} {exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - `cd leanshot && npx playwright test --project=aso --list` lists at least 6 tests (one per viewport) before any tests run.
    - `playwright.config.ts` has an `aso` project entry; default-run projects are unchanged (e.g., `cd leanshot && npx playwright test --list` does NOT include the aso tests unless the project flag is passed -- `aso` is opt-in).
    - Both `apps/ios/marketing/screenshots/en-US/.gitkeep` and `apps/android/marketing/screenshots/en-US/.gitkeep` exist and are tracked by git (`git ls-files apps/ios/marketing/screenshots/en-US/.gitkeep apps/android/marketing/screenshots/en-US/.gitkeep` returns both).
    - Spec header comment references R4 + the deferred-locales doc path.
    - `cd leanshot && npx tsc -b --noEmit` passes (no TS errors).
  </acceptance_criteria>
  <done>Spec + Playwright project wiring + landing-pad directories committed; spec is discoverable via the `aso` project filter and not picked up by the default e2e run.</done>
</task>

<task type="auto">
  <name>Task 2: Write EN store-listing copy for App Store + Play Store</name>
  <files>apps/ios/store-listing-en.md, apps/android/store-listing-en.md</files>
  <read_first>
    - leanshot/.planning/PROJECT.md (Core Value line -- "Drug-level projection + injection-site rotation are the headline")
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md (Phase Boundary section, audience: GLP-1 patients)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md Pitfall 4 (Apple section 3.1.1 anti-steering -- NO "save by subscribing on the web" copy)
    - leanshot/index.html (existing brand metas -- tone reference)
  </read_first>
  <action>
Create `apps/ios/store-listing-en.md` with these exact section headers, in order. Each section header is a `## ` markdown heading; the section body is the copy (no extra prose). DO NOT inline the character budget in the body itself -- budgets are guardrails, not part of the copy:

```
## Title
<Brand-first title featuring "LeanShot" and a one-noun positioning word -- e.g., "GLP-1" or "Tracker". Honor the brand from PROJECT.md.>

## Subtitle
<Outcome-focused; reference drug-level projection or injection rotation per PROJECT.md Core Value.>

## Promotional Text
<Editable post-submission. Lead with a current value-prop; no anti-steering language.>

## Description
<Long-form. Cover: pharmacology curve, site rotation, body metrics, food/activity/mood logging, doctor-share, AI coach. Mirror the audience triad from PROJECT.md. NO mention of "subscribe on our website" or any price-elsewhere phrasing (Pitfall 4). State that the app is not medical advice and not yet HIPAA covered (PROJECT.md compliance posture).>

## Keywords
<GLP-1, semaglutide, tirzepatide, weight loss tracker, injection log, ...>

## Support URL
https://leanshot.app/support

## Marketing URL
https://leanshot.app
```

Character budgets (enforce at write-time via `wc -m` on the body of each H2 block):
- Title <= 30
- Subtitle <= 30
- Promotional Text <= 170
- Description <= 4000
- Keywords <= 100

Create `apps/android/store-listing-en.md` with these exact sections:

```
## Title
<Same as iOS title or a 30-char Play-tuned variant.>

## Short description
<One-line value prop. Audience-aware per PROJECT.md.>

## Full description
<Same content shape as iOS description; Play allows slightly more keyword density than Apple. Still avoid medical-advice claims per PROJECT.md compliance posture.>
```

Character budgets:
- Title <= 30
- Short description <= 80
- Full description <= 4000

Per PROJECT.md "Compliance posture" line, the Description / Full description MUST include the disclaimer line: "LeanShot is not a medical device and does not provide medical advice." (or near-equivalent -- single sentence).

Per Pitfall 4: the final iOS copy MUST NOT contain any of these forbidden tokens (case-insensitive): "save by subscrib", "discount on web", "cheaper on the web", "leanshot.app/account". Grep-verify before finishing.

Per Pitfall 4 anti-steering note: outside US storefront also applies (DE/ES/FR markets per D-20). Avoid any phrasing that points users to a cheaper purchase channel. The Description may neutrally mention that "a web version is available at leanshot.app" only as a general capability statement, NOT framed as a purchase channel.
  </action>
  <verify>
    <automated>cd leanshot && test -f apps/ios/store-listing-en.md && test -f apps/android/store-listing-en.md && ! grep -iE "(save by subscrib|discount on web|cheaper on the web|leanshot\.app/account)" apps/ios/store-listing-en.md && node -e "const fs=require('fs');const md=fs.readFileSync('apps/ios/store-listing-en.md','utf8');const sections={};const re=/^## (.+?)\n([\s\S]*?)(?=^## |\Z)/gm;let m;while((m=re.exec(md))){sections[m[1].trim()]=m[2].trim();}const budgets={'Title':30,'Subtitle':30,'Promotional Text':170,'Description':4000,'Keywords':100};let bad=0;for(const [k,v] of Object.entries(budgets)){const body=sections[k]||'';if(body.length>v){console.error('over budget:',k,body.length,'>',v);bad=1;}else if(!body){console.error('missing:',k);bad=1;}}process.exit(bad);" && node -e "const fs=require('fs');const md=fs.readFileSync('apps/android/store-listing-en.md','utf8');const sections={};const re=/^## (.+?)\n([\s\S]*?)(?=^## |\Z)/gm;let m;while((m=re.exec(md))){sections[m[1].trim()]=m[2].trim();}const budgets={'Title':30,'Short description':80,'Full description':4000};let bad=0;for(const [k,v] of Object.entries(budgets)){const body=sections[k]||'';if(body.length>v){console.error('over budget:',k,body.length,'>',v);bad=1;}else if(!body){console.error('missing:',k);bad=1;}}process.exit(bad);"</automated>
  </verify>
  <acceptance_criteria>
    - `apps/ios/store-listing-en.md` exists with all 7 H2 sections: Title, Subtitle, Promotional Text, Description, Keywords, Support URL, Marketing URL.
    - Each iOS section body fits its character budget: Title <= 30, Subtitle <= 30, Promotional Text <= 170, Description <= 4000, Keywords <= 100.
    - `apps/android/store-listing-en.md` exists with Title <= 30, Short description <= 80, Full description <= 4000.
    - No anti-steering forbidden tokens present on the iOS listing (`grep -iE "(save by subscrib|discount on web|cheaper on the web|leanshot\.app/account)"` returns nothing).
    - Both descriptions include a non-medical-advice disclaimer (per PROJECT.md Compliance posture).
    - Both descriptions reference the LeanShot core-value pair (drug-level projection + injection-site rotation) somewhere.
  </acceptance_criteria>
  <done>EN store-listing copy committed for both stores, character-budget-compliant, anti-steering-clean, ready to paste into App Store Connect + Play Console at Plan 16-09 submission step.</done>
</task>

<task type="auto">
  <name>Task 3: Write the deferred-locales scope-split ledger</name>
  <files>.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md</files>
  <read_first>
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md D-20 (4-locale store listings -- EN + DE + ES + FR)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md Open Questions Q3 (R4 -- "EN-first first submission; ES/DE/FR as v1.2.1 ASO-only update")
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PLAN-OUTLINE.md R4 line
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md Pitfall 8 (translation pipeline)
  </read_first>
  <action>
Create `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md` with the following structure. Use the exact H2 headings shown:

Section 1 -- `## Deferred to v1.2.1 (R4 explicit scope split)`
  - Bullet list of exactly what is NOT shipping in P16:
    - DE / ES / FR translations of apps/ios/store-listing-en.md -> apps/ios/store-listing-{de,es,fr}.md
    - DE / ES / FR translations of apps/android/store-listing-en.md -> apps/android/store-listing-{de,es,fr}.md
    - DE / ES / FR re-captures of the 6-viewport screenshot set with localized in-app UI (requires app-side i18n, not in scope for v1.2)
    - Per-locale audio for the App Store Preview video (D-21 already permits silent video with caption overlays for v1.2)

Section 2 -- `## What ships in P16 (EN scope honored fully)`
  - Full EN store-listing copy for both App Store + Play Store (`apps/ios/store-listing-en.md` + `apps/android/store-listing-en.md`)
  - Full 6-viewport screenshot set in en-US for both platforms (`apps/ios/marketing/screenshots/en-US/` + `apps/android/marketing/screenshots/en-US/`)
  - 30-second App Store Preview video at `apps/ios/marketing/preview.mov` (silent, caption-overlay style per D-21)

Section 3 -- `## Why deferred (R4 rationale)`
  - Researcher recommendation (16-RESEARCH.md Open Question Q3): EN-only first submission unblocks first launch; DE/ES/FR adds ~25-30 hours of translation + screenshot re-capture work that is NOT on the App Store / Play Store binary path.
  - App Store + Play Store allow store-listing-only updates without resubmitting the binary, so adding 3 more locales in v1.2.1 has zero re-submission cost.
  - D-20 (4-locale ASO) is honored as the long-term commitment: full EN ships in P16; remaining 3 locales become a v1.2.1 ASO-only follow-up. This is NOT a silent omission -- it is an explicit, documented scope split.

Section 4 -- `## v1.2.1 follow-up checklist (carried forward)`
  - [ ] DE translation of store-listing-en.md (DeepL Pro API per Pitfall 8 recommendation; human review of medical-tone terms)
  - [ ] ES translation
  - [ ] FR translation
  - [ ] DE/ES/FR screenshot re-captures (requires in-app i18n, separate v1.2.1 phase)
  - [ ] Add `aso-capture-de.spec.ts` / `-es.spec.ts` / `-fr.spec.ts` mirroring the EN spec, or generalize VIEWPORTS x LOCALES in a single spec
  - [ ] Per-locale promotional text refresh (App Store Connect allows this without re-submission)

Section 5 -- `## REQ-ID coverage statement`
  - MOBILE-04 is satisfied in P16 by the EN slice. The phase requirement does NOT mandate 4-locale completeness; D-20 was the CONTEXT-level scope expansion. R4 documents the partial-completion path that still ships the binary on time.

Open the document with a one-line header pointing back to this PLAN.md so anyone landing on the file knows where it came from. NO emojis.
  </action>
  <verify>
    <automated>test -f leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md && [ "$(grep -c '^## ' leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md)" -ge 5 ] && grep -q "MOBILE-04" leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md && grep -q "R4" leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md && grep -q "v1.2.1" leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md</automated>
  </verify>
  <acceptance_criteria>
    - File exists at `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md`.
    - Document has all 5 required H2 sections: Deferred to v1.2.1, What ships in P16, Why deferred, v1.2.1 follow-up checklist, REQ-ID coverage statement.
    - References R4, MOBILE-04, and v1.2.1 explicitly.
    - Lists the 3 DE/ES/FR locales by name.
    - Notes the App Store + Play Store store-listing-only-update path.
  </acceptance_criteria>
  <done>The R4 scope split is recorded in writing. The phase ships EN fully; DE/ES/FR are documented as a v1.2.1 follow-up with an explicit checklist that survives this plan's SUMMARY.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 4: Capture 30s App Store Preview video + run aso-capture spec to generate screenshots</name>
  <what-built>
    Plan 16-08 has shipped (via Tasks 1-3):
    - `e2e/aso/aso-capture.spec.ts` (Playwright multi-viewport capture spec; opt-in via `--project=aso`)
    - `apps/ios/store-listing-en.md` + `apps/android/store-listing-en.md` (EN store copy, character-budget-compliant, anti-steering-clean)
    - `apps/{ios,android}/marketing/screenshots/en-US/.gitkeep` (landing-pad directories)
    - `.planning/phases/.../16-08-DEFERRED-LOCALES.md` (R4 scope split ledger)

    Two human-required deliverables remain:

    (A) Run the screenshot capture -- requires Plan 16-01's built app + a running dev server. The capture spec navigates a real browser at 6 viewport sizes and writes PNGs into the landing-pad directories.

    (B) Record the 30-second App Store Preview video -- D-21 specifies hand-recorded QuickTime + iMovie cut + caption overlays. No CLI/API exists for this; it is the canonical human-only task on this plan (~3-4 hours of work per CONTEXT D-21).
  </what-built>
  <how-to-verify>
    (A) Screenshot capture (~10 min):
    1. From `leanshot/`, ensure the app builds: `npm run build` (one-time, validates Plan 16-01 completed).
    2. Start the dev server in a separate terminal: `cd leanshot && npm run dev` -- confirm http://localhost:5173 is reachable.
    3. Use a non-PII demo account when seeding the page state (per T-16-08-01 threat). If not yet seeded, log in once via the dev server using a fresh test account and populate enough state that Home, Photo gallery, and Medication chart screens are visually populated (per CONTEXT and the SCREENS array).
    4. Run the capture spec: `cd leanshot && npx playwright test --project=aso`. Wait for all 6 viewport tests to complete (~2-3 min total).
    5. Confirm screenshots exist:
       - `find apps/ios/marketing/screenshots/en-US -name '*.png' | wc -l` -- expect >= 9 (3 screens x 3 iOS viewports)
       - `find apps/android/marketing/screenshots/en-US -name '*.png' | wc -l` -- expect >= 9 (3 screens x 3 Android viewports)
    6. Spot-check 2 PNGs visually -- open `apps/ios/marketing/screenshots/en-US/iphone-15-pro-max-home.png` and `apps/android/marketing/screenshots/en-US/pixel-phone-photo-gallery.png`. Both must show real app UI, not error pages or blank renders, AND must NOT show personal-account PII (per T-16-08-01).

    (B) 30s App Store Preview video (~3-4 hr per D-21):
    1. Connect a real iPhone (any 6.7-inch device -- iPhone 14 Pro Max or later) running the LeanShot Capacitor build from Plan 16-01.
    2. Open QuickTime Player -> File -> New Movie Recording -> click the arrow next to record -> select the iPhone as input source.
    3. Record a 30-second walkthrough hitting: Home -> Photo gallery -> Medication chart -> Log dose -> Share screen. Aim for one smooth take. USE A DEMO ACCOUNT, NOT YOUR PERSONAL LEANSHOT ACCOUNT (per T-16-08-02).
    4. Trim to exactly 30s in iMovie (Apple rejects videos > 30s).
    5. Add caption overlays in iMovie (EN-only per R4; per-locale audio deferred per D-21).
    6. Export as H.264 .mov (Apple's required format). Filename: `preview.mov`.
    7. Place at `apps/ios/marketing/preview.mov`. If the file is > 100 MB, configure Git LFS for `*.mov` (`git lfs track "*.mov"`) before committing.
    8. Confirm:
       - `test -f apps/ios/marketing/preview.mov`
       - `ffprobe -v error -show_entries format=duration -of csv=p=0 apps/ios/marketing/preview.mov` returns a value <= 30.0 (duration in seconds).

    (C) Commit + verify:
    1. `git add apps/ios/marketing/ apps/android/marketing/`
    2. `git status` -- confirm screenshots + preview.mov are staged.
    3. `git commit -- apps/ios/marketing/ apps/android/marketing/ -m "feat(16-08): EN ASO screenshots + 30s App Store Preview video"` (use pathspec form per reference_parallel_executor_git_isolation.md; this plan may be running alongside Plan 16-07 and 16-09 in Wave 3).
    4. `cd leanshot && git ls-files apps/ios/marketing/ apps/android/marketing/ | wc -l` -- expect >= 19 files (18 PNGs + 1 .mov + 2 .gitkeeps minimum).
  </how-to-verify>
  <resume-signal>Type "aso-assets-done" once screenshots are captured AND preview.mov is committed at `apps/ios/marketing/preview.mov`. Type "aso-screenshots-only" if you've completed (A) but want to defer (B) -- the plan will partially-complete with a v1.2 carry-over note. Type "skip-aso" to defer both to a separate sub-phase (NOT recommended -- Plan 16-10's launch gate blocks on this).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| QuickTime screen-recording -> committed binary | Manual capture introduces non-determinism; preview.mov may inadvertently include PII (user data shown during recording) |
| Playwright dev-server -> screenshot PNG | Captured PNGs may show real seed-account data; must use a clean fresh-onboarding fixture or non-PII demo data |
| Store-listing copy -> public App Store / Play Store dashboards | Copy is regulator-audience (Apple + Google reviewers + end users); anti-steering language risks section 3.1.1 rejection |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-08-01 | Information disclosure | apps/ios/marketing/screenshots/en-US/*.png + apps/android/marketing/screenshots/en-US/*.png | mitigate | Task 4(A) step 3 mandates a non-PII demo account for seeding; Task 4(A) step 6 spot-check verifies no real email/injection/photo PII renders. If PII is found, re-run capture with a freshly created demo user. Record the demo-account identifier in the SUMMARY for audit trail. |
| T-16-08-02 | Information disclosure | apps/ios/marketing/preview.mov | mitigate | Task 4(B) step 3 mandates demo-account recording, not personal account. SUMMARY records the demo identifier so re-recording uses the same surface. |
| T-16-08-03 | Tampering | apps/ios/store-listing-en.md | mitigate | Pitfall 4 anti-steering tokens grep'd in Task 2 verify. Plan 16-10 launch gate re-greps before submission per its own threat model. |
| T-16-08-04 | Repudiation | Deferred-locales ledger | accept | Low-risk; the ledger is a planning artifact, not a security surface. If lost, the v1.2.1 follow-up surfaces from this plan's SUMMARY anyway. |
| T-16-08-05 | Denial of service | Playwright capture spec on CI | accept | The `aso` Playwright project is opt-in (not in default-run set). CI integration is deferred to Plan 16-09 (mobile.yml). No CI cost increase from this plan. |
</threat_model>

<verification>
After all 4 tasks complete:

1. Spec discoverable: `cd leanshot && npx playwright test --project=aso --list` shows >= 6 tests.
2. Screenshots present: `find apps/ios/marketing/screenshots/en-US apps/android/marketing/screenshots/en-US -name '*.png' | wc -l` returns >= 18 (only enforced if resume signal was `aso-assets-done` or `aso-screenshots-only`).
3. Preview video present + duration ok: `test -f apps/ios/marketing/preview.mov && ffprobe -v error -show_entries format=duration -of csv=p=0 apps/ios/marketing/preview.mov | awk '{exit ($1+0 <= 30.0) ? 0 : 1}'` (only enforced if user resumed with `aso-assets-done`).
4. Copy character budgets compliant: Per Task 2 automated verify (node script).
5. Anti-steering clean: `cd leanshot && ! grep -iE "(save by subscrib|discount on web|cheaper on the web|leanshot\.app/account)" apps/ios/store-listing-en.md`.
6. Deferred-locales ledger exists: Per Task 3 acceptance criteria.
7. TypeScript still compiles: `cd leanshot && npx tsc -b --noEmit` exits 0.
8. Default-run Playwright unchanged: `cd leanshot && npx playwright test --list 2>&1 | grep -c 'aso-capture'` returns 0 (aso is opt-in, not in default suite).
</verification>

<success_criteria>
- MOBILE-04 EN slice satisfied: 6-viewport screenshots, EN store copy, 30s preview video.
- R4 scope split documented in 16-08-DEFERRED-LOCALES.md; DE/ES/FR explicitly carried to v1.2.1 (not silently omitted).
- Plan 16-09's submission lanes can pick up the listings + screenshots + video at known paths without further coordination.
- Plan 16-10's launch gate has the artifacts it needs to verify "App Store listing complete" + "Play Store listing complete".
- No anti-steering language in the EN copy (Pitfall 4 mitigated).
- Default Playwright suite untouched (no CI cost regression from the new `aso` project).
</success_criteria>

<output>
After completion, create `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-SUMMARY.md` capturing:
- Final character counts for every store-listing section vs. budget (table form).
- Total screenshots captured (per platform breakdown).
- Preview video duration + file size.
- Whether the executor resumed with `aso-assets-done`, `aso-screenshots-only`, or `skip-aso` -- and what carries forward to v1.2 / v1.2.1 if partial.
- Demo-account identifier used for screenshot/video capture (for T-16-08-01/02 PII-safety audit trail).
- The deferred-locales ledger path so v1.2.1 planning picks it up.
- Pointer to Plan 16-09 (submission lanes that consume these artifacts) and Plan 16-10 (launch gate).
</output>
