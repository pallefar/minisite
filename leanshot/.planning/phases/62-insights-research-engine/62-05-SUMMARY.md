---
phase: 62-insights-research-engine
plan: 05
subsystem: admin-research-ui
tags: [research, publications, 2-person-review, admin-ui, typescript]
dependency_graph:
  requires: [62-01, 62-02]
  provides: [ResearchPublication type, PublicationsListPage, PublicationEditorPage, ResearchReviewBanner, PublicationStatusBadge, ResearchKeyboardHelpModal]
  affects: [62-06, 62-08]
tech_stack:
  added: []
  patterns: [verbatim-mirror-protocol, 2-person-review-dom-gate, @theme-token-audit, typography-ceiling]
key_files:
  created:
    - leanshot/src/types/research.ts
    - leanshot/src/components/admin/research/ResearchReviewBanner.tsx
    - leanshot/src/components/admin/research/PublicationStatusBadge.tsx
    - leanshot/src/components/admin/research/ResearchKeyboardHelpModal.tsx
    - leanshot/src/components/admin/research/PublicationsListPage.tsx
    - leanshot/src/components/admin/research/PublicationEditorPage.tsx
  modified: []
decisions:
  - "isSelfCreated conditional render (not disabled) enforces 2-person rule at UI layer (layer 2 of 3)"
  - "ResearchReviewBanner is verbatim mirror of ProtocolReviewBanner — changed only component/prop names and button label"
  - "handlePublish checks both SELF_REVIEW_REJECTED substring AND code=42501 to match Protocol analog pattern"
  - "SELF_REVIEW_REJECTED toast copy from UI-SPEC: 'Another admin must review this publication before publish.'"
  - "Archive modal CTA uses UI-SPEC copy: 'Archive publication' (not 'Archive')"
  - "@theme token audit scoped to admin/research/* only (WARNING 6 per plan constraint)"
  - "node_modules symlink created in worktree for tsc; not committed (gitignored)"
metrics:
  duration_mins: 30
  completed_date: "2026-05-26"
  tasks: 3
  files_created: 6
  files_modified: 0
---

# Phase 62 Plan 05: Admin Publications + Editor + Canonical Types Summary

**One-liner:** White-paper authoring pipeline with 2-person review UI — 6 files: canonical ResearchPublication type + 5 admin research components with RPC wiring, DOM-gated publish button, and @theme token audit.

---

## Objective

Ship the white-paper authoring + 2-person review admin surface: canonical type module consumed by both admin and public hub, plus 5 component files implementing PublicationsListPage, PublicationEditorPage, and 3 small mirror components.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 0 | Canonical ResearchPublication type export | `ece1568d` | `leanshot/src/types/research.ts` |
| 1 | ResearchReviewBanner + PublicationStatusBadge + ResearchKeyboardHelpModal | `5147f29b` | 3 new files under `src/components/admin/research/` |
| 2 | PublicationsListPage + PublicationEditorPage | `a4e5b443` | 2 new files under `src/components/admin/research/` |

---

## 2-Person Review Layer Summary

Layer 1 (DB): `publish_research` SECDEF RPC raises `SELF_REVIEW_REJECTED` when `actor_id = created_by` (Plan 62-02 Task 2).

Layer 2 (UI): `isSelfCreated = currentUserId === publication.created_by` → `<ResearchReviewBanner isAuthor={true}>` renders author view with NO Publish button. The button is entirely absent from the rendered DOM — not disabled+hidden. This is explicit in `PublicationEditorPage.tsx` via a code comment explaining the 3-layer invariant.

Layer 3 (CI): Smoke test in Plan 62-02 asserts no element with text 'Publish Research' when current user is author.

---

## RPC Wire-Up Confirmations

| RPC | File | Handler |
|-----|------|---------|
| `submit_research_for_review` | `PublicationEditorPage.tsx` | `handleSubmitReview()` |
| `publish_research` | `PublicationEditorPage.tsx` | `handlePublish()` |
| `archive_research` | `PublicationEditorPage.tsx` | `handleArchiveConfirm()` |

