# Phase 49: M4 Search + Email Digests - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Search platform + digest platform layered on Phase 44/46/47 content tables. Per-table `tsvector` GENERATED-ALWAYS-AS-STORED columns + GIN indexes ship verbatim from Phase 37 KB pattern: each of `community_posts`, `course_lessons`, `events` grows TWO `tsvector` columns (`search_en` with `english` config, `search_es` with `spanish` config) plus matching GIN indexes; per-type column-weight discipline via `setweight()` — title=A (1.0), body=B (0.4) — so title hits surface higher within each type. Cross-type search via SECDEF RPC `search_content(p_query text, p_lang text default 'english')` returning `(type, id, title, snippet, rank, space_id?, course_id?)` rows: executes 3 sub-queries (one per content table) UNION ALL with each sub-query inheriting that table's RLS predicates (clinic-org isolation, tier-gating, mute/ban — ALL inherited; no duplicate predicate logic in the SECDEF). `ts_headline()` produces the snippet with `<b>` highlighting; frontend bucketizes by `type` into 3 grouped sections (Posts / Lessons / Events), each section top-5 by `ts_rank_cd`. Surface = global cmd+k Spotlight-style modal lazy-mounted in App.tsx (no new TabId; debounced 300ms typeahead; min query length 3 chars; max 15 results across 3 sections). Daily digest = NEW `community-daily-digest` Edge Fn (mirror Phase 38 weekly-digest fan-out verbatim) invoked by hourly `pg_cron` (`0 * * * *`) checking `extract(hour from now() at time zone profiles.timezone) = 9` per-user. Content = top 5 posts in user's spaces (last 24h, score = `reactions + comments`) + new comments on user's posts (last 24h) + mentions tagging user (last 24h); SKIP send if all 3 buckets empty (avoid ghost emails). Weekly digest = NEW `community-weekly-digest` Edge Fn coexisting with Phase 38's `weekly-digest` (AI health summary) — TWO separate Sunday 09:00-local emails for users opted into both; Phase 38 untouched. Content = course progress recap (% delta WoW) + upcoming events RSVP'd next 7d + community top-3 of week (score = `posts×3 + reactions+comments×1`, rolling-7d). 1-click unsubscribe = HMAC-signed token URL `/api/unsubscribe?u=<user_id>&c=<category>&s=<hmac>` + GET endpoint flips `notification_settings.email=false` + RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers so Gmail/Outlook in-inbox unsubscribe works without leaving the client. HMAC follows Phase 43 base64url replace-chain pattern. `notification_settings.VALID_CATEGORIES` widens with `daily_community_digest` + `weekly_community_digest` in the same Wave 0 migration (mirrors Phase 47 D-19 + Phase 48 D-12 precedents). Defaults are opt-IN for both categories (seeded on profile creation via Phase 44 trigger). Settings UI surface adds an "Email digests" section to `/settings/notifications` with 2 toggles + "last sent X days ago" transparency text.

**Out of scope:** Typesense / Meilisearch upgrade (HELP-11 explicit deferral; Postgres tsvector + GIN only in v1.3); cross-language search (single-language per query via p_lang param; mixed-language posts get one-or-the-other tokenization — accept lossy v1); search history / saved searches; admin "preview today's digest" tool; custom-frequency digest picker (e.g. "every 3 days"); merged Phase 38+49 weekly digest (keep separate — clean opt-out semantics); always-send empty digests with filler content; mailto: unsubscribe fallback (RFC 8058 GET only); auto-detect per-row language at write time (use 2 stored columns instead); admin digest analytics dashboard; per-space digest opt-out (whole-category only); preview/draft emails before send.

</domain>

<decisions>
## Implementation Decisions

### FTS Schema + Dictionaries + RLS (Area 1)

- **D-01:** FTS schema = **per-table `tsvector` GENERATED ALWAYS AS STORED columns + GIN indexes**. Each of `community_posts`, `course_lessons`, `events` grows TWO `tsvector` columns: `search_en` (english config) + `search_es` (spanish config). Per-table GIN index on each `search_<lang>` column. Storage cost ~2x text size acceptable. RLS predicates inherit per-table — no schema duplication. Unified `searchable_content` table REJECTED (RLS complexity).

