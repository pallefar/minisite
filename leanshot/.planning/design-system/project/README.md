# LeanShot Design System

> **LeanShot** is a clinical-grade tracking app for people on GLP-1 medications
> (Ozempic, Wegovy, Mounjaro, Zepbound) and adjacent peptides. It turns the
> mess of injections, weights, meals, mood, and side effects into one unified
> picture you share with your doctor and a coach (AI + rules) shares back with
> you. The headline mechanic is **drug-level projection + injection-site
> rotation** — the pharmacology curve (28 days past + 7 days projected) is the
> centerpiece every other tab feeds into.

## What this folder contains

A complete brand + UI design system extracted from the LeanShot codebase:
tokens, type, illustrations, component recipes, and clickable UI kits for
both the app dashboard and the marketing site.

## Audiences served by the product

1. **GLP-1 patients (B2C)** — primary. Local-first web app, works offline.
2. **Doctors** viewing a specific patient's share-link (read-only).
3. **Clinics & coaches** monitoring multiple patients (B2B).

## Products represented here

| Surface | What it is | UI kit |
|---|---|---|
| LeanShot app | The dashboard SPA — 9 tabs (Today, Medication, Side effects, Body, Nutrition, Activity, Stack, Mood, Wins) | `ui_kits/leanshot-app/` |
| Marketing site | Pre-onboarding landing page on the public domain | `ui_kits/leanshot-marketing/` |

## Sources

