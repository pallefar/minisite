---
phase: 44
plan: "02"
subsystem: notifications
tags:
  - migration
  - notification
  - email-router
  - community
  - wave-0
dependency_graph:
  requires:
    - "44-01 (community schema tables must exist before migration push)"
  provides:
    - "44-05 (notify-community): safe to use category='community-mentions' and 'community-replies'"
    - "44-10 (deploy): migration ready for supabase db push --linked"
  affects:
    - "notification-send Edge Fn VALID_CATEGORIES set"
    - "email-router EmailTemplate union + subjectFor + renderTemplate dispatch"
    - "notification-types.ts Category union"
tech_stack:
  added:
    - "email-templates/community-mention.ts — new HTML email template"
    - "email-templates/community-reply.ts — new HTML email template"
  patterns:
    - "CHECK constraint atomic widening (feedback_planner_missed_status_enum_widening)"
    - "UPSERT seed pattern (reference_state_counter_table_needs_upsert_on_event)"
    - "email-router union + subjectFor + renderTemplate in same commit"
key_files:
  created:
    - supabase/migrations/20270720000004_p44_notification_community.sql
    - supabase/functions/_shared/email-templates/community-mention.ts
    - supabase/functions/_shared/email-templates/community-reply.ts
  modified:
    - supabase/functions/_shared/email-router.ts
    - supabase/functions/_shared/notification-types.ts
    - supabase/functions/notification-send/index.ts
decisions:
  - "Used import * as communityMention pattern (not import { communityMentionTemplate }) to match existing email-router convention — all existing templates use wildcard namespace imports"
  - "Widened Category type in notification-types.ts alongside VALID_CATEGORIES (TypeScript correctness requirement — omitting this would cause type errors)"
  - "email-templates/ directory used (not a new templates/ directory) — existing project pattern"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-23T06:24:04Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 3
  files_modified: 3
---

# Phase 44 Plan 02: Notification CHECK Widening + Email Router + VALID_CATEGORIES Summary

**One-liner:** Atomic widening of 4 Postgres CHECK constraints to accept `community-mentions` and `community-replies`, with email-router union extension + 2 HTML templates + VALID_CATEGORIES update in same commit.

## What Was Built

This plan closes the Phase 44 HARD BLOCKER from RESEARCH §3.1: the `notify-community` Edge Fn (plan 44-05) calls `notification-send` with `category='community-mentions'`, which would trigger a Postgres CHECK constraint violation without this migration. All 5 file changes landed in a single atomic commit per `feedback_planner_missed_status_enum_widening`.

### Migration: `20270720000004_p44_notification_community.sql`

- Widens 4 CHECK constraints atomically in one `BEGIN ... COMMIT` transaction:
  - `notification_settings_category_chk`
  - `notification_category_config_category_chk`
  - `user_notifications_category_chk`
  - `notification_dismissal_state_category_chk`
- Original 5 categories + `community-mentions` + `community-replies` = 7 total
- Seeds 2 `notification_category_config` rows via UPSERT:
  - `community-mentions`: `daily_cap=20`, `email_enabled_default=true` (Skool parity, D-14)
  - `community-replies`: `daily_cap=20`, `email_enabled_default=false` (conservative D-14 fan-out)

### Email Router: `email-router.ts`

- `EmailTemplate` union extended: `| 'community_mention'` and `| 'community_reply'`
- `subjectFor` switch: delegates to `communityMention.subject(vars)` / `communityReply.subject(vars)`
- `renderTemplate` switch: delegates to `communityMention.render(vars)` / `communityReply.render(vars)`
- Imports added: `import * as communityMention from './email-templates/community-mention.ts'` and `import * as communityReply from './email-templates/community-reply.ts'`

### Templates

**`email-templates/community-mention.ts`:**
- Variables: `mentioned_by`, `space_name`, `post_excerpt` (server-truncated to 200 chars), `post_url`
- Subject: `"{mentioned_by} mentioned you in {space_name}"`
- HTML-escaped vars (T-44-05 XSS defense)
- CTA: "View the post" button linking to `post_url`
- Unsubscribe footer linking to `/settings/notifications`

