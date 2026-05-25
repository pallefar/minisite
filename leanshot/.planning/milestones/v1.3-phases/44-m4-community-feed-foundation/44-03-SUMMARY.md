---
phase: 44
plan: "03"
subsystem: community-feed
tags: [community, dompurify, tier-gate, storage, mention-parse, xss-defense, unit-tests]
dependency_graph:
  requires: []
  provides:
    - leanshot/src/lib/community/community-types.ts
    - leanshot/src/lib/community/dompurify-config.ts
    - leanshot/src/lib/community/tier-gate.ts
    - leanshot/src/lib/community/community-storage.ts
    - leanshot/src/lib/community/mention-parse.ts
  affects:
    - 44-06 (CommunityPost imports sanitizeCommunityMarkdown + renderPostBodyHtml)
    - 44-07 (CommunityPostComposer imports parseMentions)
    - 44-08 (CommunityImageUploader imports uploadCommunityMedia + assertImageCap)
    - 44-09 (SpaceList imports canAccessSpace + readTierLabel)
tech_stack:
  added: []
  patterns:
    - "DOMPurify explicit allowlist (no USE_PROFILES) — fork of helpdesk KBArticleView.tsx pattern"
    - "afterSanitizeAttributes hook for forced target=_blank + rel=noopener + non-http(s) href strip"
    - "page-assets.ts upload pattern (size check → MIME check → upload, typed Result)"
    - "tier_effective view read via supabase-js .single() with 'free' default"
key_files:
  created:
    - leanshot/src/lib/community/community-types.ts
    - leanshot/src/lib/community/dompurify-config.ts
    - leanshot/src/lib/community/tier-gate.ts
    - leanshot/src/lib/community/community-storage.ts
    - leanshot/src/lib/community/mention-parse.ts
    - leanshot/tests/unit/community-dompurify-config.test.ts
    - leanshot/tests/unit/community-mention-parse.test.ts
    - leanshot/tests/unit/community-post-tombstone.test.ts
    - leanshot/tests/unit/community-image-cap.test.ts
  modified: []
decisions:
  - "Trial tier included in isVideoAllowed (returns true) per Claude's Discretion — trial users get Pro-equivalent video upload during evaluation period, consistent with Phase 43 trial precedent"
  - "ALLOWED_ATTR includes 'href' (not empty []) so afterSanitizeAttributes hook can strip non-http(s) hrefs — DOMPurify strips the attr if [] before hook fires"
  - "community-types.ts is a standalone pure-types file (no imports) per CLAUDE.md naming: src/types/ barrel is for app-wide types; community-specific types live with the lib"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-23T06:25:41Z"
  tasks_completed: 2
  files_created: 9
  tests_added: 40
---

# Phase 44 Plan 03: Community Types + DOMPurify Config + Tier Gate + Storage + Mention Parse Summary

