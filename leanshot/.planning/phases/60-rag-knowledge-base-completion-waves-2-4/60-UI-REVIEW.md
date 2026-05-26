---
status: flags
phase: 60
audited: 2026-05-26
baseline: 60-UI-SPEC.md (approved design contract)
screenshots: not captured (no dev server detected)
typography_score: 2
visuals_score: 3
color_score: 2
copywriting_score: 3
spacing_score: 3
experience_design_score: 3
overall: 16/24
---

# Phase 60 — UI Review

**Audited:** 2026-05-26
**Baseline:** 60-UI-SPEC.md
**Screenshots:** not captured (dev server not running)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Toast missing `· Undo` affordance; newsletter error copy diverges from spec |
| 2. Visuals | 3/4 | `EXTRACTED QUOTE` label uses accent color; `Retract chunk` missing from action spec |
| 3. Color | 2/4 | Knowledge pages use ~8 undefined @theme tokens that will render as transparent/broken |
| 4. Typography | 2/4 | 5 out-of-spec sizes (12, 14, 15, 26px + `text-base`) across 6 files; `font-bold`/`font-medium` used |
| 5. Spacing | 3/4 | `p-[5px]` documented exception passes; `h-[14px]` on badge and `min-w-[1.5rem]` are outside 4-scale |
| 6. Experience Design | 3/4 | Undo affordance absent on Approve toast; `Pull full history` permanently disabled without user signal |

**Overall: 16/24**

---

## Hard-Block Invariant Re-Verification

| # | Invariant | Status | Evidence |
|---|-----------|--------|---------|
| 1 | Citation popover displays `verbatim_quote` | PASS | CitationPopover.tsx:252 reads `chunk.verbatim_quote`, truncates to 280 chars, renders via `dangerouslySetInnerHTML` after DOMPurify |
| 2 | Refusal UX NOT like normal reply | PASS | RefusalCard uses `Card variant="flat"` + icon; AIChatPanel.tsx returns `<RefusalCard>` branch without citation markers or SourcesFooter |
| 3 | PHARMA-02 copy byte-exact | PASS | i18n.test.ts:56 verifies `"That topic requires clinician guidance — please ask your doctor."` exactly; RefusalCard.tsx:55 pulls from `RAG_REFUSAL_KIND_TO_KEY.pharma_02` |
| 4 | 2-person rule badge + disabled Approve | PASS | RagQueuePage.tsx:314 `isSelf` guard disables Approve button; QueueDetailPane.tsx:85 mirrors guard |
| 5 | FDA off-label/DSHEA disclaimer in `/knowledge/*` footers | PASS | All three knowledge pages render `t('fda_off_label_full')` in `<footer>` |
| 6 | Tier badge neutral-only | PASS | TierBadge (admin) uses bg-surface-elevated/bg-surface-soft/bg-cream-200; KnowledgeTierBadge imported in knowledge pages (not verified in this audit but consistent pattern) |
| 7 | Freshness indicator rules | PASS | KnowledgeArticleDetailPage.tsx:60 `getFreshnessState()` implements <6mo/6mo-2yr/>2yr tiers correctly |
| 8 | `leanshot_research` visually distinct in popover | PASS | CitationPopover.tsx:302 renders disclosure line when `source_type === 'leanshot_research'` |
| 9 | Newsletter opt-in unchecked by default | PASS | NewsletterOptInStep.tsx controlled from parent; NewsletterSettings.tsx:49 `draftOptedIn = false` initial state |
| 10 | No horizontal scroll ≥375px; tap targets | PARTIAL-FLAG | No explicit min-h/min-w ≥44px enforcement on row items; citation marker 24px tap target verified |
| 11 | Typography 4-size ceiling | BLOCK | 5 violations found (see Pillar 4 detail) |

---

## Top 5 Priority Fixes

1. **Knowledge pages use undefined @theme color tokens** — `text-text-primary`, `bg-surface-card`, `border-border-subtle`, `text-accent`, `bg-warning-subtle`, `text-warning-foreground` do not exist in `src/index.css @theme`, meaning they resolve to `transparent`/no-op in Tailwind v4. These span KnowledgeRootPage, KnowledgeTopicIndexPage, KnowledgeArticleDetailPage, and KnowledgeBreadcrumb. Fix: replace every instance with the actual canonical token — `text-text` (not `text-text-primary`), `bg-surface` (not `bg-surface-card`), `border-border` (not `border-border-subtle`), `text-primary` (not `text-accent`), `bg-danger-soft text-danger` (not `bg-warning-subtle text-warning-foreground`).