- **D-02:** Column weight discipline = **title=A (1.0), body=B (0.4)** via `setweight()` in the GENERATED expression. Example shape (community_posts):
  ```sql
  search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')),  'B')
  ) stored
  ```
  Title hits rank higher than body hits within each type via `ts_rank_cd`. Events use `(title, description)` instead of `(title, body)`; course_lessons use `(title, content_md)`.

- **D-03:** EN + ES dictionaries = **TWO stored columns per row, query branches on caller language**. `search_content(p_query, p_lang)` SECDEF RPC takes `p_lang text default 'english'`; the query selects `search_en @@` OR `search_es @@` depending on `p_lang`. Frontend passes Phase 32 i18n locale (auto-detect from `i18n.language`) or `?lang=` URL param. Mixed-language posts accept lossy v1 (no merged dict — Phase 37 KB pattern matches this exact shape). 'simple' dictionary REJECTED (loses stemming benefits).

- **D-04:** Cross-type search RLS = **inheritance via per-table RLS predicates** (NOT bypass-and-re-apply in SECDEF). `search_content` RPC body executes 3 sub-queries (one per content table) UNION ALL with each sub-query naked of any extra `WHERE` clauses beyond the FTS match + the table's existing RLS. Clinic-org isolation, tier-gating, mute-RLS (Phase 48 D-14), ban-write-deny (irrelevant for SELECT but inherited shape) ALL apply transparently. RPC is `language sql security invoker` — explicit no-bypass so RLS fires. Note: SECURITY INVOKER is unusual for this kind of cross-table RPC but is correct here per the inheritance contract; ensures the RPC cannot accidentally leak rows the caller couldn't otherwise see.

### Search UI Surface + Result Composition + Ranking (Area 2)

- **D-05:** Surface = **global cmd+k Spotlight modal** (lazy-mounted in App.tsx via React.lazy + Suspense). No new TabId. Bundle ceiling ~20 kB gz target. Trigger: cmd+k (mac) / ctrl+k (others) keyboard shortcut bound at App.tsx level via `useEffect` window keydown listener. Modal renders an `<input>` + `<Results>` panel. Click navigates: post → community drill-in; lesson → classroom drill-in; event → events drill-in. Phase 32 i18n locale passed as `p_lang`.

- **D-06:** Result composition = **grouped by type (3 sections: Posts / Lessons / Events)**, each section top-5 by `ts_rank_cd`. Unified ranked list REJECTED (cross-type rank ordering is fuzzy). Total cap = 15 results (5 per section). Per-section: title + snippet (10 words around match with `<b>` highlight via `ts_headline`) + secondary metadata (post: space name; lesson: course name + module name; event: start_at relative time).

- **D-07:** Typeahead = **300ms debounced + min 3 chars to fire + limit 15 results**. Single RPC call per debounced fire. No SSE. Results render with `<Suspense>` fallback skeleton during in-flight RPC.

- **D-08:** Search RPC return shape = `search_content(p_query text, p_lang text default 'english') returns table(type text, id uuid, title text, snippet text, rank real, space_id uuid, course_id uuid, module_id uuid, start_at timestamptz)`. Three separate RPCs (per-type) REJECTED (more HTTP overhead, harder ts_headline consistency). NULL columns per row depending on `type` (e.g. lesson has course_id+module_id, post has space_id, event has start_at — others NULL).

### Digest Cron + Content + Phase 38 Relationship (Area 3)

- **D-09:** Phase 38 relationship = **COEXIST as 2 separate weekly emails**. Phase 38 owns `weekly-digest` Edge Fn (AI health summary). Phase 49 ships NEW `community-weekly-digest` Edge Fn. Users opted into BOTH get TWO separate emails Sunday 09:00 local TZ. Different cron jobnames: `phase38-weekly-digest-hourly-fanout` (existing, untouched) + `phase49-community-weekly-digest-hourly-fanout` (new). Merged digest REJECTED (coupling AI content + community content makes opt-outs unclear; Phase 38 untouched preserves AI product surface).

