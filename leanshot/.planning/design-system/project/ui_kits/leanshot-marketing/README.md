# LeanShot — Marketing UI Kit

A clickable recreation of the LeanShot public landing page, faithful to
`leanshot/src/components/marketing/Landing.tsx` from the source repo.

## Files
- `index.html` — the landing page. Open this.
- `marketing.jsx` — React components (Nav, Hero, Features, Testimonials, Pricing, FAQ, Footer, StartModal).
- `marketing.css` — shared brand primitives (buttons, card, eyebrow chip).
- `marketing-components.css` — page-specific layout for each section.
- `assets/` — hero-orbital.svg, ai-avatar.svg, connect-data.svg.

## Sections recreated
1. **Top nav** — brand mark + theme toggle + sign-in + "Get started" CTA.
2. **Hero** — eyebrow chip, sans-headline-with-Fraunces-italic-accent, sub, dual CTAs, trust chips, **animated GLP-1 curve** SVG inside the dark teal hero card with the HeroOrbital illustration drifting in the background.
3. **Features** — three cards, each with a soft gradient art panel + icon chip + bold title + body.
4. **Testimonials** — three quote cards with Fraunces italic "⌜" mark and 5-week-cohort attribution.
5. **Pricing** — Free (cream) + Pro (dark teal, "Most popular" badge).
6. **FAQ** — five accordion items.
7. **Footer** — brand + trust + legal columns.

## Interactions
- The "Get started" / "Start free" / "Try Pro" buttons all open a small **StartModal** that asks the user to pick their medication (Ozempic / Wegovy / Mounjaro / Zepbound) and continue.
- Theme toggle in the nav flips `data-theme` on `<html>` between light and dark — every section adapts because all colors are token-driven.
- FAQ items toggle open/closed.
- Buttons have hover lift + shadow per the brand interaction rules.

## Things deliberately not built
- Real onboarding flow after the modal (the landing's `onStart` jumps into the app onboarding).
- The animated hero curve uses a 1.6 s linear progress reveal — not the full pharmacological model.
- Theme switch does not persist to `localStorage` here.