**`email-templates/community-reply.ts`:**
- Variables: `commenter_name`, `post_excerpt`, `comment_excerpt`, `post_url`
- Subject: `"New reply on your post"`
- HTML-escaped vars (T-44-05 XSS defense)
- Visual distinction: original post in light blockquote, reply in darker blockquote
- Unsubscribe footer linking to `/settings/notifications`

### Notification Send: `notification-send/index.ts`

- `VALID_CATEGORIES` Set extended with `'community-mentions'` and `'community-replies'`
- Both values match the DB CHECK constraint values exactly (hyphenated `community-*`)

### Notification Types: `notification-types.ts`

- `Category` type union widened with `| 'community-mentions'` and `| 'community-replies'`
- Required for TypeScript correctness — `VALID_CATEGORIES = new Set<Category>([...])` would error without this

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Pattern] Used `import * as` instead of `import { communityMentionTemplate }`**
- **Found during:** Implementation — checking existing email-router imports
- **Issue:** Plan's action block specified `import { communityMentionTemplate }` named import, but ALL existing template imports in email-router.ts use `import * as templateName from './email-templates/X.ts'` wildcard namespace pattern
- **Fix:** Used `import * as communityMention` and `import * as communityReply` — consistent with `csatFollowup`, `agentReply`, `slaAlert`, `pauseReminderT7`, etc.
- **Files modified:** `supabase/functions/_shared/email-router.ts`
- **Commit:** 4897875

**2. [Rule 2 - Missing critical] Widened `Category` type in `notification-types.ts`**
- **Found during:** Implementation analysis — `notification-send/index.ts` declares `VALID_CATEGORIES = new Set<Category>([...])` using the `Category` type from `notification-types.ts`
- **Issue:** Adding `'community-mentions'` and `'community-replies'` to `VALID_CATEGORIES` without widening the `Category` type would produce a TypeScript type error (`Type '"community-mentions"' is not assignable to type 'Category'`)
- **Fix:** Added both new values to the `Category` union in `notification-types.ts`
- **Files modified:** `supabase/functions/_shared/notification-types.ts`
- **Commit:** 4897875 (same atomic commit)

**3. [Rule 1 - Pattern] Templates placed in `email-templates/` not `templates/`**
- **Found during:** Directory listing of `_shared/`
- **Issue:** Plan references `supabase/functions/_shared/templates/` but the directory does not exist; all existing templates live in `supabase/functions/_shared/email-templates/`
- **Fix:** Created templates at `email-templates/community-mention.ts` and `email-templates/community-reply.ts`
- **Files modified:** `supabase/functions/_shared/email-router.ts` imports updated accordingly

## Threat Model Coverage

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-44-06 (mention DoS) | `daily_cap=20` in seeded `notification_category_config` row for `community-mentions` | Closed |
| T-44-05 (XSS in template) | All user-controlled vars (`mentioned_by`, `space_name`, `post_excerpt`, `comment_excerpt`, `commenter_name`) passed through `escapeHtml()` before interpolation in both templates | Closed |

## Known Stubs

None — this plan ships complete SQL + TypeScript. No UI stubs; no data-wiring stubs.

## Threat Flags

None — no new network endpoints, auth paths, or schema trust boundaries beyond those declared in the plan's `<threat_model>`.

## Self-Check: PASSED

- Migration file: `supabase/migrations/20270720000004_p44_notification_community.sql` — FOUND
- Template file: `supabase/functions/_shared/email-templates/community-mention.ts` — FOUND
- Template file: `supabase/functions/_shared/email-templates/community-reply.ts` — FOUND
- Commit 4897875 — FOUND (6 files, 268 insertions, 0 deletions)
- All acceptance criteria from plan: PASSED (verified via grep checks)
