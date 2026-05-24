# Phase 49: M4 Search + Email Digests - Research

**Researched:** 2026-05-24
**Domain:** Postgres FTS (cross-table), pg_cron fan-out per-user-TZ, Resend non-PHI digests, RFC 8058 List-Unsubscribe, HMAC token mint/verify, notification_settings 4-table widening
**Confidence:** HIGH

## Summary

Phase 49 layers two largely-independent platforms onto the M4 content stack: (1) **Postgres tsvector + GIN cross-table search** with English + Spanish dictionaries, exposed via a `SECURITY INVOKER` SECDEF-style RPC that UNION-ALLs three content tables and inherits per-table RLS; and (2) **daily + weekly Resend digests** mirroring the Phase 38 `weekly-digest` Edge Fn structure verbatim, scheduled via Phase 38's pg_cron per-user-TZ fan-out template, with RFC 8058 1-click unsubscribe handled by a token-gated GET endpoint.

Live-DB pre-check (memory `feedback_live_db_precheck_inverts_research_grep`) surfaced **four load-bearing schema corrections** that must propagate into plans: (i) `community_posts` has **NO `title` column** — the D-02 `setweight(title=A, body=B)` formula must reduce to `setweight(body, 'A')` for posts (or extract a synthetic title from the first 80 chars of body); (ii) `community_post_mentions` and `community_comment_mentions` have only `(post_id, user_id)` / `(comment_id, user_id)` with **NO timestamp** — 24h window filtering must JOIN to the parent `community_posts.created_at` / `community_comments.created_at`; (iii) `notification_settings` defaults `enabled=false` for absent rows, but the runtime `notification-fire-decision.ts` falls back to `notification_category_config.{email,push,in_app}_enabled_default` — D-15 "default opt-IN" requires seeding the `notification_category_config` rows with `email_enabled_default=true`, NOT a per-user backfill; (iv) `course_lessons`, `course_modules`, `events`, `event_rsvps` **DO NOT EXIST** in the live DB — Phase 49 is hard-gated on Phase 46 + Phase 47 landing first.

**Primary recommendation:** Wave 0 = three FTS migrations + notification_settings 4-table CHECK widening + `notification_category_config` 2-category seed + `digest_send_log` table + `search_content` SECDEF-style RPC + `unsubscribe-handler` + `community-daily-digest` + `community-weekly-digest` Edge Fns + per-Fn `deno.json` + pg_cron fan-out migration. Wave 1 = consumer search modal (reuse `cmdk@1.1.1` already installed for the Phase 27 admin palette) + `/settings/notifications` widening (extend `CATEGORY_LABEL` + `DEFAULT_ENABLED` maps in `NotificationsSubtab.tsx`). Wave 2 = email templates + integration smoke.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-table FTS index | Database / Storage | — | Native tsvector + GIN; no app-side indexer |
| `search_content` cross-type query | API / Backend (RPC) | Browser (debounced caller) | Single round-trip; RLS-inheriting SECURITY INVOKER |
| Search modal UI (cmd+k) | Browser / Client | — | Local keydown; lazy-loaded chunk; consumer Zustand-driven |
| Daily/weekly digest content compute | API / Backend (Edge Fn) | Database (SECDEF helper RPCs) | Service-role admin client; mirrors Phase 38 |
| pg_cron per-user-TZ fan-out | Database (pg_cron + pg_net) | — | Mirror of Phase 38; hardcoded URL + vault.decrypted_secrets bearer |
| Email send | API / Backend (Edge Fn) | — | Phase 25 `_shared/email-router.ts` with `phi:false` → Resend |
| 1-click unsubscribe GET endpoint | API / Backend (Edge Fn, no auth) | — | Token-gated; HMAC verify only; no Authorization header |
| /settings/notifications toggles | Browser / Client | API/Backend (Supabase JS) | Consumer Zustand pattern; direct REST against notification_settings |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**FTS Schema + Dictionaries + RLS (Area 1)**
- **D-01:** Per-table `tsvector` GENERATED ALWAYS AS STORED columns + GIN indexes. Each of `community_posts`, `course_lessons`, `events` grows TWO `tsvector` columns: `search_en` (english config) + `search_es` (spanish config). Unified `searchable_content` table REJECTED.
- **D-02:** Column weight discipline = title=A (1.0), body=B (0.4) via `setweight()` in the GENERATED expression. Events use `(title, description)`; course_lessons use `(title, content_md)`.
- **D-03:** EN + ES dictionaries = TWO stored columns per row, query branches on caller `p_lang`. Mixed-language posts accept lossy v1. 'simple' dictionary REJECTED.
- **D-04:** Cross-type search RLS = inheritance via per-table RLS predicates. `search_content` RPC body executes 3 sub-queries UNION ALL; RPC is `language sql security invoker` — explicit no-bypass so RLS fires.

**Search UI Surface + Result Composition + Ranking (Area 2)**
- **D-05:** Global cmd+k Spotlight modal (lazy-mounted in App.tsx). No new TabId. Bundle ceiling ~20 kB gz. Trigger: cmd+k/ctrl+k keydown at App.tsx via `useEffect`.
- **D-06:** Grouped by type (3 sections: Posts / Lessons / Events), each top-5 by `ts_rank_cd`. Total cap 15. Snippet via `ts_headline` with `<b>` highlight. Unified ranked list REJECTED.
- **D-07:** Typeahead = 300ms debounced + min 3 chars + limit 15. Single RPC per fire. No SSE.
- **D-08:** RPC return shape: `search_content(p_query text, p_lang text default 'english') returns table(type text, id uuid, title text, snippet text, rank real, space_id uuid, course_id uuid, module_id uuid, start_at timestamptz)`.

**Digest Cron + Content + Phase 38 Relationship (Area 3)**
- **D-09:** Phase 38 relationship = COEXIST as 2 separate weekly emails. Phase 38 `weekly-digest` untouched. Phase 49 ships NEW `community-weekly-digest` Edge Fn. Different cron jobnames.
- **D-10:** Daily digest = NEW `community-daily-digest` Edge Fn invoked by hourly pg_cron (`0 * * * *`) with per-user-TZ predicate `extract(hour from now() at time zone coalesce(profiles.timezone,'UTC')) = 9`. Dollar-quote tags `$cron$` + `$daily$`. Three buckets: top 5 posts in spaces (24h, score = reactions+comments), new comments on user's posts (24h), mentions tagging user (24h). Empty-day = SKIP.
- **D-11:** Weekly digest = NEW `community-weekly-digest` Edge Fn invoked by hourly pg_cron with `dow=0 AND hour=9` (Sunday 09:00 local TZ). Three buckets: course progress recap (% delta WoW), upcoming events RSVP'd next 7d, community top-3 of week (score = `posts×3 + (reactions+comments)×1` rolling-7d). Empty-week = SKIP.
- **D-12:** Empty-content = SKIP send. Edge Fn INSERTs `digest_send_log` row with `status='skipped:no-content'` but does NOT call Resend. UPSERT on `(user_id, kind, date_trunc('day', sent_at))`.

