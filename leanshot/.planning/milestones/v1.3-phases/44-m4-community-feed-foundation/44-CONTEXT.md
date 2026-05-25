# Phase 44: M4 Community Feed Foundation - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Skool-style in-house community feed: posts + 1-level threaded comments + reactions + @mentions + image/Mux video attachments + Realtime updates, scoped to admin-configurable Spaces with per-tier visibility (Free / Pro / Lifetime) and per-org visibility (clinic-private). Lands the `community-feed` chunk ≤20 kB gz, the `community_posts` / `community_comments` / `community_reactions` / `community_spaces` schema, and the first `@mux/mux-uploader-react` + Mux Edge Function wiring that Phase 46 (Courses) later reuses.

**Out of scope:** Member directory, opt-in DMs, leaderboard (→ Phase 45). Courses + lessons (→ Phase 46). Events/Zoom (→ Phase 47). Moderation queue + banned-words + Claude auto-flag (→ Phase 48). Postgres FTS search + email digests (→ Phase 49). Personalized-recommender feed sort (→ post-Phase 38 follow-on).

</domain>

<decisions>
## Implementation Decisions

### Threads + Reactions

- **D-01:** Comment thread depth = **flat / 1-level** (post → comment; no reply-to-comment). Success criterion #1's "depth N" is satisfied with N=1. Schema still ships `community_comments.parent_comment_id` nullable so Phase 45+ can lift the cap without a migration.
- **D-02:** Reactions land on **both posts and comments**. Single `community_reactions` table with `target_type ∈ {'post','comment'}` + `target_id`, idempotent toggle via UNIQUE(`user_id`, `target_type`, `target_id`, `emoji`).
- **D-03:** Reaction set is **fixed**: `like`, `heart`, `target` (🎯), `fire` (🔥), `clap` (👏). Enforced via Postgres CHECK constraint on `community_reactions.emoji`. Cheaper moderation surface, deterministic UI sprites, and per-emoji aggregate counts trivially indexable.

### Media (Images + Mux Video)

- **D-04:** Per-post image cap = **10** (Instagram carousel parity). Stored as Supabase Storage objects in a `community-media` bucket; access via 60-min signed URLs. Cap enforced both client-side (uploader UI) and at insert-time via a trigger on `community_post_media`.
- **D-05:** Mux video constraint = **5 min length / 500 MB upload size**, single video per post (no carousel of videos). Enforced client-side (Mux uploader `maxDuration` + file-size guard) and server-side (Mux webhook rejects assets exceeding `max_duration_seconds` — post is auto-marked `video_status='rejected'`).
- **D-06:** Video upload is **gated to Pro + Lifetime** tiers via `tier_effective` (Phase 43 view). Free tier may post text + images but the video uploader is hidden (and the create-asset Edge Fn rejects the call with 403 if a Free user calls the endpoint directly). Image upload is **un-gated** (all tiers, including Free).
- **D-07:** Auto-thumbnail = use Mux's `playback_id` thumbnail endpoint at the 1-second mark; cache via `<img>` with explicit width/height + `loading="lazy"`. No custom thumbnail picker in v1.

### Spaces + Tier Gating

- **D-08:** Free user in a Pro/Lifetime-only space (discovery) = **locked card with upgrade CTA**. Card shows space name + member count + post count + lock icon + "Upgrade to Pro to join" button linking to `/pricing`. Post bodies are NOT readable. Generic upgrade page in v1 — Phase 39 paywall-variant routing deferred.
- **D-09:** Clinic-org-only space for non-org users = **hidden entirely** via RLS (`community_spaces.org_id IS NULL OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())`). Matches Phase 28 cross-tenant isolation strictness — non-org users cannot probe space existence.
- **D-10:** Post body = **markdown subset, no inline images** (`![]()` stripped by dompurify policy). Supported elements: headings (h2–h4), bold, italic, lists, ordered lists, links (`http`/`https` only, target=_blank rel=noopener), code blocks, blockquotes. Images flow exclusively through the attachment uploader so the per-post cap (D-04) is enforceable.
- **D-11:** Post body cap = **5,000 chars** (enforced client + DB CHECK constraint). Drafts autosave to **localStorage** keyed by `community_draft_{spaceId}_{userId}`; restored on remount; cleared on successful post insert.

### Feed Sort + Realtime + Notifications + Edit/Delete

- **D-12:** Default feed sort = **Recent (chronological)**, cursor-paginated by `(created_at, id)` descending. Phase 38 personalized sort is NOT in scope here — `community_posts` schema carries `created_at` index sufficient for both Recent now and a later Popular/Personalized add-on. No user-facing sort toggle in v1.
- **D-13:** Realtime scope = **per-space channel**, created on space entry, torn down on space exit. Channel listens on `INSERT` to `community_posts WHERE space_id = $current` and `INSERT/DELETE` to `community_reactions` and `community_comments` for posts in that space. Per-post detail view does NOT spawn a second nested channel — the space-level channel covers it.
- **D-14:** Notification fan-out is **conservative**:
  - `@mention` in a post or comment → in-app notification + email to the mentioned user (subject to their `notification_settings.community_mentions` toggle). Mentions resolved via `@handle` regex (`/@([a-z0-9_]{3,30})\b/i`) at insert-time; resolved user_ids written to `community_post_mentions` / `community_comment_mentions` join tables.
  - Comment on a post → in-app notification to **post author only** (no fan-out to other thread participants). Email controlled by `notification_settings.community_replies`.
  - No "watch this post" feature in v1.