- **D-10:** Daily digest = **NEW `community-daily-digest` Edge Fn invoked by hourly pg_cron** (`0 * * * *`) with per-user-TZ predicate `extract(hour from now() at time zone coalesce(profiles.timezone, 'UTC')) = 9`. Cron body identical shape to Phase 38 weekly-digest fan-out (per memory `reference_supabase_pg_cron_vault_service_role_pattern`); dollar-quote tags `$cron$` + `$daily$` (distinct from Phase 38 `$digest$`, Phase 47 `$reminders$`, Phase 48 `$restore$`). Content per-user = three buckets, EACH computed via SECDEF helper RPCs called inside the Fn:
  - Top 5 posts in user's spaces (last 24h, score = `reactions_count + comments_count`).
  - New comments on user's posts (last 24h).
  - Mentions tagging user (last 24h, from `community_post_mentions` + `community_comment_mentions`).
  Empty-day = SKIP send (D-12).

- **D-11:** Weekly digest = **NEW `community-weekly-digest` Edge Fn invoked by hourly pg_cron** with `extract(dow from local) = 0 AND extract(hour from local) = 9` (Sunday 09:00 local TZ). Content per-user:
  - **Course progress recap**: % completed delta WoW per `course_lessons.is_completed` rows for user's enrolled courses (e.g. "You finished 4 lessons in 'Intro to GLP-1s' — 60% complete").
  - **Upcoming events**: RSVP'd events starting within next 7d (`event_rsvps.status='going'` JOINed with `events.start_at`).
  - **Community top-3 of week**: per user's spaces, score = `posts×3 + (reactions+comments)×1` over rolling-7d window. Top 3 posts surfaced.
  Empty-week = SKIP send (D-12).