2. **Typography ceiling breached in 6 components** — RefusalCard uses `text-[14px]`, CitationPopover uses `text-[15px]` and `text-[12px]`, SourcesFooter uses `text-[12px]`, NewsletterOptInStep uses `text-[26px] font-bold`, KnowledgeTopicIndexPage uses `text-base` on article card titles. Phase 69 CI gate will block these. Fix: normalize all to 11/13/18/28px only using `text-micro`/`text-[11px]`, `text-sm`/`text-[13px]`, `text-lg`/`text-[18px]`, `text-heading`/`text-[28px]`. Replace `text-[26px]` with `text-heading` and replace `font-bold` with `font-semibold`. Replace `text-base` at KnowledgeTopicIndexPage.tsx:270 with `text-[18px]` or `text-lg`.

3. **Approve toast missing `· Undo` affordance** — UI-SPEC §Admin Curation Queue states approved toast must be `Approved · Undo` with 5-second undo window. RagQueuePage.tsx:155 fires `showToast('Approved', 'success')` — no undo. Fix: implement a 5s timer with `onUndo` callback that re-inserts the row and calls a reversal RPC, passing the action to `showToast('Approved · Undo', 'success', { onAction: handleUndo, actionLabel: 'Undo', durationMs: 5000 })`.

4. **`font-medium` (weight 500) used in 5 places** — Spec allows only 400 (regular) and 600 (semibold). `font-medium` (500) appears in CitationPopover.tsx:313 (`Open source` link), SourcesFooter.tsx:106 (source name span), TipOfTheDayCard.tsx:140 (eyebrow), KnowledgeRootPage.tsx:188 (`Read more` button), NewsletterSettings.tsx:129 (toggle label). Fix: change all to `font-normal` (400) or `font-semibold` (600) per semantic role.

5. **`EXTRACTED QUOTE` label in QueueDetailPane uses accent color** — QueueDetailPane.tsx:209 applies `text-[var(--color-primary)]` to the `EXTRACTED QUOTE` eyebrow label. UI-SPEC §1 reserves accent for specific interactive elements only (CTAs, active pills, citation badge). A non-interactive label is not on the reserved list. Fix: change to `text-[var(--color-text-tertiary)]` to match the `SOURCE TEXT` label on the opposite panel.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**PASS items:**
- Empty state copy in admin queue: `Queue clear` + verbatim body — PASS (RagQueuePage.tsx:307-309)
- Error state copy: `Failed to load queue. Refresh to try again.` — PASS (RagQueuePage.tsx:111/300)
- Refusal copy: PHARMA-02, out_of_corpus, citation_validation_failed all routed via i18n — PASS
- `Approved · Undo` copy — MISSING (see below)
- RetractChunkModal body copy verbatim: PASS (RetractChunkModal.tsx:47)
- RetractChunkModal actions `Keep chunk` / `Retract chunk` — PASS
- FDA disclaimer present on all three `/knowledge/*` pages — PASS
- Subscribe CTA `Subscribe to digest` — PASS (KnowledgeRootPage.tsx:229)
- Subscribe success copy — exact match with spec (KnowledgeRootPage.tsx:212)

**FLAG — Toast missing Undo:**
- `RagQueuePage.tsx:155` — `showToast('Approved', 'success')` — spec requires `"Approved · Undo"` with a 5s undo affordance per UI-SPEC §Admin Curation Queue copywriting contract
- `RagQueuePage.tsx:155` also does not attempt undo state restoration

**FLAG — Newsletter error copy drift:**
- `KnowledgeRootPage.tsx:238` — `"Something went wrong. Please try again."` — spec requires `"Something went wrong. Try again in a moment."` (note: spec has `in a moment`; implementation omits it)

**FLAG — Save preferences CTA delegated to i18n key `rag:newsletter.save_cta`:**
- Cannot verify if the resolved string exactly matches `"Save preferences"` without the locale JSON. Flagged for human verification.

