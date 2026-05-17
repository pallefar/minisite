---
name: leanshot-design
description: Use this skill to generate well-branded interfaces and assets for LeanShot — a clinical-grade GLP-1 medication tracker — either for production or for throwaway prototypes, mocks, slides, and marketing pieces. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files (`colors_and_type.css`, `assets/`, `preview/`, `ui_kits/leanshot-app/`, `ui_kits/leanshot-marketing/`).

If creating visual artifacts (slides, mocks, throwaway prototypes, marketing pages), copy assets out of `assets/` and the `ui_kits/<product>/` folder and create static HTML files for the user to view. Always link `colors_and_type.css` for tokens, and load Inter + Fraunces + JetBrains Mono from Google Fonts.

If working on production code, you can copy assets and read the rules here to become an expert in designing with LeanShot's brand — the canonical source is `leanshot/src/index.css` and `leanshot/src/components/`.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions (audience, surface, screens, animation appetite, copy length), and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference

- **Voice**: clinical-but-warm. Sans headlines with one Fraunces italic accent. Sentence case. Periods at the end of headlines. No emoji. Numbers over adjectives.
- **Palette**: cream backgrounds (#EFEBE0 / #FDFBF6), deep teal primary (#1B4842), warm desaturated accents (sage / rose / amber / clay / sky).
- **Type**: Inter 400–800 (UI), Fraunces italic (editorial accents only), JetBrains Mono (numerals).
- **Cards**: 24 px radius, 1 px warm grey border, soft xs shadow, cream-card surface.
- **Hero card**: deep teal fill, white text, mesh-drift gradient, HeroOrbital SVG bottom-right.
- **Icons**: Lucide React only, stroke 1.8 (resting) / 2.2 (active). Never filled.
- **Motion**: ease-out-quart entries, 200–500 ms durations, prefers-reduced-motion respected.
- **Layout**: 12-col bento grid on dashboard, 1200 px max on marketing, 80 px sidebar.

## When in doubt

Default to the recreations in `ui_kits/leanshot-app/index.html` and `ui_kits/leanshot-marketing/index.html`. They are the source of truth for layout, spacing, and copy patterns.