`SELF_REVIEW_REJECTED` toast: "Another admin must review this publication before publish." (exact UI-SPEC copy, substring match on rpcError.message or code === '42501').

---

## @theme Tokens Used (audit scope: admin/research/PublicationsListPage + PublicationEditorPage)

| Token | Purpose |
|-------|---------|
| `--color-admin-table-row-hover` | Row hover state in publications list |
| `--color-border` | Table separators, inputs, card borders |
| `--color-danger` | Archive link, error messages |
| `--color-primary` | Focus ring, title link, Submit CTA |
| `--color-surface` | Card + input backgrounds |
| `--color-surface-elevated` | Loading skeleton, metadata panel, DP data panel |
| `--color-text-secondary` | Meta labels, slug, dates |
| `--color-text-tertiary` | Missing data dashes, path display |

All 8 tokens confirmed defined in `src/index.css @theme` via Python audit script.

Additional tokens in ResearchReviewBanner/PublicationStatusBadge/ResearchKeyboardHelpModal (Task 1):
- `--color-rose-soft` (banner background)
- `--color-warning` (banner text + icon)
- `--color-surface-elevated`, `--color-border`, `--color-text-secondary` (keyboard modal)

---

## Typography Ceiling

Enforced per Phase 60 BLOCKER lesson. Zero violations of banned utilities (text-base, text-lg, text-md, text-sm, text-xl, text-2xl) in List + Editor pages. Audit gate: `grep | wc -l` count = 0.

Sizes used: `text-[11px]` (meta/caption), `text-[13px]` (body/default), `text-[18px]` (section headings), `text-heading` (page H1 in new-publication form).

Weights used: `font-normal` (400, body copy), `font-semibold` (600, headings/CTAs). No font-medium, font-bold, or numeric weight classes.

---

## Key Lines Counts

| File | Lines | Min Required |
|------|-------|-------------|
| PublicationsListPage.tsx | 360 | 200 ✓ |
| PublicationEditorPage.tsx | 547 | 300 ✓ |
| ResearchReviewBanner.tsx | ~65 | 50 ✓ |

---

## Deviations from Plan

None - plan executed exactly as written.

Auto-fix note: Pre-existing TypeScript errors in `src/admin/modules/` (separate feature module path with missing React declarations) are out of scope — not caused by this plan's changes. Confirmed zero errors in `src/components/admin/research/*` path.

---

## Known Stubs

None. All RPC wires call real Supabase functions deployed in Plan 62-02. `reviewerName` defaults to `undefined` (will render as 'reviewer' in banner) until a profiles-lookup feature adds reviewer display names in a future plan.

---

## Threat Flags

No new trust boundaries introduced beyond those in the plan's `<threat_model>`. All mitigations applied:
- T-62-05-01: DOM gate implemented (isAuthor conditional render)
- T-62-05-05: SELF_REVIEW_REJECTED literal substring match present

---

## Self-Check: PASSED

Files created:
- leanshot/src/types/research.ts: FOUND
- leanshot/src/components/admin/research/ResearchReviewBanner.tsx: FOUND
- leanshot/src/components/admin/research/PublicationStatusBadge.tsx: FOUND
- leanshot/src/components/admin/research/ResearchKeyboardHelpModal.tsx: FOUND
- leanshot/src/components/admin/research/PublicationsListPage.tsx: FOUND
- leanshot/src/components/admin/research/PublicationEditorPage.tsx: FOUND

Commits:
- ece1568d: feat(62-05): canonical ResearchPublication type + ResearchPublicationStatus
- 5147f29b: feat(62-05): ResearchReviewBanner + PublicationStatusBadge + ResearchKeyboardHelpModal
- a4e5b443: feat(62-05): PublicationsListPage + PublicationEditorPage (2-person review + state machine)
