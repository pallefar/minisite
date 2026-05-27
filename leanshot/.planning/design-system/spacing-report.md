# Spacing Audit (DS-08)

Generated: 2026-05-27T07:15:48.702Z

Report-only heuristic audit. False positives expected (intentional
exceptions per surface). Document carve-outs in DESIGN-DECISIONS.md so
Phase 69.5 sweep does not re-flag them.

Design-system grid: multiples of **4px**. Tailwind default scale
(`p-1` = 4px, `p-2` = 8px, ...) is on-grid by definition — only `*-[Npx]`
arbitrary values are scanned.

Total findings: **15**

## Summary

| Kind | Findings |
| --- | --- |
| padding | 4 |
| margin | 11 |
| gap | 0 |
| space-x | 0 |
| space-y | 0 |

## padding — 4 findings

- `leanshot/src/components/dashboard/ai/CitationMarker.tsx:9` — `p-[5px]` — 5px is not a multiple of 4. Snap to nearest grid step.
  ```
  *   - Tap target: p-[5px] padding → 5+14+5 = 24px minimum hit area
  ```
- `leanshot/src/components/dashboard/ai/CitationMarker.tsx:39` — `p-[5px]` — 5px is not a multiple of 4. Snap to nearest grid step.
  ```
  // p-[5px]: 5+14+5 = 24px minimum tap target (UI-SPEC §3 invariant 10)
  ```
- `leanshot/src/components/dashboard/ai/CitationMarker.tsx:40` — `p-[5px]` — 5px is not a multiple of 4. Snap to nearest grid step.
  ```
  'inline-flex items-center justify-center p-[5px] align-text-top',
  ```
- `leanshot/src/components/dashboard/ai/CitationMarker.tsx:52` — `px-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  'text-[11px] font-semibold leading-none px-[2px]',
  ```

## margin — 11 findings

- `leanshot/src/components/admin/pages/blocks/PricingBlock.tsx:89` — `mt-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
  ```
- `leanshot/src/components/auth/AuthFormShell.tsx:67` — `mb-[18px]` — 18px is not a multiple of 4. Snap to nearest grid step.
  ```
  <PillGroup segmented className="mb-[18px]">
  ```
- `leanshot/src/components/auth/AuthHero.tsx:46` — `mt-[22px]` — 22px is not a multiple of 4. Snap to nearest grid step.
  ```
  <p className="mt-[22px] text-base leading-[1.55] opacity-80">
  ```
- `leanshot/src/components/clinic/settings/BrandingTab.tsx:681` — `mt-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="w-8 h-8 rounded-lg border border-[var(--color-border)] shrink-0 mt-[2px]"
  ```
- `leanshot/src/components/clinic/settings/BrandingTab.tsx:761` — `ms-[22px]` — 22px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="text-[11px] text-[var(--color-danger)] ms-[22px]"
  ```
- `leanshot/src/components/clinic/settings/BrandingTab.tsx:802` — `ms-[22px]` — 22px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="text-[11px] text-[var(--color-danger)] ms-[22px]"
  ```
- `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx:427` — `mt-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  <Clock className="size-4 mt-[2px] shrink-0 text-[var(--color-text-secondary)]" aria-hidden />
  ```
- `leanshot/src/components/marketing/Landing.tsx:457` — `mt-[3px]` — 3px is not a multiple of 4. Snap to nearest grid step.
  ```
  className={`size-4 mt-[3px] shrink-0 ${t.featured ? 'text-white' : 'text-[var(--color-primary)]'}`}
  ```
- `leanshot/src/components/PricingIOS.tsx:272` — `mt-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
  ```
- `leanshot/src/components/PricingIOS.tsx:279` — `mt-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
  ```
- `leanshot/src/components/PricingIOS.tsx:286` — `mt-[2px]` — 2px is not a multiple of 4. Snap to nearest grid step.
  ```
  className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
  ```

## gap — 0 findings

_None detected._

## space-x — 0 findings

_None detected._

## space-y — 0 findings

_None detected._