**1-Click Unsubscribe + Frequency Control + Notification Settings Widening (Area 4)**
- **D-13:** 1-click unsubscribe = HMAC-signed token URL + GET endpoint + RFC 8058 List-Unsubscribe headers. URL `https://leanshot.app/api/unsubscribe?u=<user_id>&c=<category>&s=<base64url_hmac>`. HMAC payload = `<user_id>|<category>|<exp_unix_seconds>` signed with `UNSUBSCRIBE_SECRET`. exp default = 90 days. Both Resend headers: `List-Unsubscribe: <URL>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **D-14:** Per-category opt-out = 2 NEW notification_settings categories: `daily_community_digest` + `weekly_community_digest`. Widen CHECK on 4 sibling tables atomically. 1-click URL specifies `c=<category>`.
- **D-15:** Default state = opt-IN for both at profile creation. Existing users get one-time backfill via Wave 0 migration.
- **D-16:** Frequency control UI = toggles in `/settings/notifications` consumer surface (Zustand-driven). NEW "Email digests" section with 2 toggles + "last sent X days ago" transparency text. Custom-frequency picker REJECTED.

### Claude's Discretion

- Vault secret name `UNSUBSCRIBE_SECRET` (NEW); orchestrator surfaces in Wave 0 dispatch.
- HMAC algorithm = HMAC-SHA256 (matches Phase 43 cert verification).
- `digest_send_log` schema: `(id, user_id, kind text check (kind in ('daily','weekly')), sent_at timestamptz, status text check (status in ('sent','skipped:no-content','skipped:opted_out','error')), error_message text)`. UPSERT on `(user_id, kind, date_trunc('day', sent_at))`.
- Migration timestamp prefix `20271001*` (after Phase 48's `20270901*`).
- per-Fn `deno.json` for `community-daily-digest` + `community-weekly-digest` + `unsubscribe-handler`.
- Edge Fn `unsubscribe-handler` runs WITHOUT Bearer auth — token-gated.
- ts_headline options: `{StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false}`.
- Spanish FTS config: built-in `spanish` regconfig.
- Sunday 09:00 for weekly (Phase 38 D-04 alignment).
- DMs NOT included in digests v1.

### Deferred Ideas (OUT OF SCOPE)

- Typesense/Meilisearch upgrade; cross-language merged search; search history/saved searches; admin "preview today's digest" tool; custom-frequency picker; merged Phase 38+49 weekly digest; always-send empty digests with filler; mailto: unsubscribe fallback; per-row auto-detect language; admin digest analytics dashboard; per-space digest opt-out; preview/draft emails; DM content in digests; mute-author exclusion from search results (handled by Phase 48 D-14 RLS); banned-author exclusion (Phase 48 D-15); cross-org admin-shared search (already `is_staff()` in RLS).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DIGEST-01 | Postgres FTS on community posts + courses + events (`tsvector` + GIN); shared infra with HELP-11 (English + Spanish) | Phase 37 `kb_articles` migration template (see Code Examples §1); `search_content` SECURITY INVOKER RPC pattern (§3); cmdk@1.1.1 already installed for consumer surface reuse (§Architecture Patterns) |
| DIGEST-02 | Daily email digest (top posts in your spaces + new comments on your posts + tagged-you mentions) via Resend, `pg_cron` 09:00 user-TZ | Phase 38 `weekly-digest` Edge Fn fork template (§Code Examples §4); Phase 38 pg_cron fan-out shape with `$cron$/$daily$` dollar-quote tags (§Code Examples §5); SKIP-send pattern via `digest_send_log` UPSERT |
| DIGEST-03 | Weekly digest (course progress recap + upcoming events RSVP'd + community top-3 of week); respects notification preferences | Phase 46 `course_lessons.is_completed` (PENDING — hard dep), Phase 47 `events`/`event_rsvps` (PENDING — hard dep), Phase 45 leaderboard score formula reuse (§Common Pitfalls §6) |
| DIGEST-04 | Per-user digest opt-out + frequency control in notification settings (POLISH-06 extension); 1-click unsubscribe link in every digest | RFC 8058 List-Unsubscribe + List-Unsubscribe-Post: One-Click headers via Resend SDK `headers` param (§Code Examples §6); Phase 42 NPS HMAC token pattern reuse (`_shared/nps-token.ts` — §Code Examples §7); 4-table notification CHECK widening recipe (Phase 44 44-02 — §Code Examples §3); existing `NotificationsSubtab.tsx` `DEFAULT_ENABLED` + `CATEGORY_LABEL` maps widen to 9 categories |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack**: React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. Locked for v1. Consumer search modal MUST integrate via Zustand + lazy import; **no router** in consumer surface.
- **Bundle size**: search chunk MUST stay ≤ ~20 kB gz; route `src/components/search/**` to a dedicated `search` chunk via vite.config.ts manualChunks.
- **Accessibility**: cmdk handles keyboard navigation + aria attributes; search modal MUST add `role="dialog"` + `aria-modal="true"` per project convention (see `Modal.tsx:60-62` precedent).
- **Local-first must continue to work**: search is online-only; document graceful skeleton + "offline" state.
- **No backend in leanshot/**: all server logic lives in `supabase/functions/` + `supabase/migrations/`. Path layout: `supabase/` is sibling of `leanshot/` under `/Users/karstenhaldan/minisite/`.
- **GSD Workflow Enforcement**: all file changes go through plan tasks.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cmdk` | `1.1.1` | Headless command-palette React component (cmd+k modal) | Already installed [VERIFIED: package.json]; used in Phase 27 admin palette; accessible by default; ≤ 5 kB gz |
| `tsvector` / `to_tsvector` / `ts_rank_cd` / `ts_headline` | Postgres 15+ built-in | FTS index + query + ranking + highlighting | Phase 37 KB precedent [CITED: `supabase/migrations/20270707000005_helpdesk_fts_index.sql`]; no extension required |
| `websearch_to_tsquery` | Postgres 15+ built-in | Safe user-input → tsquery (handles AND/OR/quoted-phrases/dash-NOT) | Phase 37 KB RPC uses this [CITED: `20270707000006_helpdesk_search_kb_fn.sql:49`]; safer than `to_tsquery` (no syntax errors on bad input) |
| `pg_cron` | (Supabase-managed) | Hourly fan-out scheduler | Confirmed live [VERIFIED: `cron.job` query]; same as Phase 38/47 |
| `pg_net` | (Supabase-managed) | `net.http_post` from cron body | Confirmed live; same as Phase 38 |
| `vault.decrypted_secrets` | (Supabase-managed) | Service-role bearer + `UNSUBSCRIBE_SECRET` reads | Confirmed live (4 secrets present) [VERIFIED]; per memory `reference_supabase_pg_cron_vault_service_role_pattern` |
| Resend SDK | (via `_shared/email-router.ts`) | Non-PHI digest delivery | Phase 25 D-03 `phi:false` route [CITED: `supabase/functions/_shared/email-router.ts:9-15`] |
| `node:crypto` `createHmac` + `timingSafeEqual` | Deno built-in | HMAC-SHA256 sign + verify for unsubscribe token | Phase 42 NPS precedent [CITED: `supabase/functions/_shared/nps-token.ts:28`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` (already in repo) | `3.23.8` | Validate unsubscribe URL query params | Token + category + user_id shape-check before HMAC compare |
| `@supabase/supabase-js@2` | (existing) | Admin client in Edge Fns | Lazy singleton via `makeLazyAdmin()` [CITED: `_shared/lifecycle-utils.ts`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cmdk` | `react-cmdk` (heavier, more opinionated) | cmdk already installed; matches admin precedent; no new dep |
| `SECURITY DEFINER` + explicit re-applied RLS (Phase 37 pattern) | `SECURITY INVOKER` + RLS inherits (D-04 locked) | INVOKER is correct for cross-table SELECT-only RPC; less code; cannot accidentally leak rows |
| `to_tsquery` | `websearch_to_tsquery` | websearch is robust against unsanitized user input (no `tsquery syntax error` on bad query) |
| Single unified `searchable_content` table | Per-table tsvector cols (D-01) | Unified table would need to copy RLS predicates from 3 source tables — fragile |
| ts_headline-on-everything | LIMIT 5 per type then ts_headline | ts_headline does NOT use GIN index (runs after materialization) — must filter first [CITED: postgres.org/docs/current/textsearch-controls.html] |

**Installation:**
```bash
# No new npm packages — cmdk already at 1.1.1, zod 3.23.8, @supabase/supabase-js@2 already installed
# Only new dependency = a vault secret:
supabase secrets set UNSUBSCRIBE_SECRET=$(openssl rand -base64 32) --project-ref ytnsipxxmzgaebkqmokp
```

**Version verification (2026-05-24):**
- `cmdk@1.1.1` — `npm view cmdk version` confirms latest is 1.1.1 (no upgrade needed).
- Postgres 15 / 16 / 17 / 18 all support `ts_headline` options + `websearch_to_tsquery` identically [VERIFIED: postgres.org/docs/current/textsearch-controls.html].

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (consumer)                              │
│                                                                              │
│   ┌──────────────────┐  cmd+k keydown    ┌──────────────────────────┐        │
│   │  App.tsx         │ ───────────────►  │  <SearchModal>           │        │
│   │  useEffect       │                   │  (lazy-loaded chunk)     │        │
│   │  window keydown  │                   │  - cmdk <Command>        │        │
│   └──────────────────┘                   │  - 300ms debounced input │        │
│                                          │  - bucketize by type     │        │
│                                          └────────────┬─────────────┘        │
│                                                       │ supabase.rpc()       │
│                                                       │ search_content(...)  │
└───────────────────────────────────────────────────────┼──────────────────────┘
                                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            POSTGRES (Supabase)                               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  search_content(p_query, p_lang) — SECURITY INVOKER SQL RPC         │     │
│  │                                                                     │     │
│  │     SELECT 'post' as type, ... FROM community_posts                 │     │
│  │       WHERE search_en @@ websearch_to_tsquery(...)  -- RLS applies  │     │
│  │     UNION ALL                                                       │     │
│  │     SELECT 'lesson' as type, ... FROM course_lessons                │     │
│  │     UNION ALL                                                       │     │
│  │     SELECT 'event' as type, ... FROM events                         │     │
│  │     ORDER BY type, rank DESC LIMIT 5 PER TYPE  -- via window fn     │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│        │                  │                   │                              │
│        ▼                  ▼                   ▼                              │
│  ┌─────────────┐   ┌──────────────────┐  ┌──────────────────┐                │
│  │community_   │   │ course_lessons   │  │ events           │                │
│  │posts        │   │ (Phase 46 -      │  │ (Phase 47 -      │                │
│  │ + search_en │   │  PENDING)        │  │  PENDING)        │                │
│  │ + search_es │   │ + search_en/es   │  │ + search_en/es   │                │
│  │ + GIN x 2   │   │ + GIN x 2        │  │ + GIN x 2        │                │
│  └─────────────┘   └──────────────────┘  └──────────────────┘                │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                      pg_cron (every hour, 5 + 15 past)                       │
│                                                                              │
│   phase49-community-daily-digest-hourly-fanout     (5 * * * *)               │
│       │  WHERE extract(hour from p.timezone) = 9                             │
│       │        AND notification_settings.email=true (daily_community_digest) │
│       ▼  net.http_post(... /functions/v1/community-daily-digest)             │
│                                                                              │
│   phase49-community-weekly-digest-hourly-fanout    (15 * * * *)              │
│       │  WHERE dow=0 AND hour=9 (Sunday 09:00 local)                         │
│       ▼  net.http_post(... /functions/v1/community-weekly-digest)            │
└──────────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EDGE FUNCTIONS (Deno)                                │
│                                                                              │
│   community-daily-digest:                                                    │
│     1. checkServiceRoleBearer(req)                                           │
│     2. compute 3 buckets via SECDEF helper RPCs                              │
│     3. if all empty → INSERT digest_send_log status='skipped:no-content'     │
│        return 200                                                            │
│     4. render HTML, call email-router.send({phi:false, headers:{...}})       │
│     5. UPSERT digest_send_log status='sent'                                  │
│                                                                              │
│   community-weekly-digest:                                                   │
│     identical structure; different buckets (course progress / events / top-3)│
│                                                                              │
│   unsubscribe-handler (GET, no Authorization):                               │
│     1. parse u, c, s, exp from URL                                           │
│     2. timingSafeEqual(hmac, expected)                                       │
│     3. check exp < now                                                       │
│     4. UPDATE notification_settings SET enabled=false                        │
│        WHERE user_id=u AND category=c AND channel='email'                    │
│     5. render confirmation HTML (noindex)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
                     ┌─────────────┐
                     │  Resend     │
                     │  (non-PHI)  │
                     └─────────────┘
```

### Recommended Project Structure

```
supabase/migrations/
├── 20271001000001_p49_community_posts_fts.sql        # +search_en/es + GIN; CONDITIONAL on table existing
├── 20271001000002_p49_course_lessons_fts.sql         # +search_en/es + GIN (hard dep on Phase 46)
├── 20271001000003_p49_events_fts.sql                 # +search_en/es + GIN (hard dep on Phase 47)
├── 20271001000004_p49_search_content_rpc.sql         # SECURITY INVOKER SQL function
├── 20271001000005_p49_notification_digest_widening.sql  # 4-table CHECK widening + category config seed
├── 20271001000006_p49_digest_send_log.sql            # net-new table
├── 20271001000007_p49_digest_helper_rpcs.sql         # SECDEF helpers (top posts, comments-on-mine, mentions, course progress, upcoming events, top-3-of-week)
└── 20271001000008_p49_pg_cron_schedules.sql          # 2 cron jobs (daily + weekly fan-out)

supabase/functions/
├── community-daily-digest/
│   ├── deno.json                                     # per-Fn import map
│   └── index.ts                                      # forks weekly-digest/index.ts structure
├── community-weekly-digest/
│   ├── deno.json
│   └── index.ts
├── unsubscribe-handler/
│   ├── deno.json
│   └── index.ts                                      # GET endpoint; no Bearer
└── _shared/
    ├── unsubscribe-token.ts                          # NEW; mirrors nps-token.ts pattern
    ├── email-templates/
    │   ├── community-daily-digest.ts                 # subject() + render()
    │   └── community-weekly-digest.ts
    └── email-router.ts                               # ADD 2 new EmailTemplate union variants

leanshot/src/
├── components/search/                                # NEW chunk (~20 kB gz target)
│   ├── SearchModal.tsx                               # cmdk wrapper, lazy-loaded
│   ├── SearchInput.tsx                               # debounced
│   ├── SearchResults.tsx                             # 3 sections (Posts/Lessons/Events)
│   ├── SearchResultPost.tsx
│   ├── SearchResultLesson.tsx
│   └── SearchResultEvent.tsx
├── lib/search/
│   ├── client.ts                                     # supabase.rpc('search_content', ...) wrapper + zod-validated shape
│   └── types.ts
├── App.tsx                                           # +useEffect cmd+k keydown + lazy import + Zustand searchOpen flag
└── components/dashboard/settings/
    └── NotificationsSubtab.tsx                       # widen CATEGORIES/CATEGORY_LABEL/DEFAULT_ENABLED maps
```

### Pattern 1: GENERATED ALWAYS AS STORED tsvector + GIN (per-table, per-language)

**What:** Each content table grows two `tsvector` columns + two GIN indexes. No trigger; column is atomic on INSERT/UPDATE.

**When to use:** Static-locale FTS where the locale is determined per-column at table-DDL time (not per-row).

**Source:** Phase 37 `kb_articles` precedent [CITED: `supabase/migrations/20270707000005_helpdesk_fts_index.sql`].

**Phase 49 enhancement over Phase 37:** add `setweight()` for title/body discipline (Phase 37 uses bare concatenation). **WARNING:** `community_posts` has NO `title` column [VERIFIED: live DB query] — the `setweight('A', title)` term must be omitted for community_posts (or replaced with `setweight('A', left(body, 80))` as synthetic-title heuristic; plan must lock one approach explicitly).

### Pattern 2: SECURITY INVOKER cross-table RPC (RLS inherits)

**What:** Pure SQL function (`language sql`) marked `security invoker` (default). When called, all SELECTs inside execute as the caller — RLS policies on the underlying tables apply transparently.

**When to use:** Cross-table SELECT-only aggregation where the RPC must NOT bypass RLS. Classic case is search across multi-tenant tables.

**Source:** PostgreSQL docs [CITED: postgresql.org/docs/current/sql-createfunction.html — SECURITY INVOKER is default; RLS policies apply].

**Contrast with Phase 37:** Phase 37 `search_kb_articles` is `SECURITY DEFINER` and re-applies visibility (`exists (select 1 from org_members ...)`) explicitly. D-04 LOCKS `SECURITY INVOKER` for Phase 49 — the inheritance contract is cleaner because each underlying table already has clinic-org isolation + tier-gating + mute-RLS predicates.

### Pattern 3: pg_cron per-user-TZ fan-out with vault secret

**What:** Hourly cron job; SQL body reads `service_role_key` from `vault.decrypted_secrets`, loops users whose local TZ matches `extract(hour=9)` (daily) or `extract(dow=0 AND hour=9)` (weekly), fires `net.http_post(.../functions/v1/<fn>, body=user_id)`.

**Source:** Phase 38 [CITED: `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql`].

**Phase 49 specifics:**
- Outer dollar-quote tag: `$cron$`. Inner: `$daily$` (daily fan-out) + `$weekly$` (weekly fan-out). **NEVER reuse `$digest$` (Phase 38), `$reminders$` (Phase 47), `$restore$` (Phase 48), `$cleanup$` (Phase 38).** Per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.
- Jobname: `phase49-community-daily-digest-hourly-fanout` + `phase49-community-weekly-digest-hourly-fanout`.
- Hardcoded URL: `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-daily-digest` (and `community-weekly-digest`). Per memory `reference_supabase_pg_cron_vault_service_role_pattern` — do NOT use `current_setting('app.service_role_key')` GUC; the GUC does not exist on this project.
- Schedule: stagger from Phase 38's `0 * * * *` to avoid HTTP burst → use `5 * * * *` (daily) + `15 * * * *` (weekly). [VERIFIED: Phase 38 cron at minute 0.]
- Pre-flight `do $unschedule$` block before re-scheduling for idempotent migration re-apply.

### Pattern 4: Edge Fn fork of Phase 38 `weekly-digest`

**What:** Mirror Phase 38 `weekly-digest/index.ts` structure: HMAC `checkServiceRoleBearer` → admin client lazy singleton → compute content → if non-empty render + send via `email-router` with `phi:false` → UPSERT `digest_send_log`.

**Source:** [CITED: `supabase/functions/weekly-digest/index.ts:701-746` — `Deno.serve` guarded by `WEEKLY_DIGEST_DISABLE_SERVE !== '1'` env var].

**Phase 49 deltas vs Phase 38 template:**
- NO BAA scope resolution (community content is non-PHI, no clinic-org gate).
- NO 6h dedup table check (replaced by `digest_send_log` UPSERT on `(user_id, kind, date_trunc('day', sent_at))` — same UPSERT acts as dedup).
- NO Anthropic / AI Gateway call (digest content is pure data aggregation; no model invocation).
- NO HITL queue routing (no novel narrative).
- Content compute = 3 SECDEF helper RPCs (top posts in spaces, comments-on-mine, mentions). Each RPC accepts `(p_user_id, p_since timestamptz)` and returns rows. Service-role client bypasses RLS for the cron fan-out — the SECDEF helpers do their own per-user filtering.

**Deno test trap:** Per memory `reference_deno_test_top_level_serve_trap`, **MUST guard `Deno.serve()` with `import.meta.main` OR an env-var disable check.** Phase 38 uses `if (Deno.env.get('WEEKLY_DIGEST_DISABLE_SERVE') !== '1') { Deno.serve(...) }` — Phase 49 plans MUST mirror this pattern (e.g., `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE`, `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE`, `UNSUBSCRIBE_HANDLER_DISABLE_SERVE`).

### Pattern 5: 1-click unsubscribe HMAC token

**What:** `<base64url(payload)>.<base64url(hmac_sha256(key, payload))>` token in URL. GET endpoint splits on `.`, computes expected HMAC, `timingSafeEqual` compares, then flips notification_settings row.

**Source:** Phase 42 quarterly NPS [CITED: `supabase/functions/_shared/nps-token.ts:94-165`].

**Phase 49 specifics:**
- Payload JSON: `{ user_id: string, category: 'daily_community_digest' | 'weekly_community_digest', exp: number }`.
- Signing key from env var `UNSUBSCRIBE_SECRET` (NEW vault secret).
- exp = `Math.floor(Date.now()/1000) + 90 * 24 * 3600` at mint time.
- URL shape: `https://leanshot.app/api/unsubscribe?t=<token>` (single param simpler than 3 separate params; matches NPS pattern).
- Alternatively per D-13: `?u=<user_id>&c=<category>&s=<hmac>` — **researcher recommends single-`t=<token>` form** for spec consistency with Phase 42 + smaller URL + atomic verification (one shot, no parse-then-recompute over three fields).

### Pattern 6: cmdk-based consumer command palette

**What:** Headless cmdk `<Command>` component with `<Command.Input>` + `<Command.List>` + `<Command.Group>`. Global keydown listener at App.tsx toggles open state.

**Source:** Phase 27 admin palette [CITED: `leanshot/src/components/admin/palette/AdminCommandPalette.tsx:60-78`].

**Phase 49 specifics:**
- Lazy import via `React.lazy(() => import('@/components/search/SearchModal'))` — chunk routed to `search` via vite.config.ts `manualChunks`.
- Open state in Zustand store (`searchOpen: boolean`) — NOT in local `useState` in App.tsx, because App.tsx is already heavy and adding a flag there bloats the marketing chunk. Add `searchOpen` + `setSearchOpen` to existing store.
- Debounce: `useDeferredValue` (React 19 built-in) OR custom 300ms debounce hook.

### Pattern 7: notification_settings 4-table widening (atomic CHECK + seed)

**What:** Single migration drops + adds CHECK constraint on `notification_settings`, `notification_category_config`, `user_notifications`, `notification_dismissal_state` (all 4) in one transaction, then INSERTs 2 new `notification_category_config` rows with `email_enabled_default=true, in_app_enabled_default=true, push_enabled_default=false`.

**Source:** Phase 44 [CITED: `supabase/migrations/20270720000004_p44_notification_community.sql`].

**Phase 49 simplification over D-15:** D-15 says "backfill existing users via Wave 0 migration to insert default-opt-in rows." Live DB inspection shows the runtime `notification-fire-decision.ts` already falls back to `notification_category_config.email_enabled_default` when no per-user row exists. **A per-user backfill INSERT is unnecessary** — seeding the category_config rows with `email_enabled_default=true` is enough. This saves an `INSERT ... SELECT FROM auth.users` migration (which would scale poorly + need ON CONFLICT DO NOTHING).

### Anti-Patterns to Avoid

- **`current_setting('app.service_role_key')` GUC in cron body:** Does NOT exist on this project. Use `vault.decrypted_secrets` WHERE name='service_role_key'. [Memory: `reference_supabase_pg_cron_vault_service_role_pattern`]
- **Bare `$$` dollar-quotes nested inside `cron.schedule(..., $cron$...$cron$)`:** Silently closes outer quote on FIRST inner `$$` → "syntax error at or near DECLARE". Use named tags. [Memory: `reference_postgres_dollar_quote_nesting_in_cron_body`]
- **`current_setting('app.unsubscribe_secret')` or any GUC for the new secret:** Read from `vault.decrypted_secrets` OR as Deno env var (Supabase Function Secret). NOT a GUC.
- **Letter-suffix migration timestamps:** `20271001a*` silently skipped by Supabase CLI. Use strict 14-digit. [Memory: `reference_supabase_migration_filename_regex`]
- **`INSERT ... ON CONFLICT DO DELETE`:** Doesn't exist in Postgres. For toggle-style writes use SECDEF RPC with `SELECT FOR UPDATE` + branch INSERT/DELETE. Not applicable to Phase 49 (unsubscribe is one-way UPDATE), but if a re-subscribe flow is added later, watch for this.
- **`bare Deno.serve()` at module top-level:** Triggers a real HTTP server bind on `deno test path/`. Wrap in `if (Deno.env.get('<NAME>_DISABLE_SERVE') !== '1') { Deno.serve(...) }`. [Memory: `reference_deno_test_top_level_serve_trap`]
- **`ts_headline` over the entire result set:** ts_headline does NOT use the GIN index; runs after row materialization. Wrap in a subquery that filters via `@@` + LIMIT 5 per type FIRST, then apply ts_headline only to surviving rows.
- **`legacy HS256 service-role JWT` in HMAC bearer compare:** Per memory `reference_supabase_service_role_key_format_divergence`, current SUPABASE_SERVICE_ROLE_KEY is the new `sb_secret_*` format. `constantTimeEqual(bearer, env.SUPABASE_SERVICE_ROLE_KEY)` works as Phase 38 does it.
- **Rejected-alternative strings in committed comments:** A future negation-grep auto-fix can be defeated by `-- chose X over staff_users` comment. Keep rejected names in PLAN.md / SUMMARY.md only. [Memory: `feedback_negation_grep_defeated_by_comment_string`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS index | Application-side trigger on UPDATE/INSERT | `GENERATED ALWAYS AS STORED` tsvector column | Atomic; no write-amp; GIN-indexable |
| Token format | Custom base64 variant or JWT-with-asymmetric | base64url HMAC-SHA256 `<payload>.<mac>` | Phase 42 precedent; symmetric is fine for self-issued tokens; 90-day exp keeps blast radius small |
| Constant-time HMAC compare | `mac === expected` (timing-leak) | `node:crypto.timingSafeEqual` | Critical for any HMAC verify |
| Per-user-TZ scheduling | One cron per timezone (~70 jobs) | Single hourly cron + `extract(hour from now() at time zone profiles.timezone)=9` predicate | Phase 38 precedent; one job, scales with users not zones |
| Command palette UI | Build cmdk-equivalent from scratch | `cmdk@1.1.1` (already installed) | Accessibility + keyboard nav + filtering free |
| RFC 8058 header semantics | Custom unsubscribe footer link only | `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers | Gmail/Yahoo bulk-sender requirement since Feb 2024 [CITED: mailgun.com/blog/deliverability/what-is-rfc-8058/] |
| Postgres FTS user-input parsing | Hand-strip quotes/operators before `to_tsquery` | `websearch_to_tsquery` | Handles quoted phrases / OR / NOT / unbalanced quotes safely; no syntax errors on user input |
| HMAC-token URL routing on Vercel | Vercel rewrite + custom handler | Edge Function `unsubscribe-handler` (no Bearer) + Vercel rewrite OR direct functions URL in email | Edge Fn already runs in the right runtime; one less moving part |

**Key insight:** Phase 49's "don't hand-roll" list is dominated by existing in-repo patterns. The temptation to fork instead of reuse is high because the cmdk admin palette is in the admin chunk and the weekly-digest Fn is AI-heavy. **Plans MUST point at the canonical analog explicitly** (e.g., "fork Phase 38 weekly-digest/index.ts removing the Anthropic + BAA branches") rather than re-derive from scratch. [Memory: `feedback_planner_prompt_explicit_reuse_targets`]

## Runtime State Inventory

Not applicable — Phase 49 ships NEW schema + NEW Edge Fns + extends existing notification_settings CHECK constraints. There is no rename / refactor / migration of existing data. The only "state" considerations are:

- **Vault secret addition:** `UNSUBSCRIBE_SECRET` is NEW; orchestrator surfaces in Wave 0 dispatch per memory `feedback_vendor_secret_preflight_surface`.
- **No existing-user backfill required** for notification_settings (see Pattern 7 simplification above) — fallback to `notification_category_config.*_enabled_default` covers default opt-IN at runtime.
- **pg_cron job de-registration on re-apply:** the migration's leading `do $unschedule$` block must unregister `phase49-community-daily-digest-hourly-fanout` + `phase49-community-weekly-digest-hourly-fanout` BEFORE `cron.schedule()` upserts, otherwise an expression change re-applies but the OLD entry persists.

## Common Pitfalls

### Pitfall 1: `community_posts` has no `title` column — D-02 weight formula breaks
**What goes wrong:** D-02 specifies `setweight(title, 'A') || setweight(body, 'B')`. Live DB shows `community_posts(id, space_id, author_id, body, mux_upload_id, mux_playback_id, video_status, created_at, edited_at, deleted_at)` — NO title.
**Why it happens:** CONTEXT.md was written against a hypothetical schema; Phase 44 actually shipped without title.
**How to avoid:** Plan for `community_posts.search_en` to use `setweight(to_tsvector('english', coalesce(body, '')), 'A')` alone (no concat). Posts have no title — weight tier doesn't matter intra-row. Alternatively, extract synthetic title from `left(body, 80)` with weight A and rest with weight B. **Pick ONE approach in the planner; document in plan.**
**Warning signs:** A plan that copies the D-02 example literally will fail at migration apply with `column "title" does not exist`.

### Pitfall 2: course_lessons + events tables don't exist yet
**What goes wrong:** Phase 49 Wave 0 migration `20271001000002_p49_course_lessons_fts.sql` runs `alter table public.course_lessons add column search_en ...` — `relation "public.course_lessons" does not exist`.
**Why it happens:** Phase 46 (courses) and Phase 47 (events) ship their tables AFTER Phase 44 community. Live DB confirms NEITHER has migrated yet.
**How to avoid:** Phase 49's roadmap position must require Phases 46 + 47 + 48 to land first. Roadmap-side dependency markers must include 46, 47, 48 in addition to 44 + 38 + 37 + 43. If Phase 49 attempts to ship in parallel, FTS migrations on those tables WILL fail.
**Warning signs:** Roadmap `Phase 49 depends on: Phase 44 + 38 + 37 + 43` — that list is incomplete. Add 46 + 47 + 48.

### Pitfall 3: `community_post_mentions` lacks a timestamp column
**What goes wrong:** Daily digest needs "mentions tagging user in last 24h" — but `community_post_mentions(post_id, user_id)` has no `created_at`.
**Why it happens:** Mentions are derived facts from post body — only the (post, user) pair is stored.
**How to avoid:** JOIN to `community_posts.created_at` for time filtering: `WHERE mentioned.user_id = $1 AND p.created_at > now() - interval '24 hours'`. Same for `community_comment_mentions` → JOIN to `community_comments.created_at`.
**Warning signs:** A plan that filters `WHERE community_post_mentions.created_at > now() - interval '24 hours'` will fail with `column does not exist`.

### Pitfall 4: notification_settings default-OFF schema; D-15 backfill is overspecified
**What goes wrong:** D-15 says "backfill default-opt-in rows for all existing users." Wave 0 migration would `INSERT INTO notification_settings (user_id, category, channel, enabled) SELECT id, 'daily_community_digest', 'email', true FROM auth.users`. With thousands of users × 3 channels × 2 categories, that's 6x|users| rows.
**Why it happens:** Misread of how absent-row defaults work.
**How to avoid:** `notification-fire-decision.ts` already falls back to `notification_category_config.email_enabled_default` when no row exists. Seed `notification_category_config` with `email_enabled_default=true` for both new categories; skip the per-user backfill. Document the discrepancy with D-15 in the plan; user already accepted "Claude's discretion" on details.
**Warning signs:** A plan that ships a "backfill notification_settings for all users" migration without measuring user count.

### Pitfall 5: `Deno.serve()` top-level binds port during `deno test`
**What goes wrong:** Running `deno test supabase/functions/community-daily-digest/` triggers a real HTTP server bind. Multiple tests in same Deno process → `AddrInUse` OR dangling promise + test suite aborts.
**Why it happens:** Phase 38 uses `if (Deno.env.get('WEEKLY_DIGEST_DISABLE_SERVE') !== '1') { Deno.serve(...) }`. Project-wide convention; if Phase 49 omits the guard, the established test orchestration breaks.
**How to avoid:** Every new Edge Fn MUST guard `Deno.serve` with an env-var check. Suggested names: `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE`, `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE`, `UNSUBSCRIBE_HANDLER_DISABLE_SERVE`. Test runner sets the env var; production deploys don't.
**Warning signs:** Plan task for an Edge Fn that doesn't mention the disable-serve env var in `must_haves`. [Memory: `reference_deno_test_top_level_serve_trap`]

### Pitfall 6: Phase 45 leaderboard score formula drift
**What goes wrong:** D-11 weekly community top-3 uses `score = posts×3 + (reactions+comments)×1` over rolling-7d. Phase 45 D-12 has its own community leaderboard score formula. If the formulas drift, "top-3 of week" disagrees with the visible leaderboard.
**Why it happens:** Two phases that compute the same engagement score independently.
**How to avoid:** Reuse the Phase 45 score formula verbatim. If Phase 45 ships a SECDEF helper RPC like `community_weekly_top_n(p_user_id, p_n int)`, call it from the digest Fn instead of re-implementing. **Researcher could not verify Phase 45 RPC name — Phase 45 not yet migrated.** Plan-checker must cross-check at iter-1.
**Warning signs:** Two SECDEF RPCs in different migrations with similar names + slightly different formula constants.

### Pitfall 7: `ts_headline` performance cliff
**What goes wrong:** `SELECT ts_headline(body, query) FROM community_posts WHERE search_en @@ query LIMIT 5` materializes ts_headline AFTER LIMIT — fine. But `SELECT ts_headline(...) FROM community_posts WHERE search_en @@ query ORDER BY ts_rank_cd DESC LIMIT 5` is OK too because the planner can push LIMIT. The trap is multi-table UNION ALL: each branch's headline runs over ALL matched rows BEFORE the outer LIMIT.
**Why it happens:** `ts_headline` doesn't use GIN; runs after row materialization [CITED: postgres.org/docs/current/textsearch-controls.html — "ts_headline uses the original document, not a tsvector summary"].
**How to avoid:** Each UNION ALL branch in `search_content` RPC must apply its own LIMIT 5 BEFORE the headline call. Use lateral subqueries or CTEs:
```sql
WITH posts AS (
  SELECT id, body, ts_rank_cd(search_en, q) AS rank
  FROM community_posts, websearch_to_tsquery('english', $1) q
  WHERE search_en @@ q ORDER BY rank DESC LIMIT 5
)
SELECT id, ts_headline('english', body, websearch_to_tsquery('english', $1)) AS snippet, rank
FROM posts;
```
**Warning signs:** EXPLAIN ANALYZE shows ts_headline running over 1000s of rows.

### Pitfall 8: Vault-secret access from cron requires service_role visibility
**What goes wrong:** `select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'` returns NULL if the SECDEF caller doesn't have `service_role` privileges. Phase 49's new `UNSUBSCRIBE_SECRET` MUST be readable from the Edge Fn, not from cron.
**Why it happens:** Edge Fn runtime reads `Deno.env.get('UNSUBSCRIBE_SECRET')` from Supabase Function Secret store, NOT from vault. Vault is for cron + plpgsql; Function Secrets are for Edge Fn env. They are different stores.
**How to avoid:** Pre-flight surface includes BOTH commands:
- `supabase secrets set UNSUBSCRIBE_SECRET=...` (Function Secret — for Edge Fn)
- Optionally also `INSERT INTO vault.secrets (name, secret) VALUES ('unsubscribe_secret', '...')` if any plpgsql code mints tokens (Phase 49 plan should keep token mint in Edge Fn ONLY — simpler).
**Warning signs:** Plan-checker should grep plpgsql functions for `unsubscribe_secret` — if found, the secret must be in vault.

### Pitfall 9: cron-job minute-of-hour collision with Phase 38
**What goes wrong:** Phase 38 weekly-digest fan-out runs at `0 * * * *`. Phase 49 daily AND weekly fan-outs running at `0 * * * *` triple HTTP burst at top of hour.
**Why it happens:** Defaulting to top-of-hour is convenient but stacks load.
**How to avoid:** Use `5 * * * *` (daily) and `15 * * * *` (weekly). Five minutes after top-of-hour is safe and still respects "09:00 local" within reasonable tolerance.
**Warning signs:** Plan uses `0 * * * *` for both new jobs.

### Pitfall 10: `cmdk` lazy import collides with admin palette manualChunks rule
**What goes wrong:** Vite manualChunks routes `src/components/admin/**` to `admin-shell` chunk (where cmdk currently lives). New consumer SearchModal imports `cmdk` from a different folder → cmdk gets duplicated across `admin-shell` and `search` chunks.
**Why it happens:** Vite's manualChunks splits by file path, not by import graph; same dep imported from two regions gets bundled twice unless explicitly routed.
**How to avoid:** Add a manualChunks rule that pins `cmdk` (and its deps) to a shared `cmdk` chunk that both `admin-shell` and `search` load on demand. OR route cmdk to whichever chunk loads first (probably `search` since consumer surface is more common). Plan must include vite.config.ts manualChunks audit.
**Warning signs:** `npm run build` output shows `cmdk` in two chunks; total bundle delta > 8 kB.

## Code Examples

### Example 1: GENERATED tsvector column with setweight (Phase 49 enhancement of Phase 37 KB pattern)

```sql
-- Source: Phase 37 base [CITED: 20270707000005_helpdesk_fts_index.sql] + setweight enhancement (Phase 49 D-02)
-- WARNING: community_posts has NO title column — adapt accordingly for that table only.

-- Community posts: body-only, no title (live schema verified 2026-05-24).
alter table public.community_posts
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(body, '')), 'A')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(body, '')), 'A')
  ) stored;
create index if not exists community_posts_search_en_gin on public.community_posts using gin (search_en);
create index if not exists community_posts_search_es_gin on public.community_posts using gin (search_es);

-- Course lessons (Phase 46 schema — assumes title + content_md columns).
alter table public.course_lessons
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(content_md, '')), 'B')
  ) stored;
create index if not exists course_lessons_search_en_gin on public.course_lessons using gin (search_en);
create index if not exists course_lessons_search_es_gin on public.course_lessons using gin (search_es);

-- Events (Phase 47 schema — assumes title + description columns).
alter table public.events
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(description, '')), 'B')
  ) stored;
create index if not exists events_search_en_gin on public.events using gin (search_en);
create index if not exists events_search_es_gin on public.events using gin (search_es);
```

### Example 2: SECURITY INVOKER cross-table search RPC (D-04)

```sql
-- Source: Phase 37 search_kb_articles structure [CITED: 20270707000006_helpdesk_search_kb_fn.sql]
--         + D-04 SECURITY INVOKER + UNION ALL across 3 tables.
-- The CTE structure ensures ts_headline runs only on the LIMIT-5 survivors per type.

create or replace function public.search_content(
  p_query text,
  p_lang  text default 'english'
)
returns table (
  type      text,
  id        uuid,
  title     text,
  snippet   text,
  rank      real,
  space_id  uuid,
  course_id uuid,
  module_id uuid,
  start_at  timestamptz
)
language sql
security invoker  -- RLS on community_posts / course_lessons / events applies as caller
set search_path = public
as $fn$
with q as (
  select case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end as cfg,
         websearch_to_tsquery(
           case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
           coalesce(p_query, '')
         ) as tsq
),
posts as (
  select p.id, p.space_id, p.body,
         case when p_lang = 'spanish' then ts_rank_cd(p.search_es, q.tsq)
              else ts_rank_cd(p.search_en, q.tsq) end as rank
  from public.community_posts p, q
  where p.deleted_at is null
    and (case when p_lang = 'spanish' then p.search_es else p.search_en end) @@ q.tsq
  order by rank desc
  limit 5
),
lessons as (
  select l.id, l.module_id, l.course_id, l.title, l.content_md,
         case when p_lang = 'spanish' then ts_rank_cd(l.search_es, q.tsq)
              else ts_rank_cd(l.search_en, q.tsq) end as rank
  from public.course_lessons l, q
  where (case when p_lang = 'spanish' then l.search_es else l.search_en end) @@ q.tsq
  order by rank desc
  limit 5
),
upcoming_events as (
  select e.id, e.title, e.description, e.start_at,
         case when p_lang = 'spanish' then ts_rank_cd(e.search_es, q.tsq)
              else ts_rank_cd(e.search_en, q.tsq) end as rank
  from public.events e, q
  where (case when p_lang = 'spanish' then e.search_es else e.search_en end) @@ q.tsq
  order by rank desc
  limit 5
)
select 'post'::text as type, p.id, left(p.body, 60) as title,
       ts_headline(
         case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
         p.body,
         (select tsq from q),
         'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'
       ) as snippet,
       p.rank, p.space_id, null::uuid as course_id, null::uuid as module_id, null::timestamptz as start_at
from posts p
union all
select 'lesson'::text, l.id, l.title,
       ts_headline(
         case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
         l.content_md, (select tsq from q),
         'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'
       ),
       l.rank, null::uuid, l.course_id, l.module_id, null::timestamptz
from lessons l
union all
select 'event'::text, e.id, e.title,
       ts_headline(
         case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
         e.description, (select tsq from q),
         'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'
       ),
       e.rank, null::uuid, null::uuid, null::uuid, e.start_at
from upcoming_events e
order by type, rank desc;
$fn$;

revoke execute on function public.search_content(text, text) from public;
grant  execute on function public.search_content(text, text) to authenticated;
```

### Example 3: notification_settings 4-table CHECK widening (Phase 49 mirrors Phase 44 44-02)

```sql
-- Source: Phase 44 [CITED: 20270720000004_p44_notification_community.sql]
-- Phase 49 widens further: + daily_community_digest + weekly_community_digest

begin;

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add constraint notification_settings_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      -- Phase 47 + 48 may have added more by the time Phase 49 ships; planner-checker MUST
      -- read live CHECK at execute-time and union those categories in too.
      'daily_community_digest','weekly_community_digest'
    ));

alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'daily_community_digest','weekly_community_digest'
    ));

alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add constraint user_notifications_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'daily_community_digest','weekly_community_digest'
    ));

alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'daily_community_digest','weekly_community_digest'
    ));

-- Seed default-opt-in for both new categories.
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('daily_community_digest',  1, 7,  false, false, true, true),
  ('weekly_community_digest', 1, 1,  false, false, true, true)
on conflict (category) do nothing;

commit;
```

### Example 4: Edge Fn fork structure (community-daily-digest)

```typescript
// Source: Phase 38 weekly-digest [CITED: supabase/functions/weekly-digest/index.ts]
// Phase 49 deltas: NO BAA, NO Anthropic, NO HITL, NO 6h dedup table (replaced by digest_send_log UPSERT).

import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { sendEmail } from '../_shared/email-router.ts';
import { mintUnsubscribeToken } from '../_shared/unsubscribe-token.ts';

const { admin } = makeLazyAdmin();

interface DailyDigestContent {
  topPosts: Array<{ id: string; body: string; space_name: string; score: number }>;
  commentsOnMine: Array<{ id: string; post_id: string; body: string; author_id: string }>;
  mentions: Array<{ post_id: string; post_body: string; mentioner_id: string }>;
}

async function computeDailyDigest(supabase: any, userId: string): Promise<DailyDigestContent> {
  // Three SECDEF helper RPCs (defined in 20271001000007_p49_digest_helper_rpcs.sql):
  const [topPosts, commentsOnMine, mentions] = await Promise.all([
    supabase.rpc('digest_top_posts_in_spaces', { p_user_id: userId, p_since_hours: 24, p_limit: 5 }),
    supabase.rpc('digest_new_comments_on_my_posts', { p_user_id: userId, p_since_hours: 24, p_limit: 10 }),
    supabase.rpc('digest_recent_mentions', { p_user_id: userId, p_since_hours: 24, p_limit: 10 }),
  ]);
  return {
    topPosts: topPosts.data ?? [],
    commentsOnMine: commentsOnMine.data ?? [],
    mentions: mentions.data ?? [],
  };
}

function isEmpty(c: DailyDigestContent): boolean {
  return c.topPosts.length === 0 && c.commentsOnMine.length === 0 && c.mentions.length === 0;
}

async function upsertDigestLog(supabase: any, userId: string, status: string, err?: string) {
  // UPSERT on (user_id, kind, date_trunc('day', sent_at)) per memory feedback_state_counter_table_needs_upsert_on_event
  await supabase.from('digest_send_log').upsert(
    { user_id: userId, kind: 'daily', sent_at: new Date().toISOString(), status, error_message: err ?? null },
    { onConflict: 'user_id,kind,sent_date' } // sent_date = generated column from date_trunc('day', sent_at)
  );
}

async function handleRun(userId: string): Promise<{ status: string }> {
  const content = await computeDailyDigest(admin, userId);
  if (isEmpty(content)) {
    await upsertDigestLog(admin, userId, 'skipped:no-content');
    return { status: 'skipped:no-content' };
  }
  // Check opt-out (notification_settings.enabled for email channel).
  const { data: pref } = await admin
    .from('notification_settings')
    .select('enabled')
    .eq('user_id', userId)
    .eq('category', 'daily_community_digest')
    .eq('channel', 'email')
    .maybeSingle();
  // Fall back to category_config default when row absent.
  if (pref && pref.enabled === false) {
    await upsertDigestLog(admin, userId, 'skipped:opted_out');
    return { status: 'skipped:opted_out' };
  }
  const { data: userRow } = await admin.auth.admin.getUserById(userId);
  const email = userRow?.user?.email;
  if (!email) {
    await upsertDigestLog(admin, userId, 'error', 'no_email');
    return { status: 'error' };
  }
  const unsubUrl = `https://leanshot.app/api/unsubscribe?t=${mintUnsubscribeToken({
    user_id: userId, category: 'daily_community_digest', exp: Math.floor(Date.now() / 1000) + 90 * 86400,
  })}`;
  // Render + send via email-router. Phase 49 NEW template = 'community_daily_digest'.
  await sendEmail({
    template: 'community_daily_digest',
    phi: false, // non-PHI → Resend
    to: email,
    vars: { content, unsubUrl },
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  await upsertDigestLog(admin, userId, 'sent');
  return { status: 'sent' };
}

if (Deno.env.get('COMMUNITY_DAILY_DIGEST_DISABLE_SERVE') !== '1') {
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
    if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
    const body = await req.json().catch(() => ({}));
    if (!body?.user_id) return jsonError(400, 'missing_user_id');
    try {
      const res = await handleRun(body.user_id);
      return jsonResponse(200, res);
    } catch (e) {
      return jsonError(500, 'internal');
    }
  });
}

export const __internal = { handleRun, computeDailyDigest, isEmpty };
```

### Example 5: pg_cron schedule with named dollar-quote tags (`$cron$` + `$daily$` / `$weekly$`)

```sql
-- Source: Phase 38 [CITED: 20270705000030_phase38_pg_cron_schedules.sql] structure
-- Phase 49 deltas: jobnames + URL paths + dollar-quote inner tags + minute offset (5 / 15)

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
declare job_name text;
begin
  for job_name in
    select jobname from cron.job
     where jobname in (
       'phase49-community-daily-digest-hourly-fanout',
       'phase49-community-weekly-digest-hourly-fanout'
     )
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then null;
end $unschedule$;

select cron.schedule(
  'phase49-community-daily-digest-hourly-fanout',
  '5 * * * *',  -- offset 5min from Phase 38's top-of-hour fan-out
  $cron$
  do $daily$
  declare
    rec record;
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-daily-digest';
    service_key text;
  begin
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if service_key is null then
      raise notice 'phase49-community-daily-digest-hourly-fanout: service_role_key missing — skipping';
      return;
    end if;

    for rec in
      select p.id as user_id
        from public.profiles p
       where extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 9
         and not exists (
           select 1 from public.digest_send_log dsl
            where dsl.user_id = p.id
              and dsl.kind = 'daily'
              and dsl.sent_at > now() - interval '20 hours'
         )
    loop
      perform net.http_post(
        url := fn_url,
        body := jsonb_build_object('user_id', rec.user_id),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || service_key,
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 60000
      );
    end loop;
  end;
  $daily$;
  $cron$
);

select cron.schedule(
  'phase49-community-weekly-digest-hourly-fanout',
  '15 * * * *',  -- offset 15min from top-of-hour
  $cron$
  do $weekly$
  declare
    rec record;
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-weekly-digest';
    service_key text;
  begin
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if service_key is null then return; end if;

    for rec in
      select p.id as user_id
        from public.profiles p
       where extract(dow  from (now() at time zone coalesce(p.timezone, 'UTC'))) = 0
         and extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 9
         and not exists (
           select 1 from public.digest_send_log dsl
            where dsl.user_id = p.id and dsl.kind = 'weekly'
              and dsl.sent_at > now() - interval '6 days'
         )
    loop
      perform net.http_post(
        url := fn_url, body := jsonb_build_object('user_id', rec.user_id),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || service_key,
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 60000
      );
    end loop;
  end;
  $weekly$;
  $cron$
);
```

### Example 6: Resend headers via email-router (RFC 8058)

```typescript
// Source: existing _shared/email-router.ts already has `headers?: Record<string, string>` in SendEmailArgs.
// Phase 49 extends `EmailTemplate` union with 'community_daily_digest' + 'community_weekly_digest'.
// [CITED: resend.com/docs/dashboard/emails/custom-headers — headers param accepts arbitrary keys including List-Unsubscribe]

// In email-router.ts subjectFor + renderTemplate switch arms:
case 'community_daily_digest': return communityDailyDigest.subject(vars);
case 'community_weekly_digest': return communityWeeklyDigest.subject(vars);

// Resend invocation inside lifecycle-send.ts (existing wrapper):
await resend.emails.send({
  from: 'LeanShot <hello@leanshot.app>',
  to: [args.to],
  subject: rendered.subject,
  html: rendered.html,
  text: rendered.text,
  headers: {
    'List-Unsubscribe': `<${args.unsubUrl}>`,           // RFC 2369 + 8058
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', // RFC 8058
    // Resend does NOT auto-manage these for transactional sends; caller is authoritative.
    // [VERIFIED: resend.com/changelog/custom-email-headers]
  },
});
```

### Example 7: HMAC unsubscribe token mint/verify (mirrors Phase 42 NPS pattern)

```typescript
// Source: Phase 42 [CITED: supabase/functions/_shared/nps-token.ts]
// Phase 49 NEW file: supabase/functions/_shared/unsubscribe-token.ts

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface UnsubscribeTokenPayload {
  user_id: string;
  category: 'daily_community_digest' | 'weekly_community_digest';
  exp: number; // unix seconds
}

const KEY_ENV = 'UNSUBSCRIBE_SECRET';

function readSigningKey(): string {
  const v = (globalThis as any).Deno?.env?.get?.(KEY_ENV);
  if (!v) throw new Error(`unsubscribe-token: ${KEY_ENV} not set`);
  return v;
}

function toBase64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function mintUnsubscribeToken(payload: UnsubscribeTokenPayload, key?: string): string {
  const signingKey = key ?? readSigningKey();
  const json = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(Buffer.from(json, 'utf8'));
  const mac = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  return `${payloadEncoded}.${toBase64Url(mac)}`;
}

export function verifyUnsubscribeToken(token: string, key?: string): UnsubscribeTokenPayload | null {
  if (!token) return null;
  const [payloadEncoded, macEncoded] = token.split('.');
  if (!payloadEncoded || !macEncoded) return null;
  const signingKey = key ?? readSigningKey();
  const expectedMac = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  let providedMac: Buffer;
  try { providedMac = fromBase64Url(macEncoded); } catch { return null; }
  if (providedMac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(providedMac, expectedMac)) return null;
  let payload: UnsubscribeTokenPayload;
  try { payload = JSON.parse(fromBase64Url(payloadEncoded).toString('utf8')); } catch { return null; }
  if (!payload?.user_id || !payload?.category || typeof payload?.exp !== 'number') return null;
  if (payload.category !== 'daily_community_digest' && payload.category !== 'weekly_community_digest') return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}
```

### Example 8: Consumer cmd+k modal lazy-load + Zustand-driven open state

```typescript
// Source: Phase 27 admin palette [CITED: leanshot/src/components/admin/palette/AdminCommandPalette.tsx:60-78]
// Phase 49 consumer pattern: open state in Zustand store, NOT App.tsx useState (per CLAUDE.md
// "minimize App.tsx bloat" + memory feedback_planner_prompt_explicit_reuse_targets).

// In leanshot/src/lib/store.ts — extend AppState:
//   searchOpen: boolean;
//   setSearchOpen: (open: boolean) => void;

// In leanshot/src/App.tsx — add ONE useEffect + lazy import:
const SearchModal = lazy(() => import('@/components/search/SearchModal'));

function App() {
  // ...existing code...
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const searchOpen = useStore((s) => s.searchOpen);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [searchOpen, setSearchOpen]);

  return (
    <>
      {/* existing tree */}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchModal onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `to_tsquery` (raises on bad input) | `websearch_to_tsquery` | PG 11 (2018) | Safe for unsanitized user input |