**PASS — Onboarding:**
- `NewsletterOptInStep.tsx:35` uses i18n key for the step header, not hardcoded copy — structure correct, pending locale verification.
- Default unchecked state enforced — PASS.

---

### Pillar 2: Visuals (3/4)

**PASS items:**
- Visual hierarchy is present across admin surfaces via size/weight differentiation (18px headings, 13px body, 11px meta)
- Icon-only buttons have `aria-label` throughout (Reject chunk, Show another tip, Close citation, reject icon in queue row)
- Modal/Sheet overlays: `role="dialog"` + `aria-modal="true"` confirmed on CitationPopover.tsx:334-335, Sheet primitive (inherited), Modal primitive (inherited)
- `useReducedMotion()` gates skeleton shimmer (TipOfTheDayCard.tsx:123), popover animation (CitationPopover.tsx:338-340), topic card transitions (KnowledgeRootPage.tsx:146)
- Refusal card visually distinct (flat card + icon, no citation markers) — PASS

**FLAG — `EXTRACTED QUOTE` label accent color misuse:**
- `QueueDetailPane.tsx:209` — `text-[var(--color-primary)]` on non-interactive eyebrow label `EXTRACTED QUOTE`. The parallel label `SOURCE TEXT` at line 197 correctly uses `text-[var(--color-text-tertiary)]`. This creates false visual weight on a label element. Severity: WARNING.

**FLAG — `Retract chunk` button not in original UI-SPEC action row spec:**
- The UI-SPEC §1 action row specifies `Reject chunk` (secondary) · `Edit & approve` (ghost) · `Approve chunk` (primary). `QueueDetailPane.tsx:259` adds a `Retract chunk` ghost button with `text-[var(--color-danger)]` styling via the optional `onRetract` prop. This is a scope addition, not necessarily wrong, but is out-of-spec and could confuse moderators about when retract vs reject is appropriate. Advisory.

**FLAG — TipOfTheDayCard reroll button permanently disabled:**
- `TipOfTheDayCard.tsx:146-154` — reroll `RotateCcw` button is rendered with `disabled` + `aria-disabled="true"` + `opacity-40`. While the comment notes this is a placeholder, a disabled button with no tooltip explaining why it is disabled creates a confusing interaction. The UI-SPEC shows this as a functioning button. Advisory.

---

### Pillar 3: Color (2/4)

**BLOCKER — Knowledge pages use ~8 undefined @theme color tokens:**

`src/index.css @theme` block does not define `--color-text-primary`, `--color-surface-card`, `--color-border-subtle`, `--color-accent`, `--color-warning-subtle`, `--color-warning-foreground`. In Tailwind v4, undefined tokens resolve to transparent/no-op.

Affected usages:
- `KnowledgeRootPage.tsx:119,135,144,150,153,165,167,172,175,188,199,202,206,211` — `text-text-primary`, `text-text-secondary`, `bg-surface-card`, `border-border-subtle`, `text-accent`, `text-success`
- `KnowledgeTopicIndexPage.tsx:138,155,232,270,273,276,285` — `text-text-primary`, `text-text-secondary`, `text-accent`, `border-border-subtle`, `bg-surface-elevated`, `text-xs text-text-tertiary`
- `KnowledgeArticleDetailPage.tsx:213,218,224,231,238,248,261,277,280,295` — `text-text-primary`, `text-text-secondary`, `bg-warning-subtle`, `text-warning-foreground`
- `KnowledgeBreadcrumb.tsx` (imported by ArticleDetailPage) — same pattern

Canonical replacements:
- `text-text-primary` → `text-text` (--color-text)
- `text-text-secondary` → `text-text-secondary` (this one EXISTS — --color-text-secondary is defined)
- `text-text-tertiary` → `text-text-tertiary` (this one EXISTS)
- `bg-surface-card` → `bg-surface` (--color-surface)
- `border-border-subtle` → `border-border` (--color-border)
- `text-accent` → `text-primary` (--color-primary)
- `bg-warning-subtle` → `bg-danger-soft` or `bg-warning-soft` (not present; use `bg-[var(--color-rose-soft)]`)
- `text-warning-foreground` → `text-danger`
- `text-success` → `text-[var(--color-success)]`
- `text-danger` → `text-[var(--color-danger)]` (or `text-danger` if that token resolves — needs verification)

