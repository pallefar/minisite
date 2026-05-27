# LeanShot Accent Color Reserved List (DS-03)

**Owner:** Phase 69 design-system polish.
**Enforced by:** `scripts/ci/check-accent-reserved.ts` (CI gate).
**Last reviewed:** 2026-05-27

Accent tokens (`text-primary`, `bg-primary`, `text-accent`, `bg-accent`,
`text-success`, `bg-success`, `text-warning`, `bg-warning`, `text-danger`,
`bg-danger`, `text-info`, `bg-info`, plus the `*/N` opacity variants and
`ring-primary`/`ring-accent`/etc.) are reserved for SPECIFIC interactive or
status-bearing surfaces.

Non-reserved usage indicates either:
- **Decorative noise** — visual weight without semantic meaning, OR
- **Missing a real accent purpose** — the color is doing the job of typography
  or spacing.

## Reserved Surfaces (allowed accent use)

Accent colors WIN attention. Use them where attention is the goal.

- **Primary CTA buttons** — `<Button variant="primary">`, `<Button variant="accent">`.
  Goal: drive the next action. The whole surface MUST be the accent (background).
- **Active tab indicators** — selected nav state. Accent underline or fill.
- **Selected item state** — checked rows in tables, selected list items, picked
  pill in a pill-group. Accent ring or soft-background tint.
- **Status badges** — success / warning / danger / info pills + dots. Use the
  `*-soft` background tokens with the matching foreground accent.
- **Notification dots / unread counts** — small accent fill drawing eye.
- **Charts** — primary data series color (one line / one bar per chart).
- **Loading spinners / progress bars** — fill color.
- **Inline link in body text** — `text-primary` with underline (one decoration
  pattern, used consistently across the app).
- **Form error messages** — `text-danger` for validation copy.
- **Streak / gamification highlights** — counters, sparkles, win states.

## Non-Reserved (forbidden accent use)

These are the patterns the CI gate fires on (heuristic: filename + class
combination).

- **Body text / paragraph copy** — use `text-text` or `text-text-secondary`.
  The accent should NEVER be doing the job of "make this paragraph readable".
- **Card borders** (default state) — use `border-border`. Selected/active
  state IS reserved.
- **Decorative icons next to neutral text** — use `text-text-tertiary`. Icons
  that signal a STATE (warning, success, lock) ARE reserved.
- **Sidebar nav labels** — inactive labels use `text-text-secondary`. The
  ACTIVE label is reserved.
- **Modal title bars** — modal titles use `text-text`. The danger-modal
  destructive-action button IS reserved.
- **Form input borders** (default state) — use `border-border`. Focused state
  uses `border-primary`. Errored state uses `border-danger`.
- **Marketing-landing hero copy** — Phase 60-13 caught accent-on-extracted-quote
  noise here. Use `text-text-on-hero` + `text-text-on-hero-muted` for hero
  paragraph copy. Reserved only for the CTA button and selected-feature pills.

## Audit Workflow

`scripts/ci/check-accent-reserved.ts` greps for accent class usage in files
NOT matching a known-reserved-surface pattern. Pre-existing usages are
grandfathered via the baseline file
(`scripts/ci/check-accent-reserved.baseline.txt`). New usages outside the
baseline fail the CI gate.

### How the gate decides

1. **Reserved-surface filename patterns** — files matching one of the patterns
   in `RESERVED_FILE_PATTERNS` (see script) are exempted entirely. Examples:
   `**/components/ui/Button.tsx`, `**/components/ui/Badge.tsx`,
   `**/components/ui/Pill.tsx`, `**/streaks/*`, `**/StatusDot.tsx`.
2. **Hard-forbidden filename patterns** — files matching one of the
   `FORBIDDEN_FILE_PATTERNS` (initially `**/marketing/Landing.tsx` per Phase
   60-13 quote-extraction lesson) ALWAYS fail on accent class usage, even on
   the first occurrence.
3. **Everything else** — gets the baseline treatment. Existing usages
   grandfathered; new usages fail.

### How to add a file to the grandfather baseline

Phase 69.5 tech-debt sweep is expected to drain the baseline. While the
sweep is in-flight, if you ship a new feature that legitimately needs
accent on a non-reserved surface:

1. Add the file's relative path (from git root) to
   `scripts/ci/check-accent-reserved.baseline.txt`.
2. Open a follow-up ticket linking the addition to Phase 69.5.
3. Include the reason in the PR description (commit message).

### How to remove a file from the baseline (preferred direction)

1. Replace each accent class with a defined-token equivalent
   (`text-text`/`text-text-secondary` for copy, `bg-surface` for backgrounds).
2. Delete the file's line from the baseline.
3. Re-run the gate locally — must PASS.

## References

- Phase 60-13 SUMMARY — original accent-noise audit (6 surfaces fixed).
- `[[reference_ui_checker_dimension_traps]]` — dimension traps the auditor
  catches that the eye doesn't.
- `[[feedback_ui_auditor_catches_undefined_theme_tokens]]` — sibling lesson
  on Tailwind v4 invisible-token regressions (DS-01 enforces this class).