| Footer unsubscribe link only | RFC 8058 List-Unsubscribe + List-Unsubscribe-Post: One-Click | Gmail/Yahoo bulk-sender mandate (Feb 2024) | Required for any sender > ~5000 emails/day; affects deliverability |
| Custom command-palette JSX | cmdk headless library | cmdk@1.0 (2023); 1.1 (2024) | Accessibility + keyboard nav free |
| Service-role JWT HS256 | `sb_secret_*` token format | Supabase 2.99+ (early 2026) | `constantTimeEqual(bearer, env.SUPABASE_SERVICE_ROLE_KEY)` works as is — but `supabase projects api-keys` legacy export gets rejected. [Memory: `reference_supabase_service_role_key_format_divergence`] |

**Deprecated/outdated:**
- `Session.aal` field (no longer exists; use `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`).
- `current_setting('app.<name>')` GUC pattern for service-role bearer (never existed on this project — use vault).
- `supabase functions deploy --linked` (CLI v2.100+ errors on the flag; omit it). [Memory: `reference_supabase_functions_deploy_no_linked_flag`]
- `supabase functions deploy --import-map=…` flag (CLI v2.101+ silently ignores; use per-Fn `deno.json`). [Memory: `reference_supabase_functions_deploy_import_map_flag`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 46 `course_lessons` table will have `title text` + `content_md text` columns | Example 1 / Pitfall 2 | Migration `20271001000002_p49_course_lessons_fts.sql` fails — plan-checker MUST query live schema at iter-1 once Phase 46 lands |
| A2 | Phase 47 `events` table will have `title text` + `description text` + `start_at timestamptz` columns | Example 1 / Pitfall 2 | Same — query live schema at iter-1 after Phase 47 lands |
| A3 | Phase 47 `event_rsvps` will have `(user_id, event_id, status text)` where status='going' marks RSVP | Example 4 / D-11 | Weekly digest "upcoming events RSVP'd" filter would need different column names |
| A4 | Phase 46 lesson-completion shape (per CONTEXT D-claude-discretion: "course_lessons.is_completed") will support per-user-per-lesson completion via a join table (NOT a column on course_lessons itself) | Pitfall 6 / D-11 | Course progress delta calc breaks; need different JOIN |
| A5 | Phase 45 community leaderboard score RPC will exist by Phase 49 ship time | Pitfall 6 / D-11 | Phase 49 must re-implement the formula inline (acceptable; document drift risk) |
| A6 | `email_enabled_default=true` in `notification_category_config` is sufficient for default-opt-IN without per-user backfill | Pattern 7 / Pitfall 4 | If runtime path changed to require explicit row, would need per-user backfill INSERT |
| A7 | Resend SDK's `headers` parameter does NOT strip RFC 8058 headers; caller-set values pass through to recipient | Example 6 | Resend silently drops or overrides → 1-click unsubscribe doesn't work in Gmail; spike test in Wave 0 |
| A8 | `UNSUBSCRIBE_SECRET` as Supabase Function Secret (env var) is sufficient; no vault.secrets entry needed | Pitfall 8 | If any plpgsql function mints tokens, must add vault entry too |
| A9 | Phase 49's `5 */1 * * *` and `15 */1 * * *` cron offsets are safe vs Phase 47/48 cron jobs (which haven't shipped yet) | Pitfall 9 | If Phase 47 ships at `5 * * * *` or Phase 48 at `15 * * * *`, must re-stagger |
| A10 | The current 7 notification categories live on prod (`dose-reminders, ai-insights, clinic-alerts, billing, marketing, community-mentions, community-replies`) will gain Phase 47 + 48 additions by the time Phase 49 migrates | Example 3 | Phase 49 CHECK widening must include all categories live at apply-time, NOT just the 7 + 2; plan-checker runs `\d notification_settings` at iter-1 |

