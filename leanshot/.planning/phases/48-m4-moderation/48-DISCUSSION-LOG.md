# Phase 48 Discussion Log

**Session:** 2026-05-23
**Mode:** default (4 single-question turns per area, batched 2–4 per AskUserQuestion call)

## Gray areas presented

1. Reports queue extension + cooldown + admin surface
2. Auto-flag pipeline (Claude) — sync vs async + categories + PHI
3. Banned-words system — storage + matching + historical sweep
4. Mute/ban + audit log immutability + cross-org isolation

User selected: all 4.

---

## Area 1 — Reports queue extension + cooldown + admin surface

| Q | Selected | Decision |
|---|----------|----------|
| Status workflow | (a) open → triaged → resolved \| dismissed | D-01 |
| Cooldown | (a) Partial UNIQUE on open/triaged | D-02 |
| Admin surface | (a) New /admin/moderation module (pathname-based) | D-03 |
| Cross-org isolation | (a) Platform admin all + clinic admin own-org | D-04 |

## Area 2 — Auto-flag pipeline (Claude)

| Q | Selected | Decision |
|---|----------|----------|
| Timing | (a) Async via DB trigger → pg_net → Edge Fn | D-05 |
| Categories | (a) Fixed v1: toxicity / spam / medical_misinformation | D-06 |
| Threshold | (a) ≥0.7 on any category → queue (NEVER auto-remove) | D-07 |
| PHI scope | (a) Skip auto-flag for org_id IS NOT NULL spaces (DMs also skip uniformly v1) | D-08 |

## Area 3 — Banned-words system

| Q | Selected | Decision |
|---|----------|----------|
| Storage | (a) banned_words table (admin-editable) | D-09 |
| Matching | (a) Postgres trigger on content INSERT/UPDATE; ILIKE ANY | D-10 |
| Historical sweep | (a) Admin-triggered button + cursored Edge Fn | D-11 |
| Severity | (a) 3 levels: warn / flag / escalate | D-12 |

## Area 4 — Mute/ban + audit log + isolation

| Q | Selected | Decision |
|---|----------|----------|
| State storage | (a) Dedicated user_moderation_state table | D-13 |
| Mute mechanic | (a) Hidden from everyone except self + staff (RLS predicate widen) | D-14 |
| Ban enforcement | (a) Supabase Auth admin signOut + RLS deny on writes | D-15 |
| Audit log | (a) Mirror phi_access_log immutability + 90d hot + Parquet cold | D-16 |

---

## Decisions captured

- 16 implementation decisions (D-01..D-16) — **all** followed recommendations (consistent with [[feedback_regulator_vs_user_audience_pattern]] — user invests on user-facing safety surfaces).
- Carried-forward locks: Phase 25 D-03 PHI email + D-07/D-08 phi_access_log immutability + D-14 dual Anthropic; Phase 28 org_members; Phase 38 cron + HMAC orchestrator-auth; Phase 44 community_posts/comments + community_spaces; Phase 45 D-11 community_reports table + DMs; Phase 47 D-19 VALID_CATEGORIES widening pattern.
- Out of scope: self-serve appeal, shadowbans, reputation scores, IP blocks, federated mod, auto-removal, admin-configurable Claude prompts, pg_trgm fuzzy match, JSON bootstrap, DM auto-flag + DM banned-words, per-category thresholds, batching, sub-hour precision on restore cron, session-replay reconfig, in-app resolved-report notify, clinical-cred auto-flag.

## Deferred ideas surfaced

(See `48-CONTEXT.md` `<deferred>` block — 16 items documented for future-phase backlog.)
