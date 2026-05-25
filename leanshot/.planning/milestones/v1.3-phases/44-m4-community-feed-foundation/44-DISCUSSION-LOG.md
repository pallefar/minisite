# Phase 44: M4 Community Feed Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 44-M4 Community Feed Foundation
**Areas discussed:** Thread + reaction shape, Media limits + Mux cost, Tier-gated Space UX (+ post body shape), Feed sort + Realtime + notifications + edit/delete

---

## Thread + Reaction Shape

### Q1: Comment thread depth — how deep can replies nest?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat — 1-level reply only | Twitter/Facebook style: all comments reply to the post. Simpler queries, no recursive CTE. Loses sub-thread conversations. | ✓ |
| 2-level (Reddit-lite) | Post → comment → 1 reply to comment. UI collapses on mobile. Skool itself caps at 2. | |
| N-level with collapse | True recursive threading + collapse. Heavier query and harder mobile UI. | |

**User's choice:** Flat (1-level). Success criterion "depth N" satisfied with N=1.

### Q2: Reactions on comments too, or posts only?

| Option | Description | Selected |
|--------|-------------|----------|
| Posts and comments | Skool / Slack / Discord parity. Uniform UX. | ✓ |
| Posts only | Simpler schema (single reactable_id FK). Comments stay lightweight. | |

**User's choice:** Posts and comments.

### Q3: Reaction set — fixed or extensible?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed (like + 4 emoji) | like + ❤️ + 🎯 + 🔥 + 👏. CHECK constraint enum. | ✓ |
| Slack-style extensible | Any unicode emoji. Free-form text column. Richer but moderation grows. | |

**User's choice:** Fixed set (like + 4 emoji).

---

## Media Limits + Mux Cost

### Q1: Per-post image attachment cap?

| Option | Description | Selected |
|--------|-------------|----------|
| 4 (Twitter-style) | Tight cap; 2×2 mobile grid. | |
| 10 (Instagram-style) | Carousel-friendly; more storage cost; user photo dumps. | ✓ |
| 1 (single hero) | Minimal; one Supabase Storage object per post. | |

**User's choice:** 10.

### Q2: Mux video constraints — length + upload size cap?

| Option | Description | Selected |
|--------|-------------|----------|
| 5 min / 500 MB | Cheap encode/deliver; covers tutorial clips. | ✓ |
| 15 min / 2 GB | Mid-form video; 3× encode cost ceiling. | |
| 60 min / 5 GB | Full lessons/streams; defer to Phase 46. | |
| 1 video / no length cap (lean on billing alerts) | Move cost-gating to billing alerts. | |

**User's choice:** 5 min / 500 MB.

### Q3: Where does the Mux upload live in the product cost-tier?

| Option | Description | Selected |
|--------|-------------|----------|
| Pro + Lifetime upload video; Free posts images only | Aligns with Phase 43 tier_effective. Lowers spike risk. | ✓ |
| All tiers can upload (subject to length cap) | Maximize engagement; rely purely on length + post-rate-limit. | |
| Admin-uploaded videos only in v1 | Safest floor; trims roadmap success criterion (scope reduction). | |

**User's choice:** Pro + Lifetime upload video; Free images only.

---

## Tier-Gated Space UX + Post Body

### Q1: Free user in Pro/Lifetime space (discovery) — what shows?

| Option | Description | Selected |
|--------|-------------|----------|
| Locked card with upgrade CTA | Card visible with lock + 'Upgrade to Pro' button. Post bodies hidden. | ✓ |
| Hidden entirely | Free user never sees Pro/Lifetime spaces. | |
| Locked card; CTA links to Phase 39 paywall variant | Re-uses Phase 39 surface. | |

**User's choice:** Locked card with upgrade CTA (generic /pricing — Phase 39 variant deferred).