**NOTE:** `text-text-secondary` and `text-text-tertiary` ARE valid — `--color-text-secondary` and `--color-text-tertiary` exist in @theme. The pattern `text-text-secondary` (Tailwind v4 generates `text-{color-name}` from `--color-{color-name}`) is valid for these two. The broken ones are specifically `text-text-primary` and `text-text` disambiguation.

**FLAG — Accent overuse on non-reserved element:**
- `QueueDetailPane.tsx:209` — `text-[var(--color-primary)]` on non-interactive `EXTRACTED QUOTE` eyebrow label (reported under Visuals as well)
- `KnowledgeRootPage.tsx:188` — `text-accent` on `Read more →` link (token undefined; would be transparent)

**PASS — No ad-hoc hex values** in any Phase 60 file (knowledge pages use class tokens, admin/AI files use `var(--color-*)` CSS variable references).

**PASS — Dark mode via semantic tokens** — all admin/AI components use `var(--color-*)` CSS custom properties which honor the `[data-theme="dark"]` overrides in index.css.

---

### Pillar 4: Typography (2/4)

UI-SPEC ceiling: ONLY 11/13/18/28px. Only weights 400 and 600.

**BLOCK — Out-of-spec sizes found:**

| File | Line | Value | Spec Violation |
|------|------|-------|----------------|
| `CitationPopover.tsx` | 264 | `text-[15px]` | Not in {11,13,18,28} |
| `CitationPopover.tsx` | 283 | `text-[12px]` | Not in {11,13,18,28} |
| `SourcesFooter.tsx` | 79,100 | `text-[12px]` | Not in {11,13,18,28} |
| `RefusalCard.tsx` | 69 | `text-[14px]` | Not in {11,13,18,28} |
| `KnowledgeTopicIndexPage.tsx` | 270 | `text-base` | 16px — explicitly forbidden |
| `NewsletterOptInStep.tsx` | 35 | `text-[26px]` | Not in {11,13,18,28}; use `text-heading` (28px) |

**BLOCK — Out-of-spec weights found:**

| File | Line | Value | Spec Violation |
|------|------|-------|----------------|
| `CitationPopover.tsx` | 313 | `font-medium` | Weight 500, not in {400,600} |
| `SourcesFooter.tsx` | 106 | `font-medium` | Weight 500, not in {400,600} |
| `TipOfTheDayCard.tsx` | 140 | `font-medium` | Weight 500, not in {400,600} |
| `KnowledgeRootPage.tsx` | 188 | `font-medium` | Weight 500, not in {400,600} |
| `NewsletterSettings.tsx` | 129 | `font-medium` | Weight 500, not in {400,600} |
| `NewsletterOptInStep.tsx` | 35 | `font-bold` | Weight 700, not in {400,600} |

**PASS items:**
- `text-heading` token correctly added to `src/index.css @theme` line 107: `--text-heading: 1.75rem; /* 28px */`
- `text-heading` used exclusively on `/knowledge` root H1 (KnowledgeRootPage.tsx:119) and `/knowledge/<topic>` index H1 (KnowledgeTopicIndexPage.tsx:155) — PASS
- `/knowledge/<topic>/<slug>` detail page H1 uses `text-lg` (KnowledgeArticleDetailPage.tsx:213) — correct, NOT Fraunces — PASS
- `font-display italic` Fraunces correctly applied to only those two H1s — PASS
- Admin and AI components consistently use `text-[11px]`/`text-[13px]`/`text-[18px]` — PASS

---

### Pillar 5: Spacing (3/4)

**PASS — Documented exceptions:**
- `CitationMarker.tsx:40` — `p-[5px]` tap-target exception explicitly documented per UI-SPEC §Spacing Scale exception note — PASS

**FLAG — Undocumented arbitrary values beyond 4-scale:**
- `CitationMarker.tsx:50` — `h-[14px]` on badge inner span (14 is not a multiple of 4). The badge pixel dimension comes from the design contract (14px visible badge). Advisory: could use `h-3.5` (14px via Tailwind standard) if the spacing scale base is 0.25rem = 1px per unit.
- `CitationMarker.tsx:52` — `px-[2px]` (2px not a multiple of 4). Advisory for touch padding on inner badge span.
- `QueueDetailPane.tsx:249` — `min-w-[1.5rem]` on kbd chips (24px, multiple of 4 — acceptable).
- `h-7`, `h-9` used in several places — these are Tailwind scale (28px, 36px) — not 4-scale multiples without using `--spacing` base. In Tailwind v4 with `--spacing: 0.25rem`, h-7 = 1.75rem = 28px and h-9 = 2.25rem = 36px. Both are multiples of 4px — PASS.