Wave 0 client-side foundation: 5 utility libs + 4 unit test files proving XSS defense (T-44-05), 10-image cap (COMMUNITY-04), mention code-fence stripping (Pitfall 3), and trial=Pro tier access (Claude's Discretion).

## What Was Built

### 5 Library Files

**`leanshot/src/lib/community/community-types.ts`**
Pure-types file (no imports, no runtime code). Exports all 7 domain interfaces locked for downstream plans 44-06 through 44-09: `CommunitySpace`, `CommunityPost`, `CommunityComment`, `CommunityReaction`, `CommunityPostMedia`, `ReactionEmoji`, `TierLabel`.

**`leanshot/src/lib/community/dompurify-config.ts`**
Forked from `src/helpdesk/KBArticleView.tsx` line 66. Key differences:
- Explicit `ALLOWED_TAGS` allowlist (no `USE_PROFILES: { html: true }` — T-44-05)
- `FORBID_TAGS: ['img','script','iframe','style','object','embed','base','form']` — blocks all XSS vectors and D-10 inline image prohibition
- `ALLOWED_ATTR: ['href']` — keeps hrefs for the hook to validate
- `afterSanitizeAttributes` hook: forces `target=_blank` + `rel="noopener noreferrer"` on all anchors AND removes non-http(s) hrefs (defense-in-depth vs `javascript:`, `data:`, `vbscript:`)
- `renderPostBodyHtml(post)`: returns `<em>[deleted]</em>` literal when `deleted_at !== null` (D-15 tombstone), otherwise `sanitizeCommunityMarkdown(body)`

**`leanshot/src/lib/community/tier-gate.ts`**
- `readTierLabel(userId)`: reads `tier_effective.tier_label`, defaults to `'free'`
- `isVideoAllowed(tier)`: returns `true` for `'pro' | 'lifetime' | 'trial'` (Claude's Discretion — trial gets Pro video access during evaluation period)
- `canAccessSpace(spaceTier, userTier)`: free=all; pro=pro/lifetime/trial; lifetime=lifetime only

**`leanshot/src/lib/community/community-storage.ts`**
- `COMMUNITY_MEDIA_BUCKET = 'community-media'`
- `uploadCommunityMedia(file, userId, postId)`: validates size (10 MB) → MIME (jpeg/png/webp, no SVG) → uploads with path `${userId}/${postId}/${crypto.randomUUID()}.${ext}` (RLS-safe prefix)
- `getCommunityMediaSignedUrl(path)`: 3600s TTL (60 min per D-04)
- `assertImageCap(currentCount)`: returns `image_cap_reached` when `currentCount >= 10` (COMMUNITY-04 client-side gate)

**`leanshot/src/lib/community/mention-parse.ts`**
- `parseMentions(rawMarkdown)`: strips fenced code blocks (`` ``` ``...`` ``` ``), strips inline code (`` ` ``...`` ` ``), applies `/@([a-z0-9_]{3,30})\b/gi`, lowercases, deduplicates (first-occurrence order)
- Pitfall 3 mitigation: code blocks stripped before regex prevents false positives from `@mentions` inside code examples

### 4 Unit Test Files (40 tests, all green)

| File | Tests | Coverage |
|------|-------|----------|
| `community-dompurify-config.test.ts` | 7 | XSS defense: `<script>`, `<img>`, `javascript:`, `<iframe>`, `<style>` stripped; https href preserved with target/rel |
| `community-post-tombstone.test.ts` | 4 | Tombstone: `deleted_at` set → `<em>[deleted]</em>`; null → sanitized body |
| `community-mention-parse.test.ts` | 13 | Mentions: lowercase, dedup, `@@user`, `@user.`, code fence strip, length bounds (3–30), empty string |
| `community-image-cap.test.ts` | 17 | Tier gate (8 cases: all tiers for isVideoAllowed + canAccessSpace matrix); storage (6 cases: size reject, SVG reject, jpeg ok with path check, cap tests) |

## Decisions Made

1. **Trial tier in `isVideoAllowed`**: Trial users gain `isVideoAllowed=true` per Phase 44 planning context Claude's Discretion. This matches Phase 43's precedent where trial users get Pro-equivalent features during their evaluation period. Documented in source comment in `tier-gate.ts`.

2. **`ALLOWED_ATTR: ['href']` not `[]`**: DOMPurify strips attributes before firing `afterSanitizeAttributes`. Setting `ALLOWED_ATTR: []` would remove `href` before the hook runs, preventing the hook from stripping `javascript:` links. The hook enforces the real constraint (only `http://` or `https://` survive).

3. **`community-types.ts` as standalone lib file** (not merged into `src/types/index.ts`): CLAUDE.md naming conventions show `src/types/index.ts` as the app-wide barrel for core domain types (User, Injection, etc.). Community types are Phase 44-specific and consumed by `@/lib/community/*` — co-locating them in `src/lib/community/` matches the naming convention for feature-specific types (e.g., `src/lib/gamification/`, `src/lib/analytics/`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ALLOWED_ATTR: []` prevented href from reaching afterSanitizeAttributes hook**
- **Found during:** Task 1 GREEN phase test run
- **Issue:** The test for `https://` href preservation failed — DOMPurify stripped `href` before the hook ran, leaving the anchor without its URL
- **Fix:** Changed `ALLOWED_ATTR: []` to `ALLOWED_ATTR: ['href']` so the hook receives the attribute and can validate/remove it
- **Files modified:** `leanshot/src/lib/community/dompurify-config.ts`
- **Commit:** 0d37086 (amended during same task)

**2. [Rule 1 - Bug] Comment in dompurify-config.ts matched the `USE_PROFILES.*html: true` grep verification check**
- **Found during:** Task 2 post-commit verification
- **Issue:** Comment `Helpdesk uses \`USE_PROFILES: { html: true }\`` triggered the plan's grep check `grep -r "USE_PROFILES.*html: true" src/lib/community/`
- **Fix:** Rewrote comment as `Helpdesk uses USE_PROFILES with html=true (permissive for staff — do NOT replicate here)`
- **Files modified:** `leanshot/src/lib/community/dompurify-config.ts`
- **Commit:** 0665545

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. This plan ships pure client-side TypeScript utilities. `readTierLabel` and `uploadCommunityMedia` call Supabase client APIs already used project-wide — no new trust boundaries.

Threat mitigations as designed:
- **T-44-05** (XSS): proven by 7 `community-dompurify-config.test.ts` test cases
- **T-44-04** (storage path traversal): `userId` prefix enforced in `uploadCommunityMedia` path construction
- **T-44-06** (mention spam): `parseMentions` deduplicates via `Set`; authoritative gate is DB PK

## Self-Check: PASSED

All 9 expected files exist on disk. Both task commits (`0d37086`, `0665545`) confirmed in git log. All 40 tests pass under `npx vitest run`. `npx tsc --noEmit` reports no errors for `src/lib/community/*`.