- **D-15:** Edit + delete semantics:
  - Posts and comments are **editable forever** by author; each edit updates `edited_at` and the UI surfaces an `edited` marker.
  - Delete is **soft-delete**: row stays, `deleted_at` is set, body text replaced with `[deleted]` tombstone in render. Reactions and reply chains preserved for moderation (Phase 48) and audit. Hard-delete is admin-only via the moderation queue in Phase 48.

### Claude's Discretion

- Storage bucket name (`community-media` or `community-attachments`) — match existing project naming conventions discovered by researcher.
- Reaction emoji rendering: Twemoji vs OS-native emoji font — defer to Phase 43/35 precedent (e.g., gamification confetti uses native emoji, follow that).
- Mention typeahead UX (debounce ms, max suggestions, fuzzy-match library): researcher should check whether the helpdesk KB search uses Fuse and reuse the instance.
- Draft autosave debounce interval (suggest 500 ms).
- Mux webhook authentication: use existing Edge Fn HMAC pattern (`reference_supabase_service_role_key_format_divergence` — `sb_secret_*` bearer or HMAC payload).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 44 Source-of-Truth

- `.planning/ROADMAP.md` §Phase 44 — Goal, dependencies, success criteria, requirements binding (lines 593–606)
- `.planning/REQUIREMENTS.md` §COMMUNITY-01..06 (lines 254–259) — Requirement-by-requirement scope

### Upstream Locks (cross-phase contracts that constrain this phase)

- `.planning/phases/37-m6-helpdesk-core/` — `react-markdown` + `dompurify` shared pipeline. Reuse the existing markdown renderer + dompurify policy from helpdesk (`src/helpdesk/KBArticleView.tsx`, `src/admin/modules/helpdesk/KBEditorPage.tsx`) — do NOT introduce a second renderer.
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/` — `org_id` schema + `withOrgScope` RLS wrapper. Every community table that can host clinic-private content (spaces, posts, comments) MUST follow Phase 28's cross-tenant impersonation-proof RLS pattern.
- `.planning/phases/43-m4-membership-tiers-extension/` — `tier_effective` view (Free/Pro/Lifetime). All tier gating in this phase reads from `tier_effective`, NOT raw subscription tables.
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-posthog/` — Bundle ceiling: `community-feed` chunk ≤20 kB gz (declared in CI in Phase 24). Plan must route heavy dependencies (Mux uploader, mention typeahead) through `src/lib/sync-defer.ts` idle-deferred init (see `project_phase5_bundle_regression`).
- `.planning/phases/35-m3-gamification-engine-complete-approved-automated-verify-onl/` — Matview refresh + leaderboard pattern (will be reused for COMMUNITY-09 in Phase 45 — flagged here so the comments-count + reactions-count denorm chosen now stays compatible).

### Shared Infrastructure (re-use, don't re-invent)

- `src/helpdesk/KBArticleView.tsx` — markdown rendering pattern (react-markdown + dompurify); copy its dompurify config and add an attachment-only override (block `<img>` from markdown).
- `src/components/clinic/roster/use-roster-realtime.ts`, `src/components/clinic/alerts/use-clinician-alerts-realtime.ts` — Realtime channel lifecycle pattern (subscribe/unsubscribe on mount/unmount, error backoff). Mirror this for per-space community channel.
- `src/lib/photo-url.ts`, `src/lib/page-builder/page-assets.ts` — Supabase Storage signed-URL pattern. Re-use the same TTL (60 min) and bucket-RLS approach for `community-media`.
- `.planning/design-system/` — Design bundle (Skool-style cards, list layouts, reaction pills). Plan-phase should run with `--skip-ui` per `feedback_design_bundle_as_ui_spec` — bundle is the design contract.

### External Library Refs (for researcher's Context7 sweep)