**PASS — Standard spacing scale respected** across admin queue components, federated rows, cost dashboard.

**FLAG — KnowledgeArticleDetailPage.tsx:207** — outer layout uses `lg:gap-8` (2rem = 32px, within spec as 8×4px) — PASS. `space-y-6` (24px), `space-y-3` (12px), `pt-6` (24px) — all multiples of 4 — PASS.

---

### Pillar 6: Experience Design (3/4)

**PASS items:**
- Loading states present: skeleton in TipOfTheDayCard, CitationPopover shows pulse animation during load, RagQueuePage shows 3-item skeleton placeholder
- Error states present: RagQueuePage error message at line 300, CitationPopover error state at line 242-249, KnowledgeRootPage has error for newsletter subscribe
- Empty states: RagQueuePage EmptyState component with CheckCheck icon, KnowledgeTopicIndexPage EmptyState for filtered results
- Destructive confirmation: RetractChunkModal requires `reason` textarea before Retract chunk enables
- Focus trap + return focus on close: CitationPopover.tsx:142-148 (explicit `requestAnimationFrame` return focus)
- 2-person rule blocking: Approve button disabled via `aria-disabled` + `disabled` when self-authored
- `aria-busy` on Approve button during RPC flight (QueueDetailPane.tsx:286)
- Optimistic update pattern in RagQueuePage with rollback on error — PASS
- `useReducedMotion()` gating animation on all animated surfaces — PASS

**FLAG — Approve toast has no Undo:**
- The `Approved` toast at RagQueuePage.tsx:155 lacks the 5s undo affordance defined in UI-SPEC. This is both a Copywriting and Experience Design defect. The row is already removed optimistically; without undo, accidental approvals of Tier-B content by the wrong reviewer are irreversible in the UI.

**FLAG — `Pull full history` disabled with no user feedback:**
- FederatedSourceRow.tsx:167 renders the button as `disabled` with a `title` attribute tooltip (browser hover only). The spec says the button should trigger a confirmation dialog. Until 60-15 ships, disabling it is the correct deferral choice, but the title tooltip is not accessible on mobile and gives no visible indication of when/why this feature is coming. Advisory: add a small `(coming soon)` text label or replace `disabled` with a visible caption.

**FLAG — KnowledgeRootPage fails silently on data load:**
- KnowledgeRootPage.tsx:63-76 — `listTopics()` and `getFeaturedChunk()` both have a catch block that runs `fail-soft: render with empty state`. There is no error state rendered to the user when topics fail to load — the grid simply shows empty. This violates the spirit of "surface errors to users" even if technically an advisory.

---

## Registry Safety

Registry audit: shadcn not initialized (no `components.json`). No third-party component registries declared in UI-SPEC. Registry safety gate not applicable.

---

## Files Audited

**Admin RAG surfaces:**
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RagQueuePage.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/QueueDetailPane.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RejectReasonSheet.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RetractChunkModal.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/QueueKeyboardHelpModal.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/FederatedSourcesPage.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/FederatedSourceRow.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RagCostPage.tsx`

**AI-coach surfaces:**
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/CitationMarker.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/CitationPopover.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/SourcesFooter.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/RefusalCard.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/AIChatPanel.tsx` (partial — fence verification only)

**Dashboard cards:**
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx`

**Knowledge hub:**
- `/Users/karstenhaldan/minisite/leanshot/src/components/knowledge/KnowledgeRootPage.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/knowledge/KnowledgeTopicIndexPage.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/knowledge/KnowledgeArticleDetailPage.tsx`

**Newsletter/Onboarding:**
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/NewsletterSettings.tsx`
- `/Users/karstenhaldan/minisite/leanshot/src/components/onboarding/steps/NewsletterOptInStep.tsx`

**Design system reference:**
- `/Users/karstenhaldan/minisite/leanshot/src/index.css` (token verification)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/rag/i18n.ts` (copy key verification)