- GitHub: **[pallefar/minisite](https://github.com/pallefar/minisite)** — the canonical codebase, specifically the `leanshot/` subfolder.
- Key files referenced: `leanshot/src/index.css` (tokens), `leanshot/src/components/marketing/Landing.tsx`, `leanshot/src/components/ui/*` (primitives), `leanshot/src/components/dashboard/cards/*` (bento cards), `leanshot/src/components/layout/*` (nav).
- Imported under `leanshot/src/` in this project for reference.

---

## Index

| File | Purpose |
|---|---|
| `README.md` | This file. Brand, content, visual, iconography. |
| `SKILL.md` | Agent-skill manifest. Run this to apply the system to new artifacts. |
| `colors_and_type.css` | All design tokens + semantic type classes, framework-free. |
| `assets/` | Logos, body diagram, hero orbital, vial, AI avatar, streak badge, etc. |
| `preview/` | Small card files that populate the Design System tab. |
| `ui_kits/leanshot-app/` | Dashboard recreation: hero card, GLP-1 curve, site rotation, focus, streaks, sidebar, mobile nav. |
| `ui_kits/leanshot-marketing/` | Landing recreation: nav, hero with animated curve, features, testimonials, pricing, FAQ. |
| `leanshot/` | Imported source code from the repo — read-only reference. |

---

## CONTENT FUNDAMENTALS

LeanShot's voice is **clinical-but-warm**. Two registers, intentionally side-by-side.

### Tone in two registers

The signature move: **a sans-serif headline that swerves into a Fraunces
italic phrase**. The italic is always the emotional or aspirational fragment;
the sans-serif part is the factual claim.

- **Maximize your _GLP-1 journey._ Lose fat. Keep muscle.**
- **What no other tracker _does._**
- **From real _patients._**
- **Honest _pricing._**
- **Common _questions._**

In the app, the same move shows up on the hero card:
**"Lost"** (italic Fraunces) over **"4.2 kg"** (extrabold Inter). The
italic word is the *feeling*; the number is the *fact*.

### Casing & punctuation

- **Sentence case** for everything — headings, buttons, nav. Never Title Case.
- **Periods** at the end of headlines and short phrases — confident, declarative. (e.g. "Honest pricing.", "From real patients.")
- **Hyphens** for compounds (GLP-1, doctor-ready, half-life, peer-reviewed).
- **No exclamation marks**. We don't congratulate; we report and reassure.

### Voice rules

- **You/your**, not "users". Always second person.
- **We** when speaking as the company in trust statements ("We never send your weight…"), otherwise the product speaks in the imperative ("Eat slow", "Take it slow").
- **Numbers over adjectives.** Replace "lots of features" with "All 9 dashboard tabs". Replace "fast" with "$5/month".
- **Concrete medications by name** — Ozempic, Wegovy, Mounjaro, Zepbound. Don't say "your medication".
- **Pharmacology vocabulary is welcome**, not hidden. Half-life. Trough. Titration. Peak. The audience knows these words and trusts us more when we use them. Define on first use only if needed.
- **No emoji** in product copy. Lucide icons carry tone instead.
- **No exclamation, no superlatives, no hype.** "Clinical-grade", "real pharmacology", "peer-reviewed" — claims you can back up.

### Microcopy patterns

| Pattern | Examples |
|---|---|
| **Eyebrow** | "GLP-1 LEVEL · 7-DAY", "TODAY'S FOCUS", "TITRATION TIMELINE" — all caps, tracked 0.08–0.1em |
| **Phase tag + tip** | "Week 8 · Titration phase · Stay protein-focused." |
| **Status pill** | "Peak now", "Trough", "Mid-cycle", "Recent · avoid", "Next" |
| **Soft assurance** | "Local-only data", "No card needed", "Cancel anytime" |
| **Trust footer** | "An educational tracking tool. Not medical advice. Always consult your prescriber." |
| **Empty state** | Single short sentence, never breathless. "No shots logged yet." |
| **Doctor disclaimer** | Required on first AI/insight surface every session. |

### Forbidden words

journey (except in headlines), unlock, supercharge, game-changer, revolutionary, AI-powered (just "AI"), seamless, robust, leverage. Anything that sounds like a SaaS landing page from 2019.

---

## VISUAL FOUNDATIONS

The phrase the codebase uses for itself is **"clinical warmth."** Hold that in mind.

### Color vibe

- **Cream backgrounds** (#EFEBE0, #FDFBF6) — not white. Warm, paper-like, calm. Reads as medical-publication, not Notion.
- **Deep teal** (#1B4842) as the only true brand color. Saturated but dark, never neon. Used for primary buttons, headings inflection, hero cards.
- **A small bank of warm accents** — sage (success), rose/orange (warning), amber (older state), clay (danger), sky (hydration). All are *desaturated* — they sit alongside cream without screaming.
- **Hero surfaces** flip the palette: dark teal background, white text, mesh-gradient drift, the **HeroOrbital** illustration in the corner at 50% opacity.
- **Image vibe** is warm-tinted, slightly grainy when used; we mostly avoid stock photography in favor of **inline SVG illustrations**.

### Type

- **Inter** for the entire UI? No — **Geist** (Vercel's font, on Google Fonts) is the working sans, 400–900. Cleaner, more contemporary, better numerals. Default body 16 px / 1.55. Headings 700–800 with tight tracking (-0.02 to -0.04em).
- **Fraunces** italic for editorial accents — the *one word* in a heading, the "Weight Lost →" label on the hero card, opening curly-quotes on testimonials. **Never Fraunces upright; never Fraunces for body copy.**
- **Geist Mono** for numerals in charts and tabular data ("4.2 kg", "92%", "2.5 mg / 0.5 ml"). Always with `font-feature-settings: 'tnum'`.
- Tabular numerals (`numerals-tabular`) anywhere a number changes — countups, dose, weight, percent.
- A modular scale, 1.18 ratio at the top. See `colors_and_type.css`.

### Spacing & layout

- **4 px base unit.** All spacing is multiples (4, 8, 12, 16, 20, 24, 28, 32, 40, 48).
- **12-column "bento" grid** on the dashboard. Cards declare `span={4|5|6|7|8|12}`. Hero spans 7, GLP-1 card spans 5; together they fill row 1.
- **Max content width 1200px** on marketing, edge-to-edge with `safe-area-inset` padding on mobile.
- **80 px fixed sidebar** on desktop (icon-only, hover tooltips). Glass-blur **bottom nav** on mobile.

### Backgrounds

- **Plain cream** is the default; no patterns, no textures, no gradients on the page background.
- **Hero card** uses a layered radial mesh gradient (`mesh-drift` animation, 18 s loop) over a teal base, plus the orbital SVG bottom-right.
- **Focus card** uses `--color-primary-soft` (pale teal-tinted cream) — the only colored card on the dashboard.
- **No glassmorphism** anywhere except the mobile nav (where it lets the content show through the floating nav).
- **No noise / grain** textures.

### Animation

- Three easings only: `--ease-out-quart` (entries, most things), `--ease-in-out-quart` (state changes), `--ease-spring` (interactive pops).
- Four durations: instant 100, quick 200, standard 300, deliberate 500 ms.
- Signature animations: **rise** (6→0 px translate + fade-in on mount), **mesh-drift** (slow radial-gradient pan on hero), **orbit-slow/fast** (counter-rotating ellipses on HeroOrbital), **pulse-soft** (AI thinking), **ring-pulse** (active site dot).
- **No bounces** for layout (only `ease-spring` on small confirmations like the focus-icon pop-in).
- `prefers-reduced-motion: reduce` is honored everywhere — the `useReducedMotion()` hook gates every RAF loop and CSS animation.

### Interaction states

- **Hover (buttons)**: `translateY(-1px)` + `shadow-md`. Color tightens by ~5% via `brightness(0.95)` or a discrete hover token. Never opacity-fades.
- **Hover (cards `interactive`)**: `translateY(-2px)` + `shadow-md` + `border-color: primary-soft`.
- **Active/press**: `translateY(0.5px)` — a subtle settle, not a shrink.
- **Focus-visible**: `2px solid var(--color-primary)` outline, `3px` offset. On surfaces with their own border, swap to a `3px primary-soft` ring + `1px primary` outline (the `.focus-ring` class).
- **Disabled**: `opacity-50` + `pointer-events-none`. Never grey-out borders.

### Borders, corners, shadows

- **Corner radii**: a 4-step scale. `xs 6 / sm 10 / md 16 / lg 20 / card 24 / pill 999`. The bento radius (`--radius-card` = 24 px) is the dominant feel.
- **Borders**: `1 px solid var(--color-border)` (warm grey #E2DDD0) on every card by default. Hero card omits the border (its dark fill handles separation).
- **Shadow scale**: `xs / sm / md / lg / hero` — all *warm* (rgba(22, 34, 31, …)). `hero` is the deep cool one used only for the dark teal card. Cards are mostly `xs` resting, `md` on hover.
- **No inner shadows**. No double-borders. No capsules with colored left-border accents (anti-pattern).

### Cards

- Default: `bg-surface` (#FDFBF6), `1 px border`, `shadow-xs`, `radius-card` (24 px), `padding 20–28 px`.
- **Variants**: `default | elevated | interactive | hero | flat`. `flat` drops the shadow and uses `surface-elevated` background — used for inner subcards.
- Header convention: `<CardHeader title icon action />` — 8 px rounded icon chip in `primary-soft`, 14 px semibold title, optional action button right-aligned.

### Transparency & blur

- Used only in 3 places: mobile nav (`.glass`, blur 14 px), the hero card's titration track (`bg-white/8` + backdrop-blur), and modal scrims (`color-surface-overlay`, rgba teal at 45%).
- Avoid blur on text containers — kills legibility on cream.

### Iconography vibe at a glance

See ICONOGRAPHY section below. Short answer: **Lucide React**, stroke 1.8 default / 2.2 when active, never filled. Icons go in `--color-primary` on a `--color-primary-soft` chip when in a card header.

---

## ICONOGRAPHY

### System

**[Lucide](https://lucide.dev/) (lucide-react `^0.460.0`)** is the **only** icon font in the codebase. ~50 icons in active use. No icon font, no custom SVG sprite, no PNG icons.

### Stroke & sizing

- **Default stroke width: 1.8** for resting icons, **2.2** for active/selected (nav, pills).
- **Sizes**: `size-3.5` (14 px hint), `size-4` (16 px in buttons + chips), `size-5` (20 px nav), `size-6` (24 px hero stats).
- Icons are **never filled** — Lucide's outline style is the entire look. The only "filled" shapes are bespoke SVG illustrations (Hero orbital, body diagram, vial).

### Placement

- **Card headers**: 32 px chip (`bg-surface-elevated`, `radius-xl`), icon in `--color-primary`.
- **Buttons**: `leadingIcon` or `trailingIcon` slot in `Button` / `IconButton`. Always 16 px (`size-4`).
- **Pills/Badges**: 14 px (`size-3.5`) leading icon, optional.
- **Nav**: 20 px (`size-5`), color follows active state.

### Tab → icon mapping (canonical)

| Tab | Lucide icon |
|---|---|
| Today | `Home` |
| Medication | `Syringe` |
| Side effects | `ShieldAlert` |
| Body | `User` |
| Nutrition | `Apple` |
| Activity | `Activity` |
| Stack | `Pill` |
| Mood | `Smile` |
| Wins | `Trophy` |
| AI coach | `Bot` |
| Settings | `Settings` |
| Theme | `Sun` / `Moon` |
| Logging dose | `Plus` |
| Export / report | `FileDown` |
| Search | `Search` |

### Brand mark

A lightning-bolt glyph (Lucide `Zap` outline) sits in a 7×7 (28 px) rounded square of `var(--color-primary)`. It's the only "logo" — no wordmark variant beyond Inter 800 "LeanShot" sitting beside it.

- `assets/logo-mark.svg` — the bolt alone, currentColor.
- `assets/logo-lockup.svg` — bolt + wordmark.

### Bespoke illustrations

A small set of inline SVG illustrations carry the visual personality where Lucide can't:

- `assets/hero-orbital.svg` — the **brand primitive**. A continuous-line leaf form with two counter-rotating dashed ellipses and concentric pulses. Appears on the hero card and in marketing feature backgrounds.
- `assets/ai-avatar.svg` — gradient orb with rings for the AI coach surface.
- `assets/body-diagram.svg` — schematic anterior body used in the SiteRotationCard. Color-coded dots indicate site recency.
- `assets/vial.svg` — used in supply/inventory empty states.
- `assets/streak-badge.svg` — flame medal for the streaks card (7d / 30d / 90d variants in the codebase).
- `assets/connect-data.svg` — feature illustration on marketing.
- `assets/empty-injections.svg` — empty-state.

All illustrations follow the same rules: 1.4–1.6 px strokes, soft gradient fills, brand-color palette only, no faces, no human figures beyond the anterior body schematic.

### Emoji & unicode

**No emoji** anywhere in product copy or UI. **No unicode glyphs** repurposed as icons (no →, ✓, ♥, etc.) — Lucide has equivalents (`ArrowRight`, `Check`, `Heart`). The one exception: the **curly opening quotemark** `&ldquo;` rendered in Fraunces italic on testimonial cards is a glyph used decoratively.

---

## Caveats / things to verify

- **Fonts**: The system uses **Geist** + **Geist Mono** + **Fraunces** — all three are on Google Fonts. They're loaded via `<link>` tags injected directly into each HTML `<head>` (not via `@import`, which is unreliable in nested-iframe contexts). If you reuse `colors_and_type.css` in a new HTML file, copy the three `<link>` tags from any existing file's head (`preview/colors-cream.html` is a good template).
- Brand-mark is the Lucide `Zap` outline; if there's a custom logo file in marketing assets elsewhere, swap `assets/logo-mark.svg` for it.
- The illustrations bundled in `assets/` are extracted from the JSX `<svg>` source so they have no React/reduced-motion gating. Re-add the gating if you embed them inside a React app.