**A1-A5 are deferred-resolution:** Phase 49 cannot ship until Phase 46 + 47 land (per CONTEXT canonical_refs). Plan-checker iter-1 runs live schema audit AFTER 46/47 migrate.

## Open Questions

1. **Synthetic title for community_posts FTS — first-N-chars or no title at all?**
   - What we know: community_posts has no title column.
   - What's unclear: Should `search_en` apply weight A to `left(body, 80)` and weight B to the rest, or just `setweight('A', body)` over the whole thing?
   - Recommendation: Plan locks `setweight('A', body)` over whole body — simpler; no title concept exists in community semantics. Title in search results = `left(body, 60)` (client-side render, NOT stored).

2. **Phase 46 + 47 + 48 ship ordering — should Phase 49 be split?**
   - What we know: Phase 49 hard-depends on 46 + 47 + 48 migrations.
   - What's unclear: If Phase 46/47/48 slip, does Phase 49 ship search-only (community_posts) first and digests later?
   - Recommendation: Roadmap-side; surface to user. Pre-emptive recommendation: keep Phase 49 atomic to preserve `search_content` RPC contract (all 3 types in one signature).

3. **Course progress delta — counting per lesson or per percentage point?**
   - What we know: D-claude-discretion says `(this_week_completed - last_week_completed) / total_lessons_in_course * 100`.
   - What's unclear: If user has 0 completions ever and finishes 3 this week of a 10-lesson course → delta = 30%. Is "30% delta WoW" what we want, or "completed 3 lessons" (absolute count)?
   - Recommendation: Plan locks both — show `"You finished 3 lessons in 'Intro to GLP-1s' (now 30% complete)"`. Delta = absolute count, complete% = current state.

