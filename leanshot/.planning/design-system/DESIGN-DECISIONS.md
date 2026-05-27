# Design Decisions — Intentional Carve-outs

**Phase:** 69 (Layout & Design Polish) — stub created by 69-03.
**Last updated:** 2026-05-27.

This document catalogues intentional exceptions to the design-system rules.
The Phase 69 audit scripts under `scripts/ci/audit-*.ts` are **report-only
heuristics**, not fail-gates. They produce markdown reports under this
directory; many "findings" are legitimate carve-outs.

**Use this document to:**

1. Record the surface, the rule it bends, and why.
2. Give Phase 69.5 (and future audits) a place to suppress known false
   positives before re-running the sweep.

Each entry should answer:

- **What rule?** (e.g., spacing must be multiple of 4)
- **What surface?** (file path, route, component name)
- **Why is the exception legitimate?**
- **When should this be revisited?** (e.g., "when X primitive ships in Phase Y")

---

## Spacing carve-outs (DS-08)

_None recorded yet. Populate during Phase 69.5 sweep of
`spacing-report.md` — when a finding is "intended, ship as-is", record
it here so the next sweep skips it._

Template:

```
- **Rule:** Spacing multiples of 4
- **Surface:** src/components/foo/Bar.tsx:42 (p-[7px])
- **Reason:** Chart axis tick offset; 8px misaligns with Chart.js grid line.
- **Revisit:** When Chart.js grid alignment is re-tuned in Phase YY.
```

---

## A11y carve-outs (DS-05)

_None recorded yet._

Common legitimate cases the heuristic over-flags:

- Icon-only buttons where the parent context already provides the label
  (`aria-labelledby` on the wrapping container).
- `<input>` controls that use `aria-labelledby` referencing a non-`<label>`
  element — the script's `<label htmlFor=...>` check misses these.
- `framer-motion` imports in pure-page-transition components where the
  motion is gated upstream by the route-level `useReducedMotion` hook.

---

## Mobile-responsive carve-outs (DS-07)

_None recorded yet._

Common legitimate cases:

- Hardcoded width on absolutely-positioned overlays where mobile parent is
  itself scrollable (e.g., guided-tour coachmarks).
- `overflow-x-auto` on intentional carousel surfaces.
- `<table>` without scroll wrapper inside an admin-only surface where the
  audience is desktop-first.

---

## Copywriting carve-outs (DS-09)

_None recorded yet._

Common legitimate cases:

- Non-canonical CTA verb intentionally chosen for brand voice (e.g., a
  marketing CTA "Take the tour" — record here so the audit treats it as
  approved copy).
- Short error toasts where a longer message would harm urgency (rare; most
  errors benefit from solution-path copy).

---

## Update protocol

When you add a carve-out:

1. Pick the right section.
2. Use the template above (Rule / Surface / Reason / Revisit).
3. Commit alongside the change that creates the exception (do not back-fill).
4. Re-run the relevant audit and confirm the finding is now expected
   noise — operator filters during fix pass (Phase 69.5).
