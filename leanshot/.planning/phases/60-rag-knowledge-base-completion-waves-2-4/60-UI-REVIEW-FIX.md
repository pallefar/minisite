---
phase: 60
fixed_at: 2026-05-26T00:00:00Z
review_path: leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 60 — UI Review Fix Report

**Fixed at:** 2026-05-26
**Source review:** `60-UI-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (BLOCKER 1 + BLOCKER 2 — all FLAGS and advisory deferred to Phase 69)
- Fixed: 2
- Skipped: 0

---

## Fixed Issues

### BLOCK-1: Undefined @theme color tokens on /knowledge/* pages

**Files modified:** `KnowledgeRootPage.tsx`, `KnowledgeTopicIndexPage.tsx`, `KnowledgeArticleDetailPage.tsx`, `KnowledgeBreadcrumb.tsx`
**Commit:** `1cc1615e`

**Applied fix:**

Verified all undefined tokens against `src/index.css @theme` block before applying. Replaced 9 token classes that do not exist in the design system and would render as transparent/no-op in Tailwind v4:

- `text-text-primary` → `text-text` (`--color-text` exists; `--color-text-primary` does NOT)
- `bg-surface-card` → `bg-surface` (`--color-surface` exists; `--color-surface-card` does NOT)
- `border-border-subtle` → `border-border` (`--color-border` exists; `--color-border-subtle` does NOT)
- `text-accent` + `focus-visible:outline-accent` → `text-primary` / `outline-primary` (`--color-primary` exists; `--color-accent` does NOT)
- `bg-warning-subtle` → `bg-danger-soft` (`--color-danger-soft` exists via clay-soft; `--color-warning-subtle` does NOT)
- `text-warning-foreground` → `text-danger` (`--color-danger` exists; `--color-warning-foreground` does NOT)
- `text-success` → `text-[var(--color-success)]` (`--color-success` exists but no direct Tailwind utility `text-success` — uses explicit CSS var reference for safety)
- `hover:text-text-primary` → `hover:text-text` (same as first item; both forms of the undefined token patched)

Note: `text-text-secondary` and `text-text-tertiary` are VALID and were NOT changed — `--color-text-secondary` and `--color-text-tertiary` both exist in `@theme`.

Also fixed in this commit (overlapping scope with BLOCK-2):
- `KnowledgeTopicIndexPage.tsx:270` `text-base` → `text-lg` (article card H2 — explicitly listed in BLOCK-2 spec violation table)
- `KnowledgeRootPage.tsx:188` `font-medium text-accent` → `font-normal text-primary` (Read more link — dual violation)
- `KnowledgeBreadcrumb.tsx:72` `text-text-primary font-medium` → `text-text font-normal` (breadcrumb current page span)

### BLOCK-2: Typography ceiling breached in 6 files

**Files modified:** `CitationPopover.tsx`, `SourcesFooter.tsx`, `RefusalCard.tsx`, `NewsletterOptInStep.tsx`, `TipOfTheDayCard.tsx`, `NewsletterSettings.tsx`
**Commit:** `abb512fb`

**Applied fix:**

Normalized all out-of-spec sizes and weights across the 6 BLOCKER-flagged components. Design system ceiling: sizes must be in {11, 13, 18, 28}px; weights must be 400 (normal) or 600 (semibold) only.

Size normalizations:
- `CitationPopover.tsx:264` `text-[15px]` → `text-[13px]` — source title link in popover; 13px is the appropriate body reading size
- `CitationPopover.tsx:283` `text-[12px]` → `text-[11px]` — "read full chunk" link; 11px is the spec micro size for secondary links
- `SourcesFooter.tsx:79` `text-[12px]` → `text-[11px]` — toggle button label
- `SourcesFooter.tsx:100` `text-[12px]` → `text-[11px]` — citation list items
- `RefusalCard.tsx:69` `text-[14px]` → `text-[13px]` — refusal message body; 13px is the spec body size
- `NewsletterOptInStep.tsx:35` `text-[26px]` → `text-heading` (28px) — onboarding H1; nearest allowed large size

Weight normalizations:
- `CitationPopover.tsx:313` `font-medium` → `font-normal` — "Open source" link text; link context doesn't need extra weight
- `SourcesFooter.tsx:106` `font-medium` → `font-normal` — source name span in citation list; visual hierarchy provided by color, not weight
- `TipOfTheDayCard.tsx:140` `font-medium` → `font-normal` — eyebrow label ("TIP OF THE DAY"); all-caps + tracking handles visual distinction
- `NewsletterSettings.tsx:129` `font-medium` → `font-semibold` — toggle label; label text semantically wants stronger weight than surrounding sublabel, semibold (600) is the heavier allowed value
- `NewsletterOptInStep.tsx:35` `font-bold` → `font-semibold` — onboarding H1; semibold (600) is the max allowed weight

---

## Deferred to Phase 69 (FLAG-level + advisory)

The following findings from `60-UI-REVIEW.md` were intentionally out of scope for this fix pass per the objective brief. They are tracked in the FLAG/advisory sections of the review and should be addressed in Phase 69 design polish:

| Finding | File | Description |
|---|---|---|
| FLAG — Toast missing Undo | `RagQueuePage.tsx:155` | 5s undo window + reversal RPC required |
| FLAG — Newsletter error copy drift | `KnowledgeRootPage.tsx:238` | "in a moment" wording missing |
| FLAG — Save preferences CTA i18n verify | `rag:newsletter.save_cta` | Locale key resolution unverified |
| FLAG — EXTRACTED QUOTE accent color | `QueueDetailPane.tsx:209` | Non-interactive label using primary color |
| FLAG — Retract chunk out-of-spec | `QueueDetailPane.tsx:259` | Addition beyond UI-SPEC action row |
| FLAG — Reroll button disabled with no tooltip | `TipOfTheDayCard.tsx:146-154` | Mobile inaccessible title tooltip |
| FLAG — Knowledge root silent fail-soft | `KnowledgeRootPage.tsx:63-76` | No user-visible error when topics fail to load |
| FLAG — Pull full history disabled | `FederatedSourceRow.tsx:167` | Title-only tooltip inaccessible on mobile |
| FLAG — Undocumented spacing values | `CitationMarker.tsx:50-52` | h-[14px] + px-[2px] advisory |
| FLAG — Tap targets | Multiple | No min-h/min-w 44px enforcement on row items |
| Advisory — `font-medium` in pre-Phase-60 admin nav | `RagLayout.tsx:189` | Pre-existing Phase 24 file; not in Phase 60 audit scope |
| Advisory — `text-[12px]` in pre-Phase-60 admin table | `RagSourcesPage.tsx:220` | Pre-existing Phase 24 file; not in Phase 60 audit scope |

---

_Fixed: 2026-05-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
