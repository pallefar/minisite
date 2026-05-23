# Phase 49 Discussion Log

**Session:** 2026-05-24
**Mode:** default (4 areas; batched 3-4 questions per AskUserQuestion call)

## Gray areas presented

1. FTS schema + dictionary handling + RLS
2. Search UI surface + result composition + ranking
3. Digest cron + content composition + Phase 38 weekly-digest relationship
4. 1-click unsubscribe + frequency control + notification_settings widening

User selected: all 4.

---

## Area 1 — FTS schema + dictionaries + RLS

| Q | Selected | Decision |
|---|----------|----------|
| FTS schema shape | (a) Per-table tsvector + GIN | D-01 |
| EN+ES dictionaries | (a) Two stored columns (search_en + search_es) per row | D-03 |
| Cross-type search RLS | (a) Inherit via per-table RLS (SECURITY INVOKER) | D-04 |

(D-02 — column weight discipline title=A body=B — inherited from Phase 37 pattern; documented for clarity.)

## Area 2 — Search UI + result composition + ranking

| Q | Selected | Decision |
|---|----------|----------|
| Surface | (a) Global cmd+k Spotlight modal | D-05 |
| Composition | (a) Grouped by type (3 sections, top-5 each, max 15 total) | D-06 |
| Typeahead | (a) 300ms debounce + min 3 chars + cap 15 | D-07 |
| RPC shape | (a) Single search_content(p_query, p_lang) | D-08 |

## Area 3 — Digest cron + content + Phase 38 relationship

| Q | Selected | Decision |
|---|----------|----------|
| Phase 38 relationship | (a) Coexist as 2 separate weekly emails | D-09 |
| Daily cron | (a) NEW community-daily-digest Fn + hourly per-user-TZ fan-out | D-10 |
| Weekly content | (a) Course progress + upcoming events + top-3 of week | D-11 |
| Empty behavior | (a) SKIP send if all buckets empty | D-12 |

## Area 4 — 1-click unsubscribe + frequency + notification_settings widening

| Q | Selected | Decision |
|---|----------|----------|
| Unsubscribe | (a) HMAC token URL + GET endpoint + RFC 8058 List-Unsubscribe | D-13 |
| Granularity | (a) Per-category (daily + weekly separate) | D-14 |
| Default state | (a) Opt-IN both | D-15 |
| Frequency UI | (a) Toggles in /settings/notifications | D-16 |

---

## Decisions captured

- 16 implementation decisions (D-01..D-16) — all followed recommendations (user-audience surface; engagement investment per `feedback_regulator_vs_user_audience_pattern` + `feedback_aggressive_foundations`).
- Carried-forward locks: Phase 25 D-03 email-router (digests phi:false → Resend); Phase 37 tsvector + GIN + EN/ES; Phase 38 weekly-digest Fn structure + pg_cron template + profiles.timezone; Phase 43 base64url HMAC pattern; Phase 44 notification_settings 4-table widening recipe + community schema RLS; Phase 46 course_lessons completion; Phase 47 events + event_rsvps; Phase 48 D-14 mute RLS predicate (search inherits); auth.users.email JOIN (no profiles.email column).
- Out of scope: Typesense/Meilisearch (HELP-11 defer); cross-language; search history; admin digest preview; custom-frequency picker; merged P38+P49 weekly; always-send empty; mailto fallback; per-row auto-detect lang; admin digest analytics dashboard; per-space digest opt-out; preview drafts; DM content in digests.

## Deferred ideas surfaced

See `49-CONTEXT.md` `<deferred>` block — 16 items documented for future-phase backlog.