4. **Token URL path — `/api/unsubscribe` or `/functions/v1/unsubscribe-handler`?**
   - What we know: D-13 says `https://leanshot.app/api/unsubscribe?...` — `leanshot.app` is the Vercel marketing domain, not Supabase functions.
   - What's unclear: Does Vercel rewrite `/api/unsubscribe` → `<supabase>/functions/v1/unsubscribe-handler`?
   - Recommendation: Use direct Supabase functions URL in the email link OR add Vercel rewrite. Direct URL is simpler; `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/unsubscribe-handler?t=...` works without infra changes. Document choice in plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | All migrations + Fn deploys | ✓ | 2.98.2 (local) | Upgrade recommended (project memory: 2.101.0 deploy --import-map issue) |
| `pg_cron` extension | Daily/weekly fan-out | ✓ | enabled on live DB [VERIFIED] | — |
| `pg_net` extension | net.http_post in cron body | ✓ | enabled on live DB [VERIFIED] | — |
| `vault.decrypted_secrets` access from cron | service_role bearer mint | ✓ | 4 secrets present [VERIFIED] | — |
| `cmdk@1.1.1` | Consumer search modal | ✓ | 1.1.1 [VERIFIED: package.json] | — |
| Resend API access | Non-PHI digest send | ✓ | wired via `_shared/email-router.ts` | — |
| `UNSUBSCRIBE_SECRET` Supabase Function Secret | Edge Fn token mint/verify | ✗ | — | Wave 0 dispatch surfaces `supabase secrets set UNSUBSCRIBE_SECRET=$(openssl rand -base64 32) --project-ref ytnsipxxmzgaebkqmokp` |
| `public.course_lessons` table | Phase 46; Wave 0 FTS migration | ✗ | not migrated yet | **BLOCKER** — Phase 49 cannot ship until Phase 46 lands |
| `public.events` + `public.event_rsvps` tables | Phase 47; Wave 0 FTS migration + weekly RSVP query | ✗ | not migrated yet | **BLOCKER** — Phase 49 cannot ship until Phase 47 lands |
| Phase 48 mute-RLS predicate on community_posts | Search RPC RLS inheritance | ✗ | not migrated yet | Soft dep — Phase 49 search RPC works without it, but muted-author content surfaces. **PRESS:** plan-checker validates after Phase 48 lands |