- **D-12:** Empty-content behavior = **SKIP send** (avoid ghost emails). Daily: skip if all 3 buckets empty. Weekly: skip if course_progress_delta=0 AND no upcoming events (RSVP'd) AND community top-3 empty. Implementation: Edge Fn computes content first; if all buckets empty, INSERT a `digest_send_log` row with `status='skipped:no-content'` (audit trail) but does NOT call Resend. UPSERT pattern per memory `feedback_state_counter_table_needs_upsert_on_event`. Per memory `feedback_aggressive_foundations` — operator picks engagement-quality over volume.

### 1-Click Unsubscribe + Frequency Control + Notification Settings Widening (Area 4)

- **D-13:** 1-click unsubscribe = **HMAC-signed token URL + GET endpoint + RFC 8058 List-Unsubscribe headers**. URL shape: `https://leanshot.app/api/unsubscribe?u=<user_id>&c=<category>&s=<base64url_hmac>`. HMAC payload = `<user_id>|<category>|<exp_unix_seconds>` signed with `UNSUBSCRIBE_SECRET` from `vault.decrypted_secrets`. base64url replace-chain per memory `reference_base64url_postgres_vercel_mint_verify` (Postgres `translate('+/=', '-_')` matches TS `btoa(...).replace(/=+$/,'')`). exp default = 90 days from send time. Verification at GET endpoint:
  1. Parse `u`, `c`, `s`; reject malformed.
  2. Constant-time compare HMAC.
  3. Check `now() < exp_unix_seconds`.
  4. UPDATE `notification_settings` SET `email=false WHERE user_id=u AND category=c`.
  5. Render confirmation page ("Unsubscribed from <category>. [Manage all preferences]"). NOT indexable (`<meta name="robots" content="noindex">`).
  Email headers (both Resend digests):
  - `List-Unsubscribe: <https://leanshot.app/api/unsubscribe?u=...&c=...&s=...>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058 — Gmail/Outlook show in-inbox unsubscribe button; POST to the URL works without leaving inbox).

- **D-14:** Per-category opt-out granularity = **2 NEW notification_settings categories: `daily_community_digest` + `weekly_community_digest`** (per memory `feedback_planner_missed_status_enum_widening` + Phase 47 D-19 + Phase 48 D-12 precedents). Widen `notification_settings.VALID_CATEGORIES` CHECK constraint + `notification_category_config` seed rows in the SAME Wave 0 migration (DROP + ADD CHECK on all 4 sibling tables atomically per Phase 44 44-02 recipe). User can opt-out of weekly while keeping daily, or vice versa. 1-click unsubscribe URL specifies `c=<category>`.

- **D-15:** Default state = **opt-IN for both `daily_community_digest` + `weekly_community_digest`** at profile creation. `notification_settings` seed trigger (Phase 44) widens to insert both rows with `email=true, in_app=true, push=false` for every new user. Existing users get a one-time backfill via Wave 0 migration. Per memory `feedback_aggressive_foundations` — user-audience surface; invest in engagement. Document in `/settings/notifications` clearly. RFC-8058 1-click satisfies CAN-SPAM opt-out friction.

- **D-16:** Frequency control UI = **toggles in `/settings/notifications`** (Phase 44 + 47 + 48 surface — pathname-based admin pattern does NOT apply here; consumer-side `/settings/notifications` is Zustand-driven). NEW "Email digests" section with 2 toggles + "last sent X days ago" transparency text (read from `digest_send_log`). DIGEST-04 (POLISH-06 extension) satisfied. Custom-frequency picker REJECTED for v1 (daily/weekly covers 90%+ use cases).

### Resolved After Research (Corrections + Additions)

- **D-17 (CORRECTS D-02 for community_posts):** Live-DB pre-check (researcher 2026-05-24) confirmed `community_posts` has **NO `title` column** — only `body`. D-02's `setweight(title=A, body=B)` formula does NOT apply to posts. Posts use `search_en = setweight(to_tsvector('english', coalesce(body,'')), 'A')` — whole body at weight A (no title to upweight). `course_lessons` keeps `(title=A, content_md=B)`; `events` keeps `(title=A, description=B)`. Per memory `feedback_doc_drift_sweep_after_critical_correction` sub-pattern — prose-fix must propagate to SQL skeleton.

- **D-18 (CORRECTS D-10 mention 24h filter):** Live-DB confirmed `community_post_mentions` + `community_comment_mentions` have NO timestamp columns. Daily digest 24h filter MUST JOIN to the parent's `created_at`:
  ```sql
  -- mentions on posts
  from community_post_mentions m
  join community_posts p on p.id = m.post_id
  where m.user_id = $1 and p.created_at >= now() - interval '24 hours'

  -- mentions in comments
  from community_comment_mentions m
  join community_comments c on c.id = m.comment_id
  where m.user_id = $1 and c.created_at >= now() - interval '24 hours'
  ```

- **D-19 (CORRECTS D-15 backfill):** Live-DB confirmed `notification_settings` rows missing for a (user, category) pair fall through to `notification_category_config.email_enabled_default` at runtime (per `notification-fire-decision.ts`). **DROP** the Wave 0 per-user backfill INSERT migration — seed `notification_category_config` with `email_enabled_default=true` + `in_app_enabled_default=true` for the 2 new categories instead. Saves a `|users| × 2` INSERT migration. Default opt-IN preserved.

- **D-20 (NEW — cron offset staggering):** Phase 38 weekly-digest cron fires at `0 * * * *`. Phase 49 daily fires at `5 * * * *`; Phase 49 weekly at `15 * * * *`. Avoids HTTP burst collision when multiple cron jobs converge on the same hourly tick. Distinct cron job names: `phase49-community-daily-digest-hourly-fanout` + `phase49-community-weekly-digest-hourly-fanout`. Dollar-quote tags: outer `$cron$`, inner `$daily$` + `$weekly$` (distinct from Phase 38 `$digest$`, Phase 47 `$reminders$`, Phase 48 `$restore$`).

- **D-21 (NEW — ts_headline CTE pattern):** `ts_headline` does NOT use GIN index; runs after row materialization. `search_content` RPC must use CTE-per-type that LIMITs 5 BEFORE applying `ts_headline`. Skeleton:
  ```sql
  with posts as (
    select id, body, ts_rank_cd(search_en, q) as rank
    from community_posts, websearch_to_tsquery('english', $1) q
    where search_en @@ q
    order by rank desc limit 5
  )
  select 'post' as type, id, null as title,
         ts_headline('english', body, websearch_to_tsquery('english', $1),
           'StartSel=<b>,StopSel=</b>,MaxWords=20,MinWords=5,ShortWord=3,HighlightAll=false') as snippet,
         rank
    from posts
  union all
  -- (similar CTE for lessons + events)
  ;
  ```
  Use `websearch_to_tsquery` (NOT `plainto_tsquery`) for natural-language query parsing.

- **D-22 (NEW — cmdk Vite chunk audit):** `cmdk@1.1.1` is currently routed into the `admin-shell` chunk (Phase 27 command palette). Consumer SearchModal importing cmdk could duplicate the lib into the `search` chunk. Wave 2 plan MUST audit `vite.config.ts manualChunks` and either (a) extract cmdk to its own shared chunk, OR (b) route consumer search to the same chunk that owns the admin command palette. Bundle ceiling 20 kB gz target for `search` chunk excluding cmdk.

- **D-23 (NEW — Deno.serve env-var disable guards):** Each new Edge Fn wraps `Deno.serve()` in `if (Deno.env.get('<FN>_DISABLE_SERVE') !== '1') { Deno.serve(handler); }` per memory `reference_deno_test_top_level_serve_trap`. Env var names: `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE`, `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE`, `UNSUBSCRIBE_HANDLER_DISABLE_SERVE`.

- **D-24 (NEW — Phase 46+47+48 dependency markers):** Phase 49's ROADMAP `Depends on:` list currently reads "Phase 37 (FTS infra shared); Phase 44 (community schema); Phase 46 (courses)". RESEARCH live-DB confirmed `course_lessons`, `course_modules`, `events`, `event_rsvps` do NOT exist yet (Phase 46 + 47 are planned but unexecuted). **Phase 49 EXECUTE blocks on Phase 46 + 47 EXECUTE merging**, NOT just landing in plan-mode. Phase 48 D-14 mute-RLS predicate is also a dependency (Phase 49 search inherits it). Add Phase 47 + 48 to roadmap deps at close-out.

### Claude's Discretion

- Vault secret name = `UNSUBSCRIBE_SECRET` (NEW; orchestrator surfaces in Wave 0 dispatch per memory `feedback_vendor_secret_preflight_surface`).
- HMAC algorithm = HMAC-SHA256 (matches Phase 43 cert verification).
- `digest_send_log` table schema (per-Fn writes): `(id, user_id, kind text check (kind in ('daily','weekly')), sent_at timestamptz, status text check (status in ('sent','skipped:no-content','skipped:opted_out','error')), error_message text)`. UPSERT on `(user_id, kind, date_trunc('day', sent_at))` to support "last sent X days ago" lookups per memory `feedback_state_counter_table_needs_upsert_on_event`.
- Migration timestamp prefix `20271001*` to land AFTER Phase 48's `20270901*` window.
- per-Fn `deno.json` for `community-daily-digest` + `community-weekly-digest` + `unsubscribe-handler` (per memory `reference_supabase_functions_deploy_import_map_flag`).
- Edge Fn `unsubscribe-handler` is the GET endpoint at `/api/unsubscribe` — runs WITHOUT authentication (token-gated). Bearer NOT required; URL signature IS the auth.
- ts_headline options: `{StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false}`. Researcher confirms via Context7.
- Spanish FTS `tsvector` config dictionary: built-in `spanish` config covers accents/stop-words. No custom dict needed.
- Search RPC perf: GIN-index seek + LIMIT 5 per type per query = O(log n + 15) per call. Acceptable up to 100k posts per type. Researcher confirms with EXPLAIN at execute time.
- Course progress delta calculation: `(this_week_completed - last_week_completed) / total_lessons_in_course * 100` per enrolled course. JOIN through `course_lessons.is_completed` + enrolled state (read from completion table per Phase 46 D-09).
- Sunday 09:00 vs Saturday 09:00 vs Monday 09:00 for weekly — pick Sunday per Phase 38 D-04 alignment + US convention. Researcher cross-checks PostHog data if available.
- The DM auto-flag DM-skip exclusion (Phase 48 D-08) does NOT apply to digest content. Direct messages are NOT included in daily or weekly digests v1 (privacy + low-signal content). Document in deferred.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 49 Source-of-Truth

- `.planning/ROADMAP.md` §Phase 49 — Goal, dependencies, success criteria, requirements binding
- `.planning/REQUIREMENTS.md` §DIGEST-01..04

### Upstream Locks (cross-phase contracts that constrain this phase)

- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` D-03 — `_shared/email-router.ts` PHI flag (digests are non-PHI; route via Resend with `phi:false`).
- `.planning/phases/32-spanish-i18n/32-CONTEXT.md` (or wherever i18n locale is set) — Phase 32 i18n locale source for `p_lang` parameter.
- `.planning/phases/37-m6-helpdesk-core/37-CONTEXT.md` — HELP-11 tsvector + GIN + EN/ES dictionaries pattern. Phase 49 reuses the migration shape.
- `.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-CONTEXT.md` — `weekly-digest` Edge Fn shape + `phase38-weekly-digest-hourly-fanout` pg_cron job. Phase 49 ships PARALLEL Fns (coexist; not merge).
- `.planning/phases/43-m4-membership-tiers-extension/43-CONTEXT.md` — base64url HMAC mint/verify pattern (D-13 unsubscribe token).
- `.planning/phases/44-m4-community-feed-foundation/44-CONTEXT.md` — `community_posts` / `community_comments` / `community_post_mentions` / `community_comment_mentions` / `community_spaces` schemas + RLS predicates. `notification_settings` 4-table widening recipe.
- `.planning/phases/46-m4-courses-classroom/46-CONTEXT.md` — `course_lessons` / `course_modules` / completion tracking schemas (weekly digest course-progress recap source).
- `.planning/phases/47-m4-events-calendar-zoom-reminders-recording/47-CONTEXT.md` — `events` + `event_rsvps` schemas (weekly digest upcoming-events source). D-19 VALID_CATEGORIES widening precedent.
- `.planning/phases/48-m4-moderation/48-CONTEXT.md` — D-14 mute-RLS predicate (Phase 49 search RPC inherits — muted authors' content NOT surfaced in search results).

### Live Schema Refs (verify at plan-time per memory `feedback_live_db_precheck_inverts_research_grep`)

- `public.profiles.timezone` (Phase 38) — IANA name, default 'America/New_York'. Confirmed live.
- `public.community_spaces.org_id` nullable (Phase 44) — RLS predicate inheritance source.
- `public.notification_settings` — confirm 4-table widening recipe matches current shape (Phase 44 + 47 + 48 widened; Phase 49 widens further with `daily_community_digest` + `weekly_community_digest`).
- `pg_cron`, `pg_net`, `vault.decrypted_secrets.service_role_key` — all confirmed live across prior phases.
- `auth.users.email` — confirmed; profiles has NO email column per memory `reference_profiles_email_vs_auth_users_email`. SECDEF digest helpers JOIN auth.users.

### Shared Infrastructure (re-use, don't re-invent)

- `supabase/functions/_shared/email-router.ts` (Phase 25) — REQUIRED for digest sends. Set `phi:false` (digests are summary content, never PHI).
- `supabase/functions/_shared/lifecycle-utils.ts` — `checkServiceRoleBearer`, `constantTimeEqual` for cron-callable Fns.
- `supabase/functions/weekly-digest/index.ts` (Phase 38) — structural FORK for `community-weekly-digest` + `community-daily-digest` Edge Fns (HMAC orchestrator-auth + service-role admin client + per-user-TZ fan-out pattern).
- `supabase/migrations/<phase-38-ts>_phase38_pg_cron_schedules.sql` — fan-out cron block shape (dollar-quote tags + vault.decrypted_secrets bearer); copy + rename for new jobs.
- `supabase/migrations/<phase-37-ts>_helpdesk_kb_articles.sql` (or wherever tsvector ships) — copy GENERATED column + GIN index shape verbatim for content tables.
- Phase 43 HMAC mint/verify utility (`_shared/hmac-token.ts` if it exists, OR new file) — copy base64url replace-chain.
- Phase 44 + 47 + 48 notification_settings VALID_CATEGORIES widening recipe — Phase 49 extends with 2 new categories.

### External Library Refs (for researcher's Context7 sweep)

- **Postgres `to_tsvector` + `ts_rank_cd` + `ts_headline`** — confirm syntax with `setweight()` + `english` / `spanish` configs. PG 15+.
- **RFC 8058 List-Unsubscribe / One-Click** — header spec + Gmail/Outlook implementation details.
- **Resend `listUnsubscribe` parameter** — confirm Resend SDK supports the header (or set via raw `headers:` param).
- **base64url Postgres** — `encode(bytea, 'base64')` + `translate(text, '+/=', '-_')` per memory.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 37 HELP-11 tsvector + GIN pattern** — migration shape is the canonical analog. Copy-and-modify imports for community_posts / course_lessons / events.
- **Phase 38 weekly-digest Edge Fn** — Edge Fn structure (HMAC auth + admin client + per-user content compute + email-router send) is the canonical analog for both NEW Phase 49 Fns.
- **Phase 38 pg_cron fan-out template** — outer `$cron$` + inner `$daily$` / `$weekly$` (distinct from Phase 38 `$digest$`, Phase 47 `$reminders$`, Phase 48 `$restore$` per memory `reference_postgres_dollar_quote_nesting_in_cron_body`).
- **Phase 44 community schema + RLS** — content tables Phase 49 attaches FTS to; RLS inherited via SECURITY INVOKER on search_content RPC (D-04).
- **Phase 43 HMAC mint/verify** — D-13 unsubscribe token follows same base64url pattern.
- **Phase 47 D-19 + Phase 48 D-12 notification_settings widening recipe** — Phase 49 mirrors verbatim (4-table atomic CHECK widening).
- **Phase 32 i18n locale** — `p_lang` parameter source.

### Established Patterns

- **GENERATED ALWAYS AS STORED tsvector columns** (Phase 37) — index-ready; no application-side write code needed; works with INSERT/UPDATE transparently.
- **SECURITY INVOKER for cross-table RPCs that should inherit RLS** (D-04) — opposite of typical SECDEF pattern. Used when the RPC should NOT bypass RLS (e.g. for SELECT-with-aggregation that respects per-row visibility).
- **HMAC-signed URL token + GET handler** (Phase 43 + D-13) — for 1-click unsubscribe without login.
- **Per-user-TZ pg_cron fan-out** (Phase 38) — D-10 + D-11 mirror.
- **RFC 8058 `List-Unsubscribe-Post: List-Unsubscribe=One-Click`** header — Gmail/Outlook in-inbox unsubscribe.
- **UPSERT for state counter tables** (per memory `feedback_state_counter_table_needs_upsert_on_event`) — `digest_send_log` writes use UPSERT on `(user_id, kind, date_trunc('day', sent_at))`.
- **Vendor secret pre-flight** (per memory `feedback_vendor_secret_preflight_surface`) — `UNSUBSCRIBE_SECRET` NEW; orchestrator surfaces in Wave 0 dispatch.

### Integration Points

- **`search_content(p_query, p_lang)` SECURITY INVOKER RPC** — net-new; UNION ALL across 3 content tables; inherits per-table RLS.
- **`unsubscribe-handler` Edge Fn** — net-new; GET endpoint at `/api/unsubscribe`; token-gated (no Authorization header); HMAC verify + UPDATE notification_settings + render confirmation page.
- **`community-daily-digest` + `community-weekly-digest` Edge Fns** — net-new; fork Phase 38 weekly-digest structurally.
- **`phase49-community-daily-digest-hourly-fanout` + `phase49-community-weekly-digest-hourly-fanout` pg_cron jobs** — net-new; coexist with Phase 38's cron.
- **Search modal in consumer App.tsx** — lazy-mounted under cmd+k keydown listener. No new TabId. New `src/components/search/` directory; new `src/lib/search/` for RPC client + types.
- **`/settings/notifications` widening** — NEW "Email digests" section with 2 toggles (consumer side; Zustand-driven; not pathname-based).
- **Trigger-seeded notification_settings rows** (Phase 44 user-create trigger) — widen to insert default-opt-in rows for `daily_community_digest` + `weekly_community_digest` on every new profile.
- **Backfill migration** — Wave 0 migration inserts default-opt-in `notification_settings` rows for ALL existing users for the 2 new categories.

### Bundle Routing

- `search` chunk via `vite.config.ts` manualChunks rule (~20 kB gz target). Strictly UI + RPC client; debounce hook; ts_headline parser; result-item components.
- NO new admin chunk — Phase 49 doesn't ship admin surface (digest preview tools deferred).

</code_context>

<specifics>
## Specific Ideas

- Skool's cmd+k modal as visual reference: large search input, results grouped by section, keyboard-navigable (arrow keys to select; enter to navigate; esc to close).
- Notion-style `<b>...<b>` highlight via ts_headline in snippet text.
- Daily digest email layout: header banner + 3 sections (Top Posts / New Comments on Your Posts / Mentions); each section shows 1-3 items + "view all" link to the relevant tab.
- Weekly digest email layout: header banner + 3 sections (Your Course Progress / Upcoming Events / Community Top 3); progress bar chart for course % (inline SVG); event cards with date + RSVP count; post cards with author + reactions.
- Unsubscribe confirmation page: simple white card; "You've unsubscribed from [Daily community digest]. [Manage all preferences]" link to /settings/notifications.

</specifics>

<deferred>
## Deferred Ideas

- **Typesense / Meilisearch upgrade** — Postgres tsvector + GIN v1.3; revisit v1.5+ if relevance complaints surface (HELP-11 explicit deferral propagated).
- **Cross-language search** (one query hits both EN+ES indexes) — single-language per query v1; mixed-language posts accept lossy v1.
- **Search history / saved searches** — defer to v2.
- **Admin "preview today's digest" tool** — defer to v1.4 polish.
- **Custom-frequency digest picker** — daily/weekly only v1.
- **Merged Phase 38 + 49 weekly digest** — coexist v1; merging deferred unless user feedback demands.
- **Always-send empty digests with filler content** — SKIP send v1 (D-12).
- **mailto: unsubscribe fallback** — RFC 8058 GET-only.
- **Auto-detect per-row language at write time** — 2 stored columns v1.
- **Admin digest analytics dashboard** — defer.
- **Per-space digest opt-out** — whole-category opt-out only v1.
- **Preview / draft emails before send** — defer.
- **DM content in digests** — DMs excluded from daily/weekly digests (privacy + low-signal); separate from Phase 48 D-08 DM-skip-auto-flag policy.
- **Mute-author exclusion from search results** — Phase 48 D-14 RLS predicate handles this transparently; no Phase 49 work needed.
- **Banned-author exclusion from search results** — same; Phase 48 D-15 RLS write-deny means no new content from banned authors; existing content still surfaces but author is "removed user" placeholder.
- **Cross-org admin-shared search** (platform staff seeing all clinic content) — `is_staff()` already in RLS predicates; no Phase 49 work.

</deferred>

---

*Phase: 49-M4 Search + Email Digests*
*Context gathered: 2026-05-24*