### Q2: Clinic-org-only space for non-org users?

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden entirely (RLS-enforced) | Cross-tenant isolation; no leak of org existence. Matches Phase 28. | ✓ |
| Visible but locked | Shows "This space is for [Clinic] patients only". Leaks org existence — violates Phase 28. | |

**User's choice:** Hidden entirely (RLS).

### Q3: Post body — what does the author tools surface allow?

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown subset, no inline ![]() — attachments only | Predictable react-markdown; images forced through attachment flow. | ✓ |
| Full markdown including ![]() with allowlisted hosts | Allow inline images only from Supabase Storage + Mux. | |
| Plain-text only | Eliminates rendering surface; conflicts with success criterion #1. | |

**User's choice:** Markdown subset, no inline ![]().

### Q4: Post body — character cap + draft autosave?

| Option | Description | Selected |
|--------|-------------|----------|
| 5,000 chars + draft autosave to localStorage | Generous body; per-tab draft survives nav. | ✓ |
| 2,000 chars, no autosave | Tighter; one less moving part. | |
| 10,000 chars + draft autosave to DB (per-user) | Long-form; cross-device draft. More schema. | |

**User's choice:** 5,000 chars + draft autosave to localStorage.

---

## Feed Sort + Realtime + Notifications + Edit/Delete

### Q1: Default feed sort?

| Option | Description | Selected |
|--------|-------------|----------|
| Recent (chronological) | Cursor on created_at. Simplest. | ✓ |
| Popular (last 24h by reaction + comment count) | Denorm counts + matview refresh. | |
| Personalized (Phase 38 recommender) | pgvector + Claude-ranked feed. Phase 38 must be live. | |
| User toggle: Recent / Popular (default Recent) | Ship both; persist choice. | |

**User's choice:** Recent (chronological).

### Q2: Realtime subscription scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-space — subscribe on space open | 1 channel per open space. Predictable bandwidth. | ✓ |
| Per-post — only on detail view | Lightest; feed itself polls. | |
| Per-space + per-post (nested) | Both; ~2× channels. | |

**User's choice:** Per-space channel.

### Q3: Comment / @mention notification fan-out?

| Option | Description | Selected |
|--------|-------------|----------|
| @mention pings recipient; replies ping post-author only | Conservative; avoids storms. | ✓ |
| @mention pings; replies ping post-author + thread participants (opt-out per post) | Skool/Slack-like; heavier; needs participant tracking. | |
| @mention pings; in-app only (no email) | Lower friction; violates success criterion #3. | |

**User's choice:** @mention pings recipient; post replies ping post-author only.

### Q4: Edit window + delete semantics?

| Option | Description | Selected |
|--------|-------------|----------|
| Edit forever; soft-delete (tombstone) with 'edited' marker | Author can fix typos anytime; audit trail preserved. | ✓ |
| 15-min edit grace; soft-delete (tombstone) | Reddit-style. Locks history after 15 min. | |
| Edit forever; hard-delete (row removed) | Cleanest schema; cascades destroy replies + reactions. | |

**User's choice:** Edit forever; soft-delete with 'edited' marker.

---

## Claude's Discretion

- Storage bucket name (`community-media` vs `community-attachments`) — researcher chooses to match existing conventions.
- Reaction emoji rendering: Twemoji vs native font — follow Phase 35 gamification precedent.
- Mention typeahead UX (debounce, max suggestions): reuse Fuse instance from helpdesk KB search.
- Mux webhook auth: HMAC or `sb_secret_*` bearer (per `reference_supabase_service_role_key_format_divergence`).

## Deferred Ideas

- Personalized feed sort (Phase 38 recommender hookup).
- User-facing sort toggle (Recent / Popular).
- Reply-to-comment N-level threading (schema-compatible — UI deferred).
- Custom video thumbnail picker.
- Per-post "watch this thread" / mute toggle.
- Phase 39 paywall-variant routing on locked-space CTA.
- Cross-device DB-backed draft autosave.
- Slack-style extensible emoji reactions.