**Missing dependencies with no fallback:**
- Phase 46 (course_lessons table) — blocks 2/8 Phase 49 migrations + weekly digest course-progress bucket.
- Phase 47 (events + event_rsvps) — blocks 2/8 Phase 49 migrations + weekly digest events bucket.

**Missing dependencies with fallback:**
- `UNSUBSCRIBE_SECRET` — Wave 0 dispatch CLI command + operator confirmation.
- Phase 48 (mute-RLS) — Phase 49 search ships fine without it; planner surfaces "muted-author content may leak until Phase 48 lands" as a known gap.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Deno test (Edge Fns) + Vitest (leanshot/src) — both already in repo |
| Config file | per-Fn `deno.json` + `leanshot/vite.config.ts` test config |
| Quick run command (per-task) | `deno test --no-check supabase/functions/community-daily-digest/` + `cd leanshot && npm run test -- src/components/search` |
| Full suite command (per-wave) | `cd leanshot && npm run lint && tsc -p tsconfig.app.json --noEmit && npm run test` + `cd supabase && $HOME/.deno/bin/deno test --no-check functions/community-{daily,weekly}-digest/ functions/unsubscribe-handler/ functions/_shared/unsubscribe-token.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DIGEST-01 | `community_posts.search_en` GENERATED column matches `to_tsvector('english', body)` after INSERT | DB unit | `deno test --no-check supabase/functions/_shared/__tests__/fts-schema.test.ts` | ❌ Wave 0 |
| DIGEST-01 | `community_posts.search_es` indexed via GIN | EXPLAIN check | SQL: `EXPLAIN SELECT id FROM community_posts WHERE search_es @@ websearch_to_tsquery('spanish', 'dosis')` includes `Bitmap Index Scan` | manual at execute |
| DIGEST-01 | `search_content(p_query, p_lang='english')` returns posts ranked by ts_rank_cd | RPC unit | `deno test --no-check supabase/functions/_shared/__tests__/search-content-rpc.test.ts` (uses local PG fixture) | ❌ Wave 0 |
| DIGEST-01 | `search_content` RLS inherits — caller in org A sees ONLY org-A posts | RLS integration | live cross-tenant impersonation test against staging (per project rule "every RLS surface gets a live cross-tenant impersonation proof test") | manual at execute |
| DIGEST-01 | Spanish query "dosis" matches Spanish-language community posts | unit | within search-content-rpc.test.ts — fixture with spanish body | ❌ Wave 0 |
| DIGEST-01 | ts_headline wraps matches in `<b>` tags; respects MaxWords=20 | unit | within search-content-rpc.test.ts assertion `expect(snippet).toMatch(/<b>.*?<\/b>/)` | ❌ Wave 0 |
| DIGEST-01 | search modal opens on cmd+k, closes on esc | RTL/Vitest | `cd leanshot && npm test src/components/search/SearchModal.test.tsx` | ❌ Wave 1 |
| DIGEST-01 | search modal min 3 chars + 300ms debounce — no RPC call below threshold | RTL | within SearchModal.test.tsx; mock supabase.rpc | ❌ Wave 1 |
| DIGEST-02 | `community-daily-digest` Edge Fn 401s on missing Bearer | Deno test | `deno test --no-check supabase/functions/community-daily-digest/index.test.ts` | ❌ Wave 0 |
| DIGEST-02 | Empty buckets → digest_send_log status='skipped:no-content', no Resend call | Deno test | same file, with mock helper RPCs returning [] | ❌ Wave 0 |
| DIGEST-02 | Non-empty buckets → email sent + digest_send_log status='sent' | Deno test | same file, fixture buckets | ❌ Wave 0 |
| DIGEST-02 | Idempotent on re-fire same day → 2nd UPSERT does NOT double-send (sent_date conflict) | Deno test | same file, two consecutive handleRun calls | ❌ Wave 0 |
| DIGEST-02 | pg_cron job `phase49-community-daily-digest-hourly-fanout` registered at minute=5 | SQL probe | `select schedule from cron.job where jobname='phase49-community-daily-digest-hourly-fanout'` returns `'5 * * * *'` | manual at execute |
| DIGEST-02 | TZ predicate fires at hour=9 in user's local TZ (not UTC) | DB unit | fixture: user.timezone='America/New_York', mock now()=14:00 UTC (=9am ET) → user in loop | manual fixture |
| DIGEST-03 | Weekly digest fires Sunday 09:00 local TZ only | DB unit | within cron-weekly fixture | manual fixture |
| DIGEST-03 | Course progress recap calculates % completed delta WoW correctly | RPC unit | `digest_helper_rpcs.test.ts` with completion fixture | ❌ Wave 0 |
| DIGEST-03 | Upcoming events filter = next 7d + RSVP status='going' | RPC unit | same | ❌ Wave 0 |
| DIGEST-03 | Community top-3 score formula = `posts*3 + (reactions+comments)*1` rolling-7d | RPC unit | same; fixture confirms ordering matches Phase 45 leaderboard (if Phase 45 has shipped) | ❌ Wave 0 |
| DIGEST-04 | List-Unsubscribe header present + URL points to /api/unsubscribe | Deno test | community-daily-digest.test.ts asserts headers in mock sendEmail args | ❌ Wave 0 |
| DIGEST-04 | List-Unsubscribe-Post: List-Unsubscribe=One-Click present | Deno test | same | ❌ Wave 0 |
| DIGEST-04 | Valid HMAC token → notification_settings.enabled=false for (user, category, 'email') | Deno test | `unsubscribe-handler.test.ts` GET happy path | ❌ Wave 0 |
| DIGEST-04 | Tampered HMAC → 401, settings unchanged | Deno test | same | ❌ Wave 0 |
| DIGEST-04 | Expired token (`exp < now()`) → 401 | Deno test | same | ❌ Wave 0 |
| DIGEST-04 | `/settings/notifications` shows 2 new toggles (daily + weekly community digest) | RTL | `NotificationsSubtab.test.tsx` updated | partial — Phase 42 test file exists; widen |
| DIGEST-04 | Toggle off → next digest run records status='skipped:opted_out', no Resend call | integration | within community-daily-digest.test.ts | ❌ Wave 0 |
| DIGEST-04 | notification_settings CHECK constraint accepts 'daily_community_digest' + 'weekly_community_digest' | SQL probe | `INSERT … VALUES ('daily_community_digest', 'email', true)` does NOT raise | manual at apply |

### Sampling Rate
- **Per task commit:** `cd leanshot && tsc -p tsconfig.app.json --noEmit && npm run lint -- --quiet` (~10s) + `deno test --no-check <touched-fn>/` (~5-15s per Fn).
- **Per wave merge:** Full Vitest + Deno sweep across all Phase 49 surfaces (~3 min).
- **Phase gate:** Full suite green + 1× live staging smoke (cmd+k open, type query, see results; trigger daily-digest Edge Fn via manual `curl --bearer $SERVICE_ROLE`) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `supabase/functions/community-daily-digest/index.test.ts` — covers DIGEST-02
- [ ] `supabase/functions/community-weekly-digest/index.test.ts` — covers DIGEST-03
- [ ] `supabase/functions/unsubscribe-handler/index.test.ts` — covers DIGEST-04
- [ ] `supabase/functions/_shared/unsubscribe-token.test.ts` — covers HMAC sign+verify edge cases
- [ ] `supabase/functions/_shared/__tests__/search-content-rpc.test.ts` — covers DIGEST-01 RPC (needs local PG fixture or against staging)
- [ ] `supabase/functions/_shared/__tests__/fts-schema.test.ts` — covers DIGEST-01 GENERATED column behavior
- [ ] `supabase/functions/_shared/__tests__/digest-helpers.test.ts` — covers digest helper RPCs (top posts, course progress, etc.)
- [ ] `leanshot/src/components/search/SearchModal.test.tsx` — covers DIGEST-01 UI
- [ ] `leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx` — widen existing test for 2 new categories
- [ ] No new framework install — Deno + Vitest already present.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (1-click unsubscribe is unauthenticated) | HMAC-SHA256 token + exp + constant-time verify |
| V3 Session Management | no | digest emails are stateless |
| V4 Access Control | yes (search RPC RLS inheritance) | SECURITY INVOKER + per-table RLS predicates |
| V5 Input Validation | yes | `websearch_to_tsquery` sanitizes search input; zod validates unsubscribe URL params |
| V6 Cryptography | yes | HMAC-SHA256 via `node:crypto`; no hand-rolled crypto; base64url with `timingSafeEqual` |
| V7 Error Handling and Logging | yes | Edge Fns never log raw email, token, body |
| V9 Communication | yes | All endpoints HTTPS (Supabase + Vercel both enforce TLS) |
| V10 Malicious Code | yes (cmdk dep is third-party) | Pin exact `cmdk@1.1.1`; review changelog before bumping |
| V11 Business Logic | yes (unsubscribe must be idempotent + reversible via UI) | UPDATE …WHERE category=c AND channel='email' is idempotent; user can re-enable in /settings |
| V13 API and Web Service | yes | search_content RPC grants only to `authenticated`; unsubscribe-handler open by design |
| V14 Configuration | yes | UNSUBSCRIBE_SECRET in Function Secrets, not in source |

### Known Threat Patterns for Postgres FTS + Email Digest Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Timing oracle on HMAC compare | I (information disclosure) | `node:crypto.timingSafeEqual` (Phase 42 precedent) |
| Token replay across users | E (elevation) | Bind `user_id` into the HMAC payload — tampering breaks the MAC |
| Token replay over time | E | `exp` field in payload, 90-day TTL, verified inside verify() |
| Search RPC RLS bypass via SECURITY DEFINER | E | D-04 LOCKS SECURITY INVOKER; planner-checker greps RPC body for `security definer` and BLOCKS |
| Cron-triggered Edge Fn called by unauthenticated actor | T (tampering) | `checkServiceRoleBearer` + `constantTimeEqual` against `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` |
| Email enumeration via unsubscribe (does unsubscribe to nonexistent user_id return different status code?) | I | Return 200 OK regardless; idempotent UPDATE WHERE user_id=... — if no row, 0 rows affected, still 200 |
| ts_headline reflected-XSS via user-controlled body content | T | Output HTML is server-rendered into Resend template; ts_headline outputs `<b>...</b>` tags which are SAFE; but body content itself must be HTML-escaped at template render time (existing email templates already escape via render(); confirm at plan time) |
| Resend custom-header injection (CRLF in unsubUrl) | T | Validate unsubUrl with URL constructor at mint time; URL constructor rejects CRLF in path/query |
| `vault.decrypted_secrets` read leak in cron error logs | I | `raise notice` does not log secret value; existing Phase 38 cron template proven safe |
| Search dictionary deny-list bypass (search for "credit card", get hits across orgs) | I | RLS predicates on community_posts (Phase 44 D-13) + course_lessons (Phase 46) + events (Phase 47) handle org isolation; FTS just adds full-text matching on top of existing visibility |
| Notification CHECK constraint bypass via direct SQL | T | RLS policies on notification_settings (Phase 42) deny writes; only `auth.uid()=user_id` can UPDATE own row |
| pg_cron job tampering | T | cron schema requires `pg_cron` admin role; not granted to authenticated; only migrations (run as supabase_admin) can schedule |

## Sources

### Primary (HIGH confidence)
- Live Supabase DB query results [VERIFIED 2026-05-24]: community_posts/community_post_mentions/notification_settings columns + CHECK constraints + cron.job state + vault.decrypted_secrets names.
- Phase 37 KB FTS migration: `supabase/migrations/20270707000005_helpdesk_fts_index.sql` (canonical analog).
- Phase 37 KB search RPC: `supabase/migrations/20270707000006_helpdesk_search_kb_fn.sql` (SECDEF + websearch_to_tsquery precedent).
- Phase 38 weekly-digest Edge Fn: `supabase/functions/weekly-digest/index.ts` (Edge Fn structural fork template).
- Phase 38 pg_cron migration: `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` (cron + vault + dollar-quote template).
- Phase 42 NPS HMAC token: `supabase/functions/_shared/nps-token.ts` (HMAC mint/verify template).
- Phase 44 notification widening: `supabase/migrations/20270720000004_p44_notification_community.sql` (4-table CHECK widening recipe).
- Phase 25 email-router: `supabase/functions/_shared/email-router.ts` (PHI/non-PHI dispatch).
- Phase 27 admin command palette: `leanshot/src/components/admin/palette/AdminCommandPalette.tsx` (cmdk + cmd+k pattern).
- Phase 42 notification settings UI: `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` (CATEGORIES + DEFAULT_ENABLED maps to widen).
- PostgreSQL docs — Controlling Text Search: <https://www.postgresql.org/docs/current/textsearch-controls.html> (ts_headline options + GIN-index-NOT-used caveat).
- RFC 8058 — Signaling One-Click Functionality for List Email Headers: <https://datatracker.ietf.org/doc/html/rfc8058>.

### Secondary (MEDIUM confidence)
- Resend custom headers docs: <https://resend.com/docs/dashboard/emails/custom-headers>.
- Resend changelog — Custom email headers: <https://resend.com/changelog/custom-email-headers>.
- Mailgun deliverability article on RFC 8058: <https://www.mailgun.com/blog/deliverability/what-is-rfc-8058/>.
- pganalyze SECURITY INVOKER discussion: <https://pganalyze.com/blog/5mins-postgres-row-level-security-bypassrls-security-invoker-views-leakproof-functions>.

### Tertiary (LOW confidence)
- None — all critical claims verified against in-repo precedent or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library/pattern verified against in-repo Phase 37/38/42/44/27 precedent.
- Architecture: HIGH — Edge Fn fork + pg_cron template are battle-tested across 5 prior phases.
- Pitfalls: HIGH — 10 enumerated, all with concrete evidence (live DB query for #1-#4, project memory for #5-#10).
- Schema assumptions (A1-A5): MEDIUM — Phase 46 + 47 migrations not yet on disk; plan-checker MUST re-verify at iter-1 once dependencies land.
- RFC 8058 + Resend header behavior (A7): MEDIUM — Resend docs confirm headers param works but don't specifically guarantee List-Unsubscribe pass-through. Recommend Wave 0 spike test (send one digest to a Gmail address; verify Gmail shows in-inbox unsubscribe button).

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days for stable Postgres FTS pattern + Phase 38 fork template; re-verify if Resend SDK or Supabase CLI bumps major version)
