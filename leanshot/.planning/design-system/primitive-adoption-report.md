# DS Primitive Adoption Audit (DS-04)

Generated: 2026-05-27T06:59:56.746Z

Report-only heuristic audit. False positives expected — operator filters
during fix pass (Phase 69.5). Script exits 0 regardless of findings.

Total findings: **4**

## Summary

| Primitive | Findings |
| --- | --- |
| Button | 0 |
| Card | 2 |
| Modal | 2 |
| Input | 0 |

## Button — 0 findings

_None detected._

## Card — 2 findings

- `leanshot/src/components/layout/Topbar.tsx:106` — Card-shaped `<div>` — consider `<Card>`
  ```
  <div className="hidden md:flex items-center gap-2 px-4 py-2.5 rounded-pill bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[va
  ```
- `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx:250` — Card-shaped `<div>` — consider `<Card>`
  ```
  <div className="bg-[var(--color-surface)] rounded-[28px] border border-[var(--color-border)] shadow-lg overflow-hidden p-6 md:p-8 space-y-6">
  ```

## Modal — 2 findings

- `leanshot/src/components/clinic/alerts/AlertSnoozePopover.tsx:173` — ad-hoc `<div role="dialog">` — consider `<Modal>` or `<Sheet>` (file already imports the primitive)
  ```
  <div ref={popoverRef} role="dialog" aria-modal="true" aria-labelledby={HEADING_ID}>
  ```
- `leanshot/src/components/dashboard/ai/CitationPopover.tsx:380` — ad-hoc `<div role="dialog">` — consider `<Modal>` or `<Sheet>` (file already imports the primitive)
  ```
  <div ref={dialogRef} role="dialog" aria-modal="true">
  ```

## Input — 0 findings

_None detected._