- `@mux/mux-uploader-react` — Direct-upload uploader component (Mux's React wrapper around the upload SDK).
- `@mux/mux-player-react` — Adaptive HLS playback component.
- Mux server SDK — `@mux/mux-node` for create-asset / playback-id / webhook signature verification.
- Supabase Realtime client — `supabase-js` v2 channel API (already used heavily in `use-roster-realtime.ts`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`react-markdown` + `dompurify` (already in deps)** — `package.json` shows `react-markdown@9.0.0`, `dompurify@3.2.0`, `rehype-raw@7.0.0`. Helpdesk KB and the changelog drawer already render markdown safely. Phase 44 inherits the toolchain at zero deps cost.
- **Realtime hook pattern** — `src/components/clinic/roster/use-roster-realtime.ts` and 4 sibling hooks codify subscribe/unsubscribe lifecycle, error backoff, and stale-event filtering. Per-space community channel should generalize this into `src/components/community/use-space-realtime.ts`.
- **Supabase Storage signed-URL helpers** — `src/lib/photo-url.ts` + `src/lib/page-builder/page-assets.ts` show the project's established pattern (signed URL with 60-min TTL, bucket name + path conventions).
- **Idle-deferred init wrapper** — `src/lib/sync-defer.ts` (per memory `project_phase5_bundle_regression`) gates heavy SDKs to keep chunks under their ceilings. Mux uploader + mention typeahead MUST route through it to stay under the 20 kB community-feed budget.
- **Fuse.js fuzzy search** — used in helpdesk KB search (per `feedback_planner_explicit_reuse_targets`). Mention typeahead should reuse the same Fuse instance pattern, NOT a second fuzzy lib.

### Established Patterns

- **org-scoped RLS via `withOrgScope`** — Phase 28's wrapper compile-time-enforces org_id on all service_role queries. Community tables holding clinic-private content (spaces with `org_id IS NOT NULL`, and posts/comments under them) MUST inherit this. Cross-tenant impersonation tests are MANDATORY (per `reference_supabase_project`).
- **`tier_effective` view, not raw subscription** — Phase 43 normalizes Free/Pro/Lifetime/Grandfather. D-06 + D-08 read from `tier_effective` only.
- **Edge Fn HMAC auth** — `reference_supabase_service_role_key_format_divergence`: orchestrator-callable Fns (Mux webhook, mention notification fan-out) use HMAC payload auth or `sb_secret_*` bearer, NOT legacy JWT.
- **Per-chunk bundle ceiling enforced in CI** — Phase 24 ships `assert-clinic-bundle-budget.sh`; community-feed chunk hard cap is 20 kB gz. Researcher must surface every npm dep size before planner adds it.

### Integration Points

- **`community_post_mentions`** join → existing `notifications` infra (in-app + Resend email). Email path uses Resend, gated by `notification_settings.community_mentions`. Mention email rendering follows Phase 25 BAA-cleared Resend channel for consumer (community = NOT PHI; not subject to SES carve-out).
- **`community-media` storage bucket** — new bucket; RLS policies for SELECT (signed-URL only, no public list), INSERT (authed user, size + mime checks), DELETE (author or admin only). Mirrors Phase 15 `page-assets` bucket policy.
- **Mux webhook → `community_posts.video_status`** — new Edge Function `mux-webhook` (HMAC-verified) updates `video_status ∈ {'uploading','processing','ready','rejected'}` and `playback_id`. UI polls via Realtime or query-on-focus.
- **Notification fan-out Edge Fn** — extends the Phase 36 NPS / Phase 25 notification dispatcher; routes community mention + reply events through the same in-app + email rails.

</code_context>

<specifics>
## Specific Ideas

- "Skool-style" was the user's anchor reference (per ROADMAP.md goal). Visual language + reaction pill UX should match Skool's compact card; design bundle in `.planning/design-system/` reportedly already captures this.
- Reaction set chosen intentionally: `like` + 4 emojis (heart, target 🎯, fire 🔥, clap 👏) — not a Slack-extensible set. 🎯 + 🔥 align with the gamification language already shipped in Phase 35.
- Mux gating Pro+ deliberately mirrors Phase 43's pattern of using video features as a tier discriminator.
- Discovery surface for locked spaces uses generic `/pricing` (NOT Phase 39 mid-trial paywall variant) — keep the upsell light in v1; richer paywall variants can route via Phase 39 in a later phase.

</specifics>

<deferred>
## Deferred Ideas

- **Personalized feed sort (Phase 38 recommender hookup)** — schema is forward-compatible (cursor on `created_at` doesn't preclude a `score` column later). Re-visit once Phase 38 lands ready-state.
- **Sort toggle (Recent vs Popular)** — single sort in v1; toggle deferred until engagement data justifies the second `ORDER BY` branch.
- **Reply-to-comment threading (N-level)** — schema ships `parent_comment_id` nullable so Phase 45+ can lift the depth cap without migration; UI work deferred.
- **Custom video thumbnail picker** — Mux 1-second auto-thumbnail in v1; admin picker deferred.
- **Per-post mute / watch-thread toggle** — comment fan-out is conservative in v1 (post-author only); broader "Skool-like" participant pings deferred until users ask for it.
- **Phase 39 paywall-variant routing on locked-space CTA** — generic `/pricing` in v1; variant-aware deep-link deferred.
- **Cross-device draft autosave (DB-backed)** — localStorage drafts in v1; DB-backed cross-device drafts deferred.
- **Slack-style extensible emoji reactions** — fixed 5-emoji set in v1.

</deferred>

---

*Phase: 44-M4 Community Feed Foundation*
*Context gathered: 2026-05-22*
