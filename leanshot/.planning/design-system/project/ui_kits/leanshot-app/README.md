# LeanShot — App UI Kit

A clickable recreation of the LeanShot dashboard, covering the **Today**,
**Medication**, and skeletal stubs for the other 7 tabs. Faithful to
`leanshot/src/components/dashboard/*` from the source repo.

## Files

| File | What's inside |
|---|---|
| `index.html` | Entry — open this. |
| `app.jsx` | Root `<App>` — owns `current`, `logKind`, `theme`, `toast` state. |
| `icons.jsx` | Inline Lucide icon paths. Exposes `Icon`, `I`. |
| `shell.jsx` | `Sidebar` (80 px rail), `Topbar`, `MobileNav`. |
| `cards.jsx` | `HeroCard`, `GLPCurveCard`, `FocusCard`, `SiteRotationCard`, `StreaksCard`, `QuickLogCard`, `TodayTab`. |
| `tabs.jsx` | `MedicationTab` + `GenericTab` placeholder for other tabs. |
| `modals.jsx` | `LogModal` (dose / weight / meal / water) + `Toast`. |
| `app.css` | App shell, sidebar, topbar, mobile nav, bento grid, base atoms. |
| `app-components.css` | Card-specific styles — hero mesh, titration track, modal, peak chips. |
| `assets/` | `hero-orbital.svg`, `body-diagram.svg`, `streak-badge.svg`, `vial.svg`, `ai-avatar.svg`. |

## Screens & interactions

- **Sidebar** — tap any of 9 tabs to switch the main pane. Home renders the
  full bento. Medication renders a dose-history list + vial supply + a
  re-used `SiteRotationCard` + the full titration plan. Other tabs render a
  branded placeholder.
- **Topbar** — "Log dose" button opens the dose modal. Search bar is visual.
  Theme toggle flips `data-theme` on `<html>`.
- **HeroCard** — animated count-up of the "Lost" number on mount. Mesh
  gradient drifts in the background; the orbital SVG sits in the corner at
  50 % opacity. Titration track shows the current dose pulsing.
- **GLPCurveCard** — synthesizes a 7-day med-level curve with the most
  recent dose marker and a "Now" dashed line at the right edge.
- **QuickLog** — four buttons (Dose / Weight / Meal / Water). Each opens
  `LogModal` with the corresponding form.
- **LogModal** — dose form has a site picker (6 pill toggles), weight form
  has a single number input, meal form takes a freetext + protein number,
  water form has 8 tap-to-fill glasses. Save → toast → close.
- **Mobile nav** — at < 880 px, swaps the desktop sidebar for the glass-blur
  floating bottom bar.

## Things deliberately not built

- Persistence: state lives in React only — refresh resets everything.
- Real onboarding and auth (the app has Supabase auth in production).
- AI chat panel, Doctor Report PDF, Settings page, individual symptom cards.
- The 7 placeholder tabs (Side effects, Body, Nutrition, Activity, Stack,
  Mood, Wins) — each has its own bento in the real codebase.
