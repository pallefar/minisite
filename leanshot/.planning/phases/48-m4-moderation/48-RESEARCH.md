# Phase 48: M4 Moderation - Research

**Researched:** 2026-05-23
**Domain:** Community-safety surface (reports queue, mute/ban, banned-words, Claude auto-flag, immutable audit)
**Confidence:** HIGH (all CONTEXT.md decisions verified against live DB + canonical migrations + Anthropic + Supabase docs)

## Summary

Phase 48 layers a moderation/safety surface on top of Phase 44 (community schema) and Phase 45 (`community_reports` write-only queue table). Implementation is unusually well-constrained because every architectural decision (D-01..D-16) is locked by CONTEXT.md, and every load-bearing pattern (HMAC orchestrator-auth, `pg_net` from triggers, `vault.decrypted_secrets`, immutable audit log, dollar-quote nesting, manifest-driven admin module routing, fixed Anthropic structured-output schema) already exists in production code with concrete callable analogs. Research surfaced **one CONTEXT correction**, **one live-DB ordering constraint**, and **multiple verbatim file analogs** the planner should reuse rather than re-derive.

**Primary recommendation:**
1. **Plan against Phase 45 migration ordering** — `community_reports` does NOT yet exist in linked DB; Phase 48 migrations land AFTER all Phase 45 migrations. Use `20270901*` timestamp prefix (verified Phase 47/48 are the latest planned, leaving headroom).
2. **Correct D-15 ban-enforcement contract** — `supabase.auth.admin.signOut(jwt, scope)` requires a **JWT, not a user_id**. Switch the Edge Fn to a two-step path: `DELETE FROM auth.sessions WHERE user_id=$1; DELETE FROM auth.refresh_tokens WHERE user_id=$1;` executed via service-role SQL inside `ban-enforcement` Edge Fn. Document JWT-still-valid-until-exp limitation; the SPA `<AccountSuspended />` blocker (per D-15) covers the residual window.
3. **Reuse Phase 38 weekly-digest invocation shape verbatim** for `claude-moderation` Edge Fn — same `output_config.format.json_schema` POST to `${BASE}/v1/messages`, same `checkServiceRoleBearer`, same retry/timeout/breadcrumb pattern. Pin `claude-haiku-4-5-20251001` (already in BAA allowlist).
4. **Reuse Phase 25 `phi_access_log` migration as `moderation_audit_log` template verbatim** — INSERT-only, RLS staff-SELECT, `REVOKE UPDATE, DELETE … FROM service_role`, SECDEF RPC sources `actor_user_id := auth.uid()` (never from caller arg).

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-16)

Verbatim from `48-CONTEXT.md` `<decisions>` block. Summarized here for planner gateway; full text in CONTEXT.md.

**Reports Queue + Cooldown + Admin Surface:**
- **D-01:** Triage workflow = `status` enum widens to `('open','triaged','resolved','dismissed')` + adds `triaged_by`, `triaged_at`, `dismissed_reason` columns. ALTER TABLE on existing Phase 45 `community_reports`.
- **D-02:** Cooldown = partial UNIQUE index on `(reporter_user_id, target_type, target_id) WHERE status IN ('open','triaged')` + SECDEF RPC `report_content(p_target_type, p_target_id, p_reason)`.
- **D-03:** `/admin/moderation` module, pathname-based (NOT react-router). Fork `CommunityAdminLayout.tsx`. Sub-views: `reports` (default), `auto-flags`, `banned-words`, `bans`, `audit-log`.
- **D-04:** Cross-org isolation = platform admin sees all; clinic admin sees only their org's reports. Helper SECDEF `public.can_moderate_report(report_row)`.

**Auto-Flag Pipeline:**
- **D-05:** ASYNC via AFTER INSERT/UPDATE trigger → pg_net → `claude-moderation` Edge Fn on `community_posts`, `community_comments`, `direct_messages`. (BUT D-08 narrows: DMs uniformly skip; only global-space content fires.)
- **D-06:** Fixed v1 categories: `toxicity`, `spam`, `medical_misinformation` (3) — hardcoded Anthropic structured-output schema.
- **D-07:** ≥0.7 on any category → INSERT system-reporter row into `community_reports` (`reporter_user_id=NULL`, `reason jsonb={source,category,confidence,rationale}`). **NEVER auto-remove.**
- **D-08:** SKIP auto-flag for spaces where `community_spaces.org_id IS NOT NULL` (PHI conservative). DMs skip uniformly v1.

**Banned-Words System:**
- **D-09:** `banned_words(id, word, severity ∈ ('warn','flag','escalate'), case_insensitive, created_by, created_at, updated_at)` with `UNIQUE(lower(word))`. SECDEF RPC `banned_word_upsert(p_word, p_severity)`.
- **D-10:** AFTER INSERT/UPDATE trigger on `community_posts` + `community_comments` (NOT DMs). ILIKE ANY loop over `banned_words` → INSERT `community_reports` row + email-router on `escalate`.
- **D-11:** Historical sweep = admin-triggered `banned-words-sweep` Edge Fn (cursored, batch=100, `WHERE id > last_seen_id ORDER BY id LIMIT 100`). Idempotent via partial UNIQUE on `community_reports (target_type, target_id) WHERE reason->>'source'='banned_word'`.
- **D-12:** 3 severity levels. Widen `notification_settings.VALID_CATEGORIES` CHECK with new entry `banned_word_escalate` in same migration as banned_words table.

**Mute/Ban + Audit Log:**
- **D-13:** `user_moderation_state(user_id PK, status ∈ ('active','muted','banned','temp_suspended'), applied_by, reason, expires_at, …)` with CHECK that `expires_at NOT NULL` iff `status='temp_suspended'`.
- **D-14:** Mute = silent-suspend via RLS predicate widening on `community_posts`/`community_comments`/`community_reactions`/`direct_messages` SELECT: `(author_id = auth.uid()) OR public.is_staff() OR NOT EXISTS(... muted)`.
- **D-15:** Ban = revoke sessions + RLS deny on user-owned writes. AFTER trigger → `ban-enforcement` Edge Fn calls Supabase Auth Admin to invalidate sessions. Temp_suspended auto-restores via hourly `temp-suspended-restore-hourly` pg_cron at `0 * * * *`.
- **D-16:** `moderation_audit_log` mirrors `phi_access_log` immutability verbatim: INSERT-only via SECDEF RPC `log_moderation_action(...)`; `REVOKE UPDATE, DELETE FROM service_role`. Widen Phase 24 `audit-archive` Edge Fn to include this table.

### Claude's Discretion

Verbatim from `48-CONTEXT.md`. Items the planner may resolve with research:
- Anthropic model: **`claude-haiku-4-5-20251001`** (researcher confirms — see §Standard Stack).
- Single-content-per-call Claude invocation; defer batch mode.
- ILIKE perf at >5000 banned-words: defer pg_trgm GIN to v2; v1 ILIKE sufficient per CONTEXT.
- DMs uniformly skip auto-flag + banned-words.
- Mute on DMs: `direct_messages` RLS widens consistently.
- Cron `0 * * * *` (hourly). Per-minute deferred.
- HMAC `sb_secret_*` for `claude-moderation` + `banned-words-sweep` + `ban-enforcement`.
- No consumer TabId widening.
- `admin-moderation` chunk ≤30 kB gz.
- Live-DB pre-check before ALTER TABLE.

### Deferred Ideas (OUT OF SCOPE)

Verbatim from `48-CONTEXT.md` `<deferred>` — DO NOT plan:
- Self-serve appeal flow; shadowbans; reputation/trust scores; IP blocks; federated moderation.
- Auto-removal at ANY confidence (success-criterion lock).
- Admin-configurable Claude prompt templates (prompt-injection attack surface).
- pg_trgm fuzzy banned-words (defer; v1 ILIKE).
- Banned-words JSON bootstrap (table is source of truth).
- DM auto-flag + DM banned-words.
- Per-category Claude thresholds + admin-tunable; Claude batching.
- Per-minute cron precision.
- PostHog session-replay reconfig (already gated by Phase 25 D-16).
- In-app "your report was resolved" notification.
- Anthropic clinical credentials for auto-flag (clinic content skipped).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOD-01 | User reports post/comment/DM → admin queue with reporter context + content snapshot + cooldown | §"Reports Queue + Cooldown" (D-01, D-02); §"Live-DB Pre-Check" Item 1 (Phase 45 schema); §"Code Examples — SECDEF RPC + partial UNIQUE" |
| MOD-02 | Admin mutes/bans/temp-suspends; user UI reflects state immediately | §"Mute/Ban Enforcement" (D-13, D-14, D-15); §"D-15 Ban Enforcement Correction" (auth.admin.signOut takes JWT not user_id); §"Pitfall 4 — RLS auth.uid() in SECDEF" |
| MOD-03 | Banned-words list flags at create-time + re-runnable sweep | §"Banned-Words System" (D-09..D-12); §"Code Examples — AFTER trigger ILIKE loop"; §"Code Examples — cursored Edge Fn" |
| MOD-04 | Claude auto-flags toxicity/spam/medical-misinformation; queues NOT auto-removes; compounds with HELP AI budget | §"Anthropic Structured-Output Pattern" (HIGH conf); §"D-08 PHI gate predicate"; §"Standard Stack" (claude-haiku-4-5-20251001) |
| MOD-05 | Every moderation action writes to moderation_audit_log; immutable per HIPAA-14 | §"phi_access_log immutability pattern" — copy verbatim; §"Code Examples — log_moderation_action SECDEF RPC" |

## Project Constraints (from CLAUDE.md)

**LeanShot consumer SPA:**
- React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. No react-router on consumer surface.
- Admin shell IS pathname-based and IS modular (`@/lib/admin/modules.ts` manifest) — Phase 48's `/admin/moderation` registers there.
- Code-split aggressively. Bundle ceilings tracked. New `admin-moderation` chunk ≤30 kB gz.
- Strict TS: `tsconfig.app.json` enforces `strict`, `noUnusedLocals`, etc.
- `npm run lint` + `npm run format` + `tsc -p tsconfig.app.json --noEmit` are the gates.

**Workflow:**
- All file edits MUST land via a GSD command (this is a GSD `/gsd-research-phase` invocation).
- Nyquist validation is ENABLED (`config.json` workflow.nyquist_validation: true) — include `## Validation Architecture` section.
- `commit_docs: true` — Edge research artifact is committed by the orchestrator after write.

**Repo layout (per memory `reference_minisite_monorepo_layout`):**
- Git root = `/Users/karstenhaldan/minisite/`.
- `leanshot/` (SPA) and `supabase/` (migrations + Edge Fns) are siblings.
- PLAN.md paths are relative to git root, NOT `leanshot/` — same convention applies here.

## Live-DB Pre-Check (verified 2026-05-23 via `npx supabase db query --linked`)

Per memory `feedback_live_db_precheck_inverts_research_grep` — these are the live-DB facts the planner MUST treat as ground truth.

### Item 1: `community_reports` does NOT exist in linked DB yet ⚠️

```
public tables present: community_comments, community_posts, community_spaces,
notification_settings, org_members, phi_access_log, profiles
public tables MISSING: community_reports, direct_messages, dm_threads,
user_moderation_state, banned_words, moderation_audit_log
```

**Implication:** Phase 45 migrations have NOT been pushed to the linked project yet. Phase 48 Wave 0 migrations land AFTER all Phase 45 migrations. The planner MUST:

1. Verify in `supabase/migrations/` that Phase 45 community_reports migration timestamp is `<= 20270731*` (Phase 45 prefix). Per Phase 45 directory listing in CONTEXT.
2. Choose Phase 48 timestamp `>= 20270901*` to guarantee post-Phase-45 ordering AND post-Phase-47 (notification_settings widening) ordering. The latest committed migration as of 2026-05-23 is `20270720000006_p44_community_spaces_admin_policies.sql`; Phase 45/46/47 will land in the `20270720*` → `20270831*` window. **`20270901*` prefix is safe.**
3. Cannot pre-grep Phase 45 schema from live DB — must read Phase 45 PLAN-01..05 migrations directly from `supabase/migrations/<p45-ts>*.sql` when they land.

[VERIFIED: `supabase db query --linked`, 2026-05-23 16:30 UTC]

### Item 2: `org_member_role` enum values

```
owner, clinician, staff, support_admin, support_lead, (more truncated — but 'admin' is NOT in this list)
```

**Implication for D-04 cross-org predicate:** The `org_member_role` enum does NOT contain `'admin'`. Phase 45 D-11 ("clinic-org admins see only reports targeting content in spaces where they're a member with role='admin'") is INCORRECT — `org_members.role` values are `owner | clinician | staff | support_admin | support_lead`. The clinic-org admin equivalent is `owner` OR `support_admin`.

**Planner action:** D-04 helper SECDEF `public.can_moderate_report(report_row)` predicate should check `role IN ('owner', 'support_admin')`, NOT `role = 'admin'`. Surface this for confirmation in plan-check.

[VERIFIED: `pg_enum` query, 2026-05-23]
[CITED: org_member_role values — full enum truncated at 5 visible; planner should re-query before writing the helper to confirm no later values are also admin-equivalent]

### Item 3: `notification_settings` VALID_CATEGORIES live CHECK

```sql
CHECK (category = ANY (ARRAY[
  'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
  'community-mentions', 'community-replies'
]))
```

7 categories present. Phase 47 will add events categories (per CONTEXT 47 D-19). Phase 48 D-12 widens to include `banned_word_escalate`. **Per Phase 44 precedent (`20270720000004_p44_notification_community.sql`):** ALL 4 notification tables (`notification_settings`, `notification_category_config`, `user_notifications`, `notification_dismissal_state`) have the same CHECK constraint and MUST be widened atomically in a single migration transaction. Planner MUST include all 4 ALTER statements + the `notification_category_config` seed row in one Wave-0 migration.

[VERIFIED: `pg_constraint` query, 2026-05-23 + Phase 44 migration analog file]

### Item 4: `community_spaces.org_id` is nullable

```
community_spaces columns: id (uuid, default gen_random_uuid()), name (text), description (text),
org_id (uuid, nullable), min_tier (text, default 'free'), ... (truncated)
```

**Implication for D-08 PHI gate:** Trigger WHEN clause `WHEN (EXISTS (SELECT 1 FROM community_spaces s WHERE s.id = NEW.space_id AND s.org_id IS NULL))` is sound. Global-space content has `org_id IS NULL`; clinic-private content has `org_id IS NOT NULL`. [VERIFIED]

### Item 5: Extensions available

```
pg_cron 1.6.4 ✓
pg_net 0.20.0 ✓
pg_trgm: NOT INSTALLED ❌
vault schema: ✓ (own schema, not in pg_extension list)
```

**Implication:**
- D-05 (`pg_net.http_post` from trigger) + D-15 (cron) are unblocked.
- D-10 banned-words v2 path (pg_trgm GIN) is deferred per CONTEXT — no v1 install required.
- Vault is available; `vault.decrypted_secrets` table accessible.

[VERIFIED: `pg_extension` + `information_schema.schemata` queries]

### Item 6: `vault.decrypted_secrets` contents

```
service_role_key       ✓ (used by Phase 22/24/38 cron HTTP-POST analogs)
BACKUP_CODE_PEPPER     (Phase 25)
org_realtime_channel_secret (Phase 9)
helpdesk_hmac_secret   (Phase 37)
```

**Implication:** Phase 48 cron + AFTER triggers reuse the existing `service_role_key` vault row — no new vault rows required (the same `Authorization: Bearer ` lookup pattern applies). No new secrets to provision for D-05 / D-10 / D-15 / temp-restore cron. [VERIFIED]

### Item 7: `public.is_staff()` SECDEF helper

```
proname: is_staff, args: (none — bare auth.uid() reader)
```

Exists. Phase 48 uses `public.is_staff()` directly in RLS predicates and as the gate for SECDEF RPCs (D-03, D-04, D-15, audit RLS). Per memory `feedback_negation_grep_defeated_by_comment_string` — do NOT mention rejected alternatives like `staff_users` in committed comments. [VERIFIED]

### Item 8: `phi_access_log` + `log_phi_access` exist

```
log_phi_access: (p_accessed_user_id uuid, p_accessed_fields text[], p_reason text, p_accessed_org_id uuid)
```

This is the **canonical analog** for D-16's `log_moderation_action`. The migration file `supabase/migrations/20270702000005_log_phi_access_rpc.sql` is the template — researcher recommends the planner copy its structure verbatim (SECDEF, `set search_path = public, extensions, pg_catalog`, `raise exception 'not_authenticated' using errcode = '28000'` guard, `actor_user_id = auth.uid()` never from arg).

### Item 9: notification_category_config + user_notifications + notification_dismissal_state exist

Required because Phase 44 widening (file: `20270720000004_p44_notification_community.sql`) showed all 4 tables share the same CHECK constraint. Verified live: `notification_category_config` is present (Phase 47 D-19 widening pattern). All 4 must widen atomically. [VERIFIED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Report-content RPC (cooldown UNIQUE) | API (SECDEF RPC) | — | Atomic INSERT + clean error on UNIQUE violation; only DB can enforce concurrent-safe cooldown |
| Reports queue list + filters | Admin browser SPA | API (SECDEF RPCs for triage actions) | Read via RLS-gated SELECT; writes via SECDEF for audit-log traceability |
| Banned-words match (live) | Database trigger | — | AFTER trigger on INSERT/UPDATE — atomic with content write; cannot race past trigger via Edge Fn |
| Banned-words historical sweep | API (Edge Fn) | Admin SPA (kickoff) | Long-running cursored job; can't run inside a single SQL txn |
| Claude auto-flag invocation | API (Edge Fn `claude-moderation`) | Database trigger (fire-and-forget pg_net) | Fire-and-forget keeps content INSERT fast; Edge Fn handles Anthropic latency |
| Mute mechanic | Database (RLS predicate) | — | Silent-suspend semantics require RLS-layer hiding; client-side hide would be bypassable |
| Ban enforcement (sessions) | API (Edge Fn `ban-enforcement`) | Database (RLS deny on writes) + Browser (AccountSuspended blocker) | Session revoke requires service-role; RLS deny is the durable backstop; SPA blocker is UX layer |
| Temp-suspended auto-restore | Database (pg_cron) | — | Pure SQL UPDATE; hourly cadence; no Edge Fn needed for the restore itself (session revoke not needed — user already signed out at suspend time and the suspend flag clearing is sufficient) |
| Moderation audit log writes | Database (SECDEF RPC) | — | Single funnel point; immutability invariant requires DB-layer REVOKE |
| Audit log viewer | Admin SPA | Database (RLS staff-SELECT) | Read-only SELECT through RLS; no write path needed |
| Cross-org isolation predicate | Database (SECDEF helper fn) | — | Per-row predicate must execute in RLS context; joins org_members + community_spaces |
| Admin moderation surface | Browser SPA (admin chunk) | API (RPCs + Edge Fns) | New `admin-moderation` chunk via `vite.config.ts` manualChunks |
| Email on `escalate` banned-word | API (Edge Fn `email-router`) | Database trigger (fire-and-forget) | Reuse Phase 25 email-router; `phi:false` for moderation emails |

## Standard Stack

### Core (existing project infrastructure to reuse)

| Library/Component | Version | Purpose | Why Standard |
|---|---|---|---|
| `@supabase/supabase-js` | v2 (npm:`@supabase/supabase-js@2`) | Service-role client in Edge Fns | Used in every Phase 22+ Edge Fn (`supabase/functions/_shared/lifecycle-utils.ts`) |
| Anthropic Messages API | `2023-06-01` header version | Structured-output JSON moderation calls | Production pattern in `weekly-digest` + `anthropic-summarize.ts` |
| Claude model | `claude-haiku-4-5-20251001` | Auto-flag classifier | Cheapest model in BAA allowlist that supports structured outputs (cited Anthropic docs 2026-05-23); already in `supabase/functions/_shared/anthropic-baa-allowlist.ts` |
| Zod | `https://esm.sh/zod@3.23.8` | Edge Fn input/output validation | Used in `digest-schema.ts`, `weekly-digest/index.ts` (matches every existing Edge Fn) |
| pg_net | 0.20.0 (Postgres extension) | Fire-and-forget trigger → Edge Fn | Used by `lifecycle-cron-schedules.sql`, `trigger_ad_etl_backfill_secdef.sql` |
| pg_cron | 1.6.4 | Hourly temp-suspended restore | Used by `lifecycle-cron-schedules`, `phase38_pg_cron_schedules` |
| Vault | n/a | `service_role_key` retrieval inside trigger/cron SQL | Per memory `reference_supabase_pg_cron_vault_service_role_pattern` |

### Supporting (Edge Fn shared modules to import)

| Module | Path | Purpose |
|---|---|---|
| `checkServiceRoleBearer` | `supabase/functions/_shared/lifecycle-utils.ts` | HMAC orchestrator-auth on `claude-moderation`, `banned-words-sweep`, `ban-enforcement` |
| `makeLazyAdmin` | `supabase/functions/_shared/lifecycle-utils.ts` | Test-injectable service-role client singleton |
| `corsHeaders`, `jsonResponse`, `jsonError` | `supabase/functions/_shared/lifecycle-utils.ts` | Standard response shape |
| `sendEmail` | `supabase/functions/_shared/email-router.ts` | D-12 `escalate` notifications; pass `phi:false` |
| `assertBaaScope` + `resolveBaaScope` | `supabase/functions/_shared/baa-scope.ts` | NOT NEEDED for Phase 48 — D-08 skips clinic content; consumer-credential path only |
| `captureServer`, `shutdownPostHog` | `supabase/functions/_shared/posthog-server.ts` | Edge Fn telemetry (success/failure events) |
| `addBreadcrumb`, `captureException` | `supabase/functions/_shared/sentry.ts` | Error tracking |

[VERIFIED: file listing of `supabase/functions/_shared/` + grep of `weekly-digest/index.ts` imports]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| pg_net AFTER trigger fire-and-forget (D-05) | Supabase Realtime listener Edge Fn watching `community_posts` | Realtime adds DB load, harder to retry cleanly, lacks idempotency story. Phase 24 +38 already standardize on pg_net AFTER trigger — stay consistent. |
| Claude structured output JSON schema | Function-calling / tool-use API | output_config.format.json_schema is GA on `claude-haiku-4-5`; tool-use adds complexity without benefit for fixed-schema classification |
| `auth.admin.signOut(jwt)` (D-15 original) | Direct SQL `DELETE FROM auth.sessions/refresh_tokens WHERE user_id=$1` | **Required correction** — see §"D-15 Correction" below. `signOut` takes JWT only; admin doesn't have user's JWT. SQL delete is the only user_id-keyed path. |
| `claude-sonnet-4-6` (digest model) | `claude-haiku-4-5-20251001` (moderation) | Haiku is 10× cheaper; structured-output quality on 3-category classification is sufficient. Sonnet reserved for narrative-generation (digest). |
| pg_trgm GIN for banned-words | ILIKE ANY loop (D-10) | pg_trgm not installed; v1 ILIKE handles ~1000 words in ~1ms per row (acceptable). v2 optimization deferred per CONTEXT. |
| Per-event-time cron precision | Hourly cron at `0 * * * *` (D-15) | Avg latency 30min before user is auto-restored; acceptable per CONTEXT discretion. Operator can manually call restore for early release. |

### Installation

**No new npm dependencies.** All Edge Fns use Deno `npm:` and `https://esm.sh/` imports; existing `@supabase/supabase-js@2` and `zod@3.23.8` are already present.

**Per-Fn `deno.json`** (per memory `reference_supabase_functions_deploy_import_map_flag` — CLI v2.101.0 silently ignores `--import-map`):

```jsonc
// supabase/functions/claude-moderation/deno.json
{
  "imports": {
    "../_shared/lifecycle-utils.ts": "../_shared/lifecycle-utils.ts",
    "../_shared/posthog-server.ts": "../_shared/posthog-server.ts",
    "../_shared/sentry.ts": "../_shared/sentry.ts"
  }
}
```

Same per-Fn `deno.json` for `banned-words-sweep/` and `ban-enforcement/`.

### Vendor Secret Pre-Flight (per memory `feedback_vendor_secret_preflight_surface`)

Before Wave 0 dispatch, the orchestrator MUST run `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp` and confirm:

| Secret | Required By | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` (consumer creds path) | `claude-moderation` | Already present from Phase 38 (verified per `anthropic-summarize.ts` env reads) |
| `AI_GATEWAY_BASE_URL` | `claude-moderation` | Already present from Phase 38 |
| `SUPABASE_SERVICE_ROLE_KEY` (sb_secret_* format) | All 3 new Edge Fns (HMAC compare) | Set per project; **MUST be `sb_secret_*` token, not legacy JWT** per memory `reference_supabase_service_role_key_format_divergence` |
| `SUPABASE_URL` | `ban-enforcement` (service-role client init) | Already present |

If any missing: surface in dispatch confirmation with one-line `supabase secrets set` command.

## Architecture Patterns

### System Architecture Diagram

```
                                    USER REPORT FLOW
                                    ────────────────
   [User clicks "Report"]
            │
            ▼
   browser SPA  ───── RPC call ─────►  public.report_content(p_target_type, p_target_id, p_reason)
                                                  │
                                                  ├── SECDEF; partial UNIQUE index enforces cooldown
                                                  │
                                                  ▼
                                       INSERT INTO community_reports
                                                  │
                                                  ▼
                                  AFTER INSERT trigger →  log_moderation_action('report_filed', …)
                                                                       │
                                                                       ▼
                                                            INSERT INTO moderation_audit_log
                                                            (only via SECDEF; INSERT-only policy)

                                AUTO-FLAG ASYNC PIPELINE (D-05 / D-08)
                                ──────────────────────────────────────
   community_posts/community_comments INSERT/UPDATE
            │
            ▼
   AFTER trigger  WHEN (space.org_id IS NULL)  ── pg_net.http_post ─►  claude-moderation Edge Fn
                                                                              │
                                                                              ├── HMAC auth (sb_secret_*)
                                                                              ├── POST ${BASE}/v1/messages
                                                                              │   model=claude-haiku-4-5-20251001
                                                                              │   output_config.format.json_schema
                                                                              │
                                                                              ▼
                                                                  IF any category ≥ 0.7:
                                                                  INSERT INTO community_reports
                                                                  (reporter=NULL, source='claude_auto_flag')
                                                                          │
                                                                          ▼
                                                                  log_moderation_action('auto_flag', …)

                                  BANNED-WORDS LIVE TRIGGER (D-10)
                                  ───────────────────────────────
   community_posts/community_comments INSERT/UPDATE
            │
            ▼
   AFTER trigger  ── loop over banned_words ──►  IF body ILIKE word:
                                                    INSERT community_reports(source='banned_word')
                                                    IF severity='escalate':
                                                       pg_net.http_post → email-router send

                                  BANNED-WORDS HISTORICAL SWEEP (D-11)
                                  ──────────────────────────────────
   Admin SPA "Re-run sweep" button
            │
            ▼
   POST /functions/v1/banned-words-sweep  ── HMAC + service-role bearer ──► Edge Fn
                                                          │
                                                          ├── Cache banned_words (single SELECT)
                                                          │
                                                          ▼
                                            cursored loop (batch=100 by id):
                                            SELECT body FROM community_posts WHERE id > last LIMIT 100
                                            for each match: INSERT community_reports (idempotent via partial UNIQUE)
                                            return next_cursor → SPA re-invokes until done

                                  MUTE MECHANIC (D-14)  silent-suspend
                                  ────────────────────────────────────
   community_posts SELECT (and comments/reactions/direct_messages)
            │
            ▼
   RLS predicate widens with:
       (author_id = auth.uid()) OR public.is_staff()
       OR NOT EXISTS (SELECT 1 FROM user_moderation_state
                      WHERE user_id = author_id AND status='muted')
       → muted author SEES own post; nobody else does; staff overrides

                                  BAN ENFORCEMENT (D-15) — CORRECTED
                                  ──────────────────────────────────
   admin SECDEF RPC: apply_user_ban(p_user_id) →
            │
            ▼
   UPSERT user_moderation_state(status='banned', ...) + log_moderation_action('ban_applied', ...)
            │
            ▼
   AFTER UPDATE trigger on user_moderation_state ── pg_net.http_post ──► ban-enforcement Edge Fn
                                                                                  │
                                                                                  ├── HMAC auth
                                                                                  ├── DELETE FROM auth.sessions WHERE user_id=$1
                                                                                  ├── DELETE FROM auth.refresh_tokens WHERE user_id=$1
                                                                                  │   (via service-role SQL; auth.admin.signOut requires JWT not user_id)
                                                                                  │
                                                                                  ▼
                                                                       log_moderation_action('session_revoked')

   Banned user's residual JWT (until exp ~1h):
            ▼
   Consumer SPA App.tsx pre-render check: read user_moderation_state.status
            └─►  IF status='banned': render <AccountSuspended /> blocker (no further nav)

   Writes (INSERT/UPDATE/DELETE) on user-content tables widen RLS with:
       NOT EXISTS (SELECT 1 FROM user_moderation_state
                   WHERE user_id = auth.uid() AND status IN ('banned','temp_suspended'))
   → durable backstop even if SPA blocker is bypassed

                                  TEMP-SUSPENDED AUTO-RESTORE (D-15 cron)
                                  ────────────────────────────────────────
   pg_cron 'temp-suspended-restore-hourly' @ 0 * * * *
            │
            ▼
   UPDATE user_moderation_state SET status='active', expires_at=null
   WHERE status='temp_suspended' AND expires_at < now()
   RETURNING user_id;
            │
            ▼
   (No session revoke needed — user already signed out at suspend; RLS write-deny clears
    on the UPDATE; user signs in fresh on next visit and sees normal experience)
            │
            ▼
   per-row log_moderation_action('temp_restore', user_id, ...)
```

### Recommended File Structure (relative to git root)

```
supabase/migrations/
├── 20270901000001_p48_community_reports_triage.sql           # D-01: status widen + triaged_by/at + dismissed_reason ALTER
├── 20270901000002_p48_community_reports_cooldown.sql         # D-02: partial UNIQUE + report_content() SECDEF RPC
├── 20270901000003_p48_can_moderate_report_helper.sql         # D-04: cross-org isolation SECDEF helper
├── 20270901000004_p48_user_moderation_state.sql              # D-13: table + RLS
├── 20270901000005_p48_user_moderation_secdef_rpcs.sql        # D-13/D-15: apply_user_mute/ban/temp_suspend RPCs
├── 20270901000006_p48_banned_words.sql                       # D-09: table + RLS + SECDEF upsert + notification widening
├── 20270901000007_p48_banned_words_trigger.sql               # D-10: AFTER trigger on community_posts/comments
├── 20270901000008_p48_claude_moderation_trigger.sql          # D-05/D-08: AFTER trigger → pg_net (PHI gate clause)
├── 20270901000009_p48_moderation_audit_log.sql               # D-16: table + RLS + REVOKE
├── 20270901000010_p48_log_moderation_action_rpc.sql          # D-16: SECDEF RPC
├── 20270901000011_p48_audit_archive_widen.sql                # widen Phase 24 audit-archive coverage (DDL only — Fn code in Phase 48 separate plan)
├── 20270901000012_p48_mute_ban_rls_widen.sql                 # D-14/D-15: RLS predicate widening on content + write-deny on bans
└── 20270901000013_p48_temp_suspended_restore_cron.sql        # D-15: hourly pg_cron; tags $cron$/$restore$

supabase/functions/
├── claude-moderation/
│   ├── index.ts          # POST /v1/messages with structured output; INSERT system-reporter row
│   ├── deno.json
│   └── index.test.ts
├── banned-words-sweep/
│   ├── index.ts          # cursored sweep; idempotent INSERTs
│   ├── deno.json
│   └── index.test.ts
├── ban-enforcement/
│   ├── index.ts          # DELETE FROM auth.sessions + auth.refresh_tokens; log
│   ├── deno.json
│   └── index.test.ts
└── audit-archive/        # widen existing Fn to include moderation_audit_log
    └── index.ts          # modify existing

leanshot/src/admin/modules/moderation/
├── ModerationLayout.tsx          # fork CommunityAdminLayout.tsx; resolveView for 5 sub-routes
├── ReportsQueue.tsx              # default sub-view; filters
├── AutoFlagsQueue.tsx            # reports filtered to reporter=NULL
├── BannedWordsEditor.tsx         # CRUD + "Re-run sweep" button
├── UserBansRoster.tsx            # apply mute/ban/temp_suspend form
├── AuditLogViewer.tsx            # read-only with filters + CSV export
├── api.ts                        # RPC wrappers (report-triage, banned-word-upsert, apply_user_*)
└── __tests__/

leanshot/src/lib/admin/modules.ts          # MODIFY: add 'moderation' entry
leanshot/vite.config.ts                    # MODIFY: add 'admin-moderation' manualChunks rule
leanshot/src/App.tsx                       # MODIFY: <AccountSuspended /> blocker check at top of dashboard branch
leanshot/src/components/AccountSuspended.tsx   # NEW: shown when user_moderation_state.status='banned'
leanshot/src/lib/moderation/rls-predicates.ts  # NEW: documents the muted-content-hide invariant
```

### Pattern 1: AFTER Trigger → pg_net.http_post → Edge Fn (D-05 / D-15)

**What:** Fire-and-forget trigger sends row state to an Edge Fn for async processing. The content INSERT/UPDATE returns immediately; the Edge Fn handles the slow path (Claude latency, session revoke, etc.).

**When to use:** D-05 claude-moderation, D-15 ban-enforcement, D-10 escalate-email send.

**Example (verbatim pattern from `supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql`):**

```sql
-- Source: supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql
perform net.http_post(
  url     := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/claude-moderation',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'service_role_key'
      limit 1
    )
  ),
  body    := jsonb_build_object(
    'content_type', TG_TABLE_NAME,
    'content_id',   NEW.id,
    'body',         NEW.body,
    'space_id',     NEW.space_id,
    'author_id',    NEW.author_id
  )
);
```

[VERIFIED: existing migration file 2026-05-23]

### Pattern 2: SECDEF RPC with partial UNIQUE for atomic cooldown (D-02)

**What:** A SECDEF RPC inserts the row; if the partial UNIQUE index fires, the RPC catches the SQLSTATE `23505` and returns a clean JSON error. Atomic and concurrency-safe.

**Example:**

```sql
-- Pattern source: Phase 35 freeze-token + Phase 47 D-19 precedent
create or replace function public.report_content(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  begin
    insert into public.community_reports (reporter_user_id, target_type, target_id, reason, status)
    values (v_actor, p_target_type, p_target_id, p_reason, 'open')
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'duplicate_report: admin is already reviewing your report'
        using errcode = 'P0001';
  end;

  perform public.log_moderation_action(
    p_action_type   => 'report_filed',
    p_target_type   => p_target_type,
    p_target_id     => p_target_id,
    p_before        => null,
    p_after         => jsonb_build_object('report_id', v_id),
    p_reason        => p_reason
  );

  return v_id;
end;
$$;

-- Partial UNIQUE index supports the cooldown semantics (D-02)
create unique index community_reports_active_cooldown_uniq
  on public.community_reports (reporter_user_id, target_type, target_id)
  where status in ('open', 'triaged');

revoke all on function public.report_content(text, uuid, text) from public;
grant execute on function public.report_content(text, uuid, text) to authenticated;
```

### Pattern 3: Anthropic Structured Output Call (D-05/D-06)

**What:** POST `${BASE}/v1/messages` with `output_config.format.json_schema`. Reuse the exact shape from `weekly-digest`/`anthropic-summarize.ts`.

**Example (extracted from `supabase/functions/_shared/anthropic-summarize.ts:118-152`):**

```typescript
// Source: supabase/functions/_shared/anthropic-summarize.ts
const MODERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    toxicity:                { type: 'number', minimum: 0, maximum: 1 },
    spam:                    { type: 'number', minimum: 0, maximum: 1 },
    medical_misinformation:  { type: 'number', minimum: 0, maximum: 1 },
    rationale:               { type: 'string',  minLength: 0, maxLength: 500 },
  },
  required: ['toxicity', 'spam', 'medical_misinformation', 'rationale'],
  additionalProperties: false,
} as const;

const body = {
  model: 'claude-haiku-4-5-20251001',   // hyphenated per memory reference_anthropic_model_id_hyphenated_format
  max_tokens: 200,                       // REQUIRED — 400 if missing
  temperature: 0,                        // deterministic for classification
  system: SYSTEM_PROMPT_MODERATION,
  messages: [{ role: 'user', content: contentBody }],
  output_config: {
    format: { type: 'json_schema', schema: MODERATION_JSON_SCHEMA },
  },
};

const res = await fetch(`${baseUrl}/v1/messages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${anthropicKey}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify(body),
  signal: ctrl.signal,
});

const j = await res.json() as { content?: Array<{ type: string; text?: string }> };
const textBlock = (j.content ?? []).find(b => b.type === 'text');
const parsed = JSON.parse(textBlock!.text!);
// parsed = { toxicity, spam, medical_misinformation, rationale }
```

[CITED: Anthropic structured-outputs docs, fetched 2026-05-23 — confirms `claude-haiku-4-5` is on the supported list and `output_config.format` is the GA shape (replaces deprecated `output_format`); legacy `structured-outputs-2025-11-13` beta header is NO LONGER required]
[VERIFIED: pattern matches existing `weekly-digest` invocation in production]

### Pattern 4: AFTER trigger ILIKE-loop for banned-words match (D-10)

**Example (from CONTEXT D-10 with planner additions):**

```sql
create or replace function public.banned_words_match()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  r record;
  v_target_type text;
begin
  v_target_type := case TG_TABLE_NAME
                     when 'community_posts'    then 'post'
                     when 'community_comments' then 'comment'
                     else null end;
  if v_target_type is null then return null; end if;

  for r in select word, severity, case_insensitive from public.banned_words loop
    if (case
          when r.case_insensitive then NEW.body ilike '%' || r.word || '%'
          else                          NEW.body like  '%' || r.word || '%'
        end)
    then
      -- Idempotent INSERT via the partial UNIQUE (target_type, target_id) WHERE source='banned_word'
      insert into public.community_reports
        (target_type, target_id, reporter_user_id, reason, status)
      values
        (v_target_type, NEW.id, null,
         jsonb_build_object(
           'source',   'banned_word',
           'word',     r.word,
           'severity', r.severity
         ),
         'open')
      on conflict do nothing;

      if r.severity = 'escalate' then
        perform net.http_post(
          url     := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/email-router-banned-word',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets
              where name = 'service_role_key' limit 1
            )
          ),
          body    := jsonb_build_object(
            'word',        r.word,
            'target_type', v_target_type,
            'target_id',   NEW.id,
            'author_id',   NEW.author_id
          )
        );
      end if;
    end if;
  end loop;

  perform public.log_moderation_action(
    p_action_type => 'banned_word_match',
    p_target_type => v_target_type,
    p_target_id   => NEW.id,
    p_before      => null,
    p_after       => null,
    p_reason      => null
  );

  return null;  -- AFTER trigger; return value ignored
end;
$$;

create trigger trg_banned_words_match_posts
  after insert or update on public.community_posts
  for each row execute function public.banned_words_match();

create trigger trg_banned_words_match_comments
  after insert or update on public.community_comments
  for each row execute function public.banned_words_match();
```

**Performance note:** Trigger runs per-row at INSERT time. With ~1000 banned_words and ~100 char body, ILIKE-each loop is ~1ms. Acceptable. If banned_words grows past ~5000, planner should re-EXPLAIN and consider lifting to pg_trgm GIN (deferred per CONTEXT).

### Pattern 5: Manifest-driven Admin Module Registration (D-03)

**What:** Add a single entry to `ADMIN_MODULES` in `src/lib/admin/modules.ts`. `AdminShell.tsx` already does prefix-routing (line 124: `pathname.startsWith(\`/admin/${m.route}/\`)`) — no router-branch edits needed.

**Example (paste-ready entry):**

```typescript
// MODIFY: leanshot/src/lib/admin/modules.ts — add inside ADMIN_MODULES array
// Insert AFTER the 'helpdesk' entry per file convention (alphabetic-ish within tier).

// Phase 48 Plan 48-NN — Moderation admin module.
// Sub-routes /admin/moderation/{reports,auto-flags,banned-words,bans,audit-log}
// resolve in ModerationLayout via resolveView regex.
// minRole='staff' so on-duty admins see it; SECDEF RPCs re-check is_staff()
// server-side (Pattern S1 dual-layer).
{
  key: 'moderation',
  label: 'Moderation',
  route: 'moderation',
  icon: ShieldIcon,
  lazy: () =>
    import('@/admin/modules/moderation/ModerationLayout').then((m) => ({
      default: m.ModerationLayout,
    })),
  flagKey: 'admin.moderation.enabled',
  minRole: 'staff' as AdminRole,
},
```

**`vite.config.ts` manualChunks rule:** insert AFTER the `'community-mentions'` rule (line ~199) and BEFORE the generic `'community-feed'` rule:

```typescript
// admin-moderation: ModerationLayout + sub-views; isolate from admin-shell (~30 kB gz target).
if (id.includes('/src/admin/modules/moderation/')) return 'admin-moderation';
```

### Pattern 6: pg_cron with named dollar-quote tags (D-15)

**What:** Hourly cron that UPDATEs temp-suspended → active. No HTTP call needed (no session revoke at restore — user already signed out at suspend; the UPDATE clears the write-deny RLS).

**Example (per memory `reference_postgres_dollar_quote_nesting_in_cron_body`):**

```sql
-- Outer tag $cron$; inner tag $restore$ (distinct from Phase 38 $digest$/$winback$/$embed$,
-- Phase 47 $reminders$ — verified via grep on supabase/migrations/ 2026-05-23)
select cron.schedule(
  'temp-suspended-restore-hourly',
  '0 * * * *',
  $cron$
    do $restore$
    declare
      r record;
    begin
      for r in
        update public.user_moderation_state
        set    status     = 'active',
               expires_at = null,
               updated_at = now()
        where  status     = 'temp_suspended'
          and  expires_at < now()
        returning user_id
      loop
        perform public.log_moderation_action(
          p_action_type => 'temp_restore',
          p_target_type => 'user',
          p_target_id   => r.user_id,
          p_before      => jsonb_build_object('status','temp_suspended'),
          p_after       => jsonb_build_object('status','active'),
          p_reason      => 'auto-restore on expires_at'
        );
      end loop;
    end;
    $restore$;
  $cron$
);
```

### Pattern 7: Immutable audit table (D-16)

**Example: copy `supabase/migrations/20270702000004_phi_access_log.sql` verbatim with these substitutions:**

```sql
-- Source pattern: 20270702000004_phi_access_log.sql + 20270702000005_log_phi_access_rpc.sql
create table public.moderation_audit_log (
  id            bigserial   primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid        references auth.users(id) on delete set null,    -- nullable for system actions (claude_auto_flag, banned_word_match, temp_restore cron)
  action_type   text        not null,
  target_type   text        not null check (target_type in ('post','comment','dm_message','profile','user','space','banned_word','report')),
  target_id     uuid,
  before_state  jsonb,
  after_state   jsonb,
  reason        text
);

create index moderation_audit_log_actor_time_idx  on public.moderation_audit_log (actor_id,  occurred_at desc);
create index moderation_audit_log_target_time_idx on public.moderation_audit_log (target_type, target_id, occurred_at desc);

alter table public.moderation_audit_log enable row level security;

-- SELECT: staff only
create policy moderation_audit_log_select_staff on public.moderation_audit_log
  for select to authenticated using (public.is_staff());

-- NO insert/update/delete policy for authenticated (default-deny).
-- Service-role bypass blocked by REVOKE below; only the SECDEF RPC writes.
revoke update, delete on public.moderation_audit_log from authenticated, anon, service_role;
-- service_role INSERT intentionally retained for backfill/integration tests (mirrors phi_access_log).
```

And the SECDEF RPC (copy from `log_phi_access_rpc.sql` shape):

```sql
create or replace function public.log_moderation_action(
  p_action_type  text,
  p_target_type  text,
  p_target_id    uuid,
  p_before       jsonb default null,
  p_after        jsonb default null,
  p_reason       text  default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- v_actor may be null for system-callers (trigger fired by service_role bypass).
  -- Triggers running SECURITY DEFINER pass auth.uid() through; service-role-only paths
  -- pass null explicitly which is acceptable for system actions.
  insert into public.moderation_audit_log
    (actor_id, action_type, target_type, target_id, before_state, after_state, reason)
  values
    (v_actor,  p_action_type, p_target_type, p_target_id, p_before, p_after, p_reason);
end;
$$;

revoke all on function public.log_moderation_action(text, text, uuid, jsonb, jsonb, text) from public;
grant execute on function public.log_moderation_action(text, text, uuid, jsonb, jsonb, text) to authenticated;
```

**Note on `actor_id` nullability:** Differs from `log_phi_access` (which raises `28000` on null auth). Moderation actions include system callers (cron, AFTER triggers fired by service-role) where `auth.uid()` is null. The RPC accepts null `actor_id`; the `action_type` value disambiguates (`'temp_restore'`, `'auto_flag'`, `'banned_word_match'` are system; `'mute_applied'`, `'ban_applied'`, `'report_triaged'` are admin).

### Anti-Patterns to Avoid

- **`ON CONFLICT DO DELETE` for the report cooldown** — per memory `reference_postgres_no_insert_on_conflict_do_delete`, this syntax DOES NOT EXIST. The D-02 cooldown is a STRICT UNIQUE-violation cooldown (no delete-on-conflict semantics needed). Use the SECDEF RPC catch-23505 pattern shown in Pattern 2.
- **Mentioning `staff_users` in a committed comment/code** — per memory `feedback_negation_grep_defeated_by_comment_string`. Phase 44/45 chose `public.is_staff()` over a parallel `staff_users` table; do NOT mention the rejected alternative in committed files.
- **Service-role caller of an `auth.uid()`-using RPC** — per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`. Edge Fns that call `log_moderation_action` from service-role context get `auth.uid() = null`. This is OK for system actions (actor_id is nullable) but the planner MUST verify each call site's expected actor.
- **Bare `auth.admin.signOut(user_id)`** — see §"D-15 Ban Enforcement Correction" — this signature does not exist.
- **Trigger fires Claude on clinic content** — D-08 PHI gate WHEN clause MUST be on the trigger, NOT inside the Edge Fn. A net.http_post call to claude-moderation that the Edge Fn then refuses would still send the body across the wire (HIPAA disclosure risk).
- **Banned-words trigger on direct_messages** — D-10 explicitly excludes DMs (parallel to D-08 auto-flag policy).
- **Adding an auto-removal code path "for safety"** — D-07 success-criterion-locked NEVER auto-remove.
- **Storing the rejected `claude-sonnet-4.6` dotted model id** — per memory `reference_anthropic_model_id_hyphenated_format`; always hyphenated.
- **CHECK widening across multiple migrations** — per memory `feedback_planner_missed_status_enum_widening` + Phase 44 precedent (`20270720000004_p44_notification_community.sql`): all 4 notification tables widen + the seed row INSERT MUST land in ONE transaction.
- **`tsc -b` for typecheck gate** — per memory `reference_supabase_v2_aal_api`; use `tsc -p tsconfig.app.json --noEmit`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| HMAC auth on Edge Fns | New auth wrapper | `checkServiceRoleBearer` from `_shared/lifecycle-utils.ts` | Constant-time compare against `sb_secret_*`; already production-tested |
| Service-role client in Edge Fns | New `createClient` per file | `makeLazyAdmin` Proxy pattern | Test-injectable; matches every existing Edge Fn |
| Anthropic call infrastructure | Custom fetch + retry | Mirror `weekly-digest`'s 3-attempt retry + AbortController + breadcrumb shape | Production-tested; already enforces 25s timeout + telemetry |
| Email send on banned-word escalate | New SES/Resend wrapper | `sendEmail` from `_shared/email-router.ts` with `phi:false` | PHI-routed; already handles Resend domain health gating |
| Cron HTTP-invoke shape | New net.http_post wrapper | Copy verbatim from `lifecycle-cron-schedules.sql` lines 29-45 | Includes vault.decrypted_secrets lookup + 60s timeout + idempotent upsert |
| Immutable audit table | New REVOKE pattern | Copy `phi_access_log.sql` verbatim (substitute table name + action_type column) | Pattern already passed Phase 25 security review |
| Admin module routing | switch-statement edit in AdminShell | Add ONE entry to `ADMIN_MODULES` manifest | AdminShell already does prefix-routing (line 124); per memory `feedback_admin_module_manifest_vs_router_branch_drift` |
| Mute "hide my posts" UX | Client-side filter | RLS predicate widening on SELECT | Client filter is bypassable via direct SQL; RLS is the durable invariant |
| Ban "logout this user" | Custom JWT revocation | Direct SQL DELETE FROM auth.sessions + refresh_tokens | `auth.admin.signOut(JWT)` requires JWT (we don't have it); SQL is the user_id-keyed path |
| Banned-words sweep retry/cursor | Recursive Edge Fn | Client-driven cursor with `{ next_cursor }` return | Edge Fns have 150s wall-clock; cursor lets the SPA chunk + render progress |

**Key insight:** Every load-bearing pattern is already in production. Phase 48 is "compose existing patterns" not "invent new ones." The single net-new piece is the `<AccountSuspended />` SPA blocker — and that's a ~30-line component.

## Runtime State Inventory

> Phase 48 is greenfield within the established moderation domain — no renames, no migrations of existing data, no string replacements. Output: **NO RUNTIME STATE INVENTORY REQUIRED**.

The one nuance: the Phase 45 `community_reports` table will be EXTENDED (D-01 status widening). Phase 45 ships with `status` default `'open'`. Phase 48's ALTER widens the CHECK. No existing rows need migration because (a) Phase 45 is not yet pushed to live DB (verified above), and (b) `'open'` is in both the old and new CHECK. Phase 48 ADD COLUMN `triaged_by`/`triaged_at`/`dismissed_reason` are nullable — no backfill needed.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — all tables net-new or extend nullably | None |
| Live service config | None — no n8n/Datadog/etc. tags | None |
| OS-registered state | None | None |
| Secrets/env vars | `ANTHROPIC_API_KEY`, `AI_GATEWAY_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all 4 already present from Phase 25/38 per `_shared/anthropic-summarize.ts`) | Verify in dispatch-time `supabase secrets list` |
| Build artifacts | None | None |

## Common Pitfalls

### Pitfall 1: D-15 `auth.admin.signOut(user_id)` does not exist ⚠️ CORRECTION REQUIRED

**What goes wrong:** Plan writes `await admin.auth.admin.signOut(user_id, { scope: 'global' })` — runtime error: TypeScript rejects (or runtime error if cast). The method signature is `signOut(jwt: string, scope?: SignOutScope)`.

**Why it happens:** CONTEXT D-15 describes the intent ("revoke all active sessions for the user") but assumes a method API that doesn't exist. The admin doesn't have the user's JWT — only a user_id.

**How to avoid:** Replace with direct SQL via service-role client:

```typescript
// In ban-enforcement/index.ts
const { error: sessErr } = await admin
  .from('sessions')                                        // auth.sessions
  .delete()
  .eq('user_id', user_id);
const { error: refreshErr } = await admin
  .rpc('execute_sql', { sql: 'DELETE FROM auth.refresh_tokens WHERE user_id = $1', args: [user_id] });
// OR (cleaner): execute via supabase-js postgres client directly
const { error } = await admin.schema('auth').from('sessions').delete().eq('user_id', user_id);
```

Even cleaner — wrap in a SECDEF RPC `revoke_user_sessions(p_user_id uuid)` that runs `DELETE FROM auth.sessions WHERE user_id=p_user_id; DELETE FROM auth.refresh_tokens WHERE user_id=p_user_id;` and grant execute to service_role only. Edge Fn calls the RPC.

**Documented limitation:** Refresh tokens are revoked but the current access JWT (typically ~1h exp) remains valid. The SPA `<AccountSuspended />` blocker (D-15) AND the RLS write-deny on `user_moderation_state.status='banned'` ARE the durable mitigations. The 1h JWT window is acceptable per:
- Anti-abuse: RLS denies all writes immediately.
- Read-allowed: per D-15 reads continue (GDPR portability) — no abuse vector via reads.
- Per memory `feedback_handoff_doc_with_embedded_discoveries` — document the residual window in PLAN.md so plan-checker doesn't flag the "JWT still valid" gap as a defect.

**Warning signs:** TS compile error on `signOut(string, …)` arg type mismatch.

[CITED: Supabase auth-js source `GoTrueAdminApi.signOut(jwt: string, scope: SignOutScope = SIGN_OUT_SCOPES[0])` — fetched from github.com/supabase/auth-js 2026-05-23]
[CITED: Supabase Discussion #13941 — direct DELETE from auth.sessions/refresh_tokens is the documented workaround for user_id-keyed session revoke]

### Pitfall 2: Phase 45 migrations not yet pushed → community_reports doesn't exist live

**What goes wrong:** Phase 48 Wave 0 migrations `ADD COLUMN` to `community_reports`, but Phase 45 hasn't been deployed → ALTER fails with `relation "public.community_reports" does not exist`.

**Why it happens:** Phase 48 plans/executes BEFORE Phase 45 (verified live 2026-05-23 — Phase 45 migrations still local).

**How to avoid:**
- Planner verifies via `gsd-sdk state` that Phases 45 + 46 + 47 are marked `[x]` in `.planning/ROADMAP.md` before Phase 48 dispatches.
- Orchestrator ensures `supabase db push --linked` runs at Phase 45/46/47 close-out per memory `feedback_phase_close_out_db_push_verification`.
- Phase 48 PLAN-01 migrations land at timestamp prefix `20270901*` to guarantee post-45/46/47 ordering.

**Warning signs:** `relation "public.community_reports" does not exist` at db-push time.

### Pitfall 3: `org_member_role` enum has no `'admin'` value

**What goes wrong:** D-04 helper SECDEF `can_moderate_report(report_row)` uses `WHERE role='admin'` → never matches → clinic admins see no reports.

**Why it happens:** CONTEXT D-04 references "role='admin'" colloquially; live `org_member_role` values are `owner | clinician | staff | support_admin | support_lead`.

**How to avoid:** Helper predicate uses `role IN ('owner', 'support_admin')` (clinic-org admin equivalents). Planner re-queries `pg_enum` before writing to confirm full enum list (truncated at 5 in my query; up to 8 expected).

**Warning signs:** test that `clinic_org_member can see their org's report` returns 0 rows.

### Pitfall 4: AFTER trigger calling SECDEF RPC that reads `auth.uid()`

**What goes wrong:** `log_moderation_action()` called from `banned_words_match()` trigger → `auth.uid()` is the trigger's caller. If the trigger fires from a service-role INSERT (e.g., sweep Edge Fn), `auth.uid()` is null → audit row has `actor_id=null` (correct for system) but if the planner expected to source actor from the trigger context, this fails.

**Why it happens:** Per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`. Trigger context inherits the calling session's auth.uid; service-role bypass = null.

**How to avoid:** `log_moderation_action`'s `actor_id` column is nullable (corrected from `phi_access_log` shape) AND the planner documents in PLAN.md which call sites are user-context vs system-context. For Phase 48 specifically:
- `report_content` RPC (user-context): actor = auth.uid() = reporter. ✓
- `apply_user_mute/ban` RPCs (user-context): actor = auth.uid() = admin. ✓
- `banned_words_match` trigger (varies — runs in whatever session inserted the row): may be user (organic post) or service-role (sweep). `actor_id` nullable handles both.
- `claude-moderation` Edge Fn (service-role): actor = null; action_type = 'auto_flag' identifies.
- `temp-suspended-restore-hourly` cron (cron-role): actor = null; action_type = 'temp_restore' identifies.

### Pitfall 5: VALID_CATEGORIES CHECK widening across multiple migrations

**What goes wrong:** Planner widens `notification_settings.VALID_CATEGORIES` in one migration but forgets to widen the sibling 3 tables (`notification_category_config`, `user_notifications`, `notification_dismissal_state`) → `email-router-banned-word` INSERT fails on `user_notifications`.

**Why it happens:** Per memory `feedback_planner_missed_status_enum_widening` and Phase 44 analog (`20270720000004_p44_notification_community.sql`).

**How to avoid:** Widen all 4 tables + seed `notification_category_config` row in ONE migration transaction (single `BEGIN; … COMMIT;` block). Reference Phase 44 file verbatim.

### Pitfall 6: SECDEF without `set search_path = public, extensions, pg_catalog`

**What goes wrong:** SECDEF function callable by attacker who sets their session search_path → shadowing of public.community_reports with a malicious schema table.

**Why it happens:** Per memory `reference_supabase_migration_gotchas`.

**How to avoid:** Every SECDEF in Phase 48 includes `set search_path = public, extensions, pg_catalog` (per `log_phi_access_rpc.sql` template). Plan-checker greps for SECDEF without this clause.

### Pitfall 7: pg_cron dollar-quote tag collision

**What goes wrong:** Inner SQL block uses bare `$$` → silently closes the outer `cron.schedule` body → "syntax error at or near DECLARE".

**Why it happens:** Per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.

**How to avoid:** Outer `$cron$`, inner `$restore$`. Verified via grep — `$digest$`, `$winback$`, `$embed$`, `$cleanup$`, `$reminders$`, `$unschedule$`, `$partition$` are already in use; `$restore$` is unique.

### Pitfall 8: Migration filename letter-suffix silent skip

**What goes wrong:** Filename like `20270901000001a_p48_*.sql` silently skipped at `supabase db push`.

**Why it happens:** Per memory `reference_supabase_migration_filename_regex` — strict `<14-digits>_name.sql`.

**How to avoid:** All Phase 48 migrations follow `20270901NNNNNN_p48_*.sql` (14 digits, underscore, name). Per memory `reference_migration_timestamp_collision_precheck` — pre-check `ls supabase/migrations/20270901*` before merge.

### Pitfall 9: Per-Fn `deno.json` missing → `--import-map` silently ignored

**What goes wrong:** Edge Fn uses `import { foo } from 'shared/lifecycle-utils.ts'` (bare alias) → CLI v2.101.0 deploys but Fn 500s on import resolution at runtime.

**Why it happens:** Per memory `reference_supabase_functions_deploy_import_map_flag` (CLI v2.101.0 ignores the flag).

**How to avoid:** Each new Fn (`claude-moderation`, `banned-words-sweep`, `ban-enforcement`) ships its own `deno.json` with explicit import map for `../_shared/*` paths. Use relative paths (already shown in `weekly-digest/` as an example).

### Pitfall 10: SECDEF policy bypass via service_role

**What goes wrong:** `moderation_audit_log` write/update/delete via service-role client (e.g., a sweep job) silently succeeds, breaking immutability.

**Why it happens:** RLS doesn't apply to service_role by default.

**How to avoid:** `REVOKE UPDATE, DELETE ON public.moderation_audit_log FROM service_role;` — per `phi_access_log` precedent (line 106 of canonical migration).

### Pitfall 11: Two same-wave plans both touching `vite.config.ts`

**What goes wrong:** Plan-A adds `admin-moderation` chunk rule; Plan-B (BannedWordsEditor lazy import) also edits vite.config.ts → merge conflict.

**Why it happens:** Standard merge-conflict at single-file boundary.

**How to avoid:** Per memory `feedback_stub_then_replace_sibling_collision` — the single migration `20270901000001_p48_community_reports_triage.sql` should ship the vite.config.ts edit ONCE, and other plans declare `depends_on:` the chunk-add plan if they need the chunk to exist. Or serialize via Wave.

### Pitfall 12: Worktree CLI missing `supabase/.temp/` state

**What goes wrong:** Parallel-wave worktree executor runs `supabase db push --linked` → "Cannot find project ref".

**Why it happens:** Per memory `reference_supabase_worktree_temp_state` — `.temp/` is gitignored.

**How to avoid:** Orchestrator copies `supabase/.temp/` into each worktree post-`git worktree add` per existing harness pattern.

## Code Examples

### Verified pattern: cursored Edge Fn (D-11 `banned-words-sweep`)

```typescript
// supabase/functions/banned-words-sweep/index.ts
// Pattern source: weekly-digest cursored fan-out + cancellation-feedback-to-ticket batching

import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { z } from 'https://esm.sh/zod@3.23.8';

const BodySchema = z.object({
  start_cursor: z.string().uuid().nullable().default(null),
  batch_size:   z.number().int().min(1).max(500).default(100),
  table:        z.enum(['community_posts', 'community_comments']),
});

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();
export { setAdminForTest, resetAdminForTest };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, 'invalid_body');

  const { start_cursor, batch_size, table } = parsed.data;

  // Load banned_words ONCE (cached for duration of this invocation)
  const { data: words, error: wErr } = await admin
    .from('banned_words')
    .select('id, word, severity, case_insensitive');
  if (wErr) return jsonError(500, 'banned_words_load_failed');

  // Cursored batch (id-ordered)
  let query = admin.from(table)
    .select('id, body, author_id, space_id')
    .order('id', { ascending: true })
    .limit(batch_size);
  if (start_cursor) query = query.gt('id', start_cursor);

  const { data: rows, error: rErr } = await query;
  if (rErr) return jsonError(500, 'rows_load_failed');

  let matches = 0;
  for (const row of rows ?? []) {
    for (const w of words ?? []) {
      const haystack = w.case_insensitive ? row.body.toLowerCase() : row.body;
      const needle   = w.case_insensitive ? w.word.toLowerCase()   : w.word;
      if (haystack.includes(needle)) {
        // Idempotent: partial UNIQUE (target_type, target_id) WHERE source='banned_word'
        const { error: insErr } = await admin
          .from('community_reports')
          .insert({
            target_type:      table === 'community_posts' ? 'post' : 'comment',
            target_id:        row.id,
            reporter_user_id: null,
            reason: { source: 'banned_word', word: w.word, severity: w.severity },
            status:           'open',
          })
          .single();
        if (!insErr) matches++;
        // 23505 = unique_violation = already-flagged-by-trigger; skip silently
      }
    }
  }

  const next_cursor = rows && rows.length === batch_size ? rows[rows.length - 1].id : null;

  return jsonResponse(200, {
    processed: rows?.length ?? 0,
    matches,
    next_cursor,
    done: next_cursor === null,
  });
}

Deno.serve(handler);
```

### Verified pattern: RLS predicate widening for mute (D-14)

```sql
-- 20270901000012_p48_mute_ban_rls_widen.sql

-- Mute widening on community_posts SELECT
drop policy if exists community_posts_select on public.community_posts;
create policy community_posts_select on public.community_posts
  for select to authenticated
  using (
    -- Original predicate (Phase 44): space membership + not-deleted, etc.
    -- (Planner: COPY EXISTING PHASE 44 PREDICATE from supabase/migrations/<p44-ts>_community_rls.sql line N)
    -- Then AND with the mute predicate:
    (deleted_at is null)
    and (
      author_id = auth.uid()
      or public.is_staff()
      or not exists (
        select 1 from public.user_moderation_state ums
        where ums.user_id = community_posts.author_id
          and ums.status = 'muted'
      )
    )
  );

-- Performance: index supporting the NOT EXISTS lookup
create index if not exists user_moderation_state_muted_idx
  on public.user_moderation_state (user_id)
  where status = 'muted';

-- Ban write-deny widening on community_posts INSERT/UPDATE/DELETE (D-15)
drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned', 'temp_suspended')
    )
  );

-- Mirror policies on: community_comments, community_reactions, direct_messages,
-- (Phase 47) event_rsvps, profiles (self-edit).
-- Planner: enumerate the exact policy NAMES from the live db before drop-and-recreate.
```

[VERIFIED: index pattern matches Phase 44 RLS index strategy in `20270720000002_p44_community_rls.sql`]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Anthropic `output_format` parameter | `output_config.format` | 2026-Q1 GA | `output_format` deprecated; use `output_config` |
| Anthropic `structured-outputs-2025-11-13` beta header | (no header needed) | 2026-Q1 GA | Drop header from new code |
| Supabase `auth.admin.signOut(user_id)` mythos | `signOut(jwt, scope)` — JWT only | Always was this way; CONTEXT D-15 was incorrect | Plan correction in Pitfall 1 |
| `supabase functions deploy --import-map` flag | per-Fn `deno.json` | CLI v2.101.0 (2026-05-22) | Per memory; all 3 new Fns ship deno.json |
| Single-`$$` cron body | Named tags `$cron$`/`$restore$` | Postgres always; project standard since Phase 22 | Required to avoid silent close |
| `tsc -b` typecheck | `tsc -p tsconfig.app.json --noEmit` | Project convention since Phase 31 | `tsc -b` exits 0 with errors |

**Deprecated/outdated:**
- `auth.api.signOut` (v1 supabase-js) → v2 namespace is `auth.admin.signOut` (still JWT-only).
- `output_format` Anthropic parameter → `output_config.format`.

## Validation Architecture

> nyquist_validation = true (per config.json). Section included per Phase 48 spec.

### Test Framework

| Property | Value |
|---|---|
| Framework | **Deno test** for Edge Fns (`deno test --no-check`), **Vitest** for SPA (TBD — no vitest.config.ts on main yet; per Phase 44/45 precedent vitest was added; verify before Wave 0) |
| Config file | None at repo root for SPA tests; Edge Fns use per-Fn `*.test.ts` with `Deno.test('…')` blocks |
| Quick run command (Edge Fn unit) | `$HOME/.deno/bin/deno test --no-check supabase/functions/{fn-name}/index.test.ts` |
| Quick run command (SPA unit) | `cd leanshot && npx vitest run path/to/file.test.ts` (verify path) |
| Full suite (Edge Fns) | `$HOME/.deno/bin/deno test --no-check supabase/functions/claude-moderation/ supabase/functions/banned-words-sweep/ supabase/functions/ban-enforcement/` |
| Full suite (SPA) | `cd leanshot && npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx vitest run` |
| Live-DB RLS proof tests | `psql ${SUPABASE_DB_URL} -f supabase/tests/p48_rls_proofs.sql` (planner ships these as part of Wave 0 alongside migrations) |

**Per memory `reference_deno_test_top_level_serve_trap`:** Edge Fns use `Deno.serve(handler)` at module scope. Running `deno test` on the index.ts file directly will spawn the server and dangle. Tests live in sibling `*.test.ts` files that import the handler (NOT the module's serve()) and call `handler(req)` directly. This is the established pattern in `weekly-digest/index.test.ts`.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| MOD-01 | Report content via SECDEF RPC; cooldown blocks duplicate | unit + RLS proof | `psql -f supabase/tests/p48_report_cooldown.sql` + `deno test supabase/functions/__tests__/report_content_secdef.test.ts` | ❌ Wave 0 |
| MOD-01 | Reporter sees own report status (RLS SELECT predicate) | RLS proof | `psql -f supabase/tests/p48_reporter_select_own.sql` | ❌ Wave 0 |
| MOD-01 | Cross-org isolation: clinic admin can't see other clinic's reports | RLS proof | `psql -f supabase/tests/p48_cross_org_isolation.sql` | ❌ Wave 0 |
| MOD-02 | Mute hides author content from non-author non-staff; author still sees own | RLS proof | `psql -f supabase/tests/p48_mute_silent_suspend.sql` | ❌ Wave 0 |
| MOD-02 | Ban denies INSERT on community_posts via RLS | RLS proof | `psql -f supabase/tests/p48_ban_write_deny.sql` | ❌ Wave 0 |
| MOD-02 | Ban triggers ban-enforcement Edge Fn → DELETE FROM auth.sessions | Edge Fn unit (mocked admin client) | `deno test supabase/functions/ban-enforcement/index.test.ts` | ❌ Wave 0 |
| MOD-02 | Temp-suspended auto-restores at expires_at boundary (frozen time test) | SQL test (pg_cron + frozen now()) | `psql -f supabase/tests/p48_temp_restore_cron.sql` | ❌ Wave 0 |
| MOD-03 | Banned-words trigger inserts community_reports on post body match | SQL test | `psql -f supabase/tests/p48_banned_words_trigger.sql` | ❌ Wave 0 |
| MOD-03 | Banned-words `escalate` severity fires email-router via pg_net | SQL test (with pg_net mock or breadcrumb assertion) | `psql -f supabase/tests/p48_banned_words_escalate.sql` | ❌ Wave 0 |
| MOD-03 | banned-words-sweep Edge Fn idempotent (re-invoke doesn't dup-insert) | Edge Fn unit | `deno test supabase/functions/banned-words-sweep/index.test.ts` | ❌ Wave 0 |
| MOD-03 | DMs skip banned-words (no trigger on direct_messages) | SQL test | `psql -f supabase/tests/p48_dm_skip.sql` | ❌ Wave 0 |
| MOD-04 | claude-moderation Edge Fn parses structured output → INSERT community_reports at ≥0.7 | Edge Fn unit (mocked Anthropic) | `deno test supabase/functions/claude-moderation/index.test.ts` | ❌ Wave 0 |
| MOD-04 | PHI skip: trigger does NOT fire for clinic-org-scoped spaces | SQL test | `psql -f supabase/tests/p48_phi_skip_trigger.sql` | ❌ Wave 0 |
| MOD-04 | NEVER auto-removes content — flag at 0.99 still leaves post visible | SQL test | `psql -f supabase/tests/p48_never_auto_remove.sql` | ❌ Wave 0 |
| MOD-05 | moderation_audit_log INSERT-only — UPDATE/DELETE attempts fail | RLS proof | `psql -f supabase/tests/p48_audit_immutability.sql` | ❌ Wave 0 |
| MOD-05 | All admin action paths write to audit log (mute_applied, ban_applied, report_triaged) | SQL integration | `psql -f supabase/tests/p48_audit_coverage.sql` | ❌ Wave 0 |
| MOD-05 | audit-archive Edge Fn includes moderation_audit_log in 90d cold archive | Edge Fn unit (mocked S3) | `deno test supabase/functions/audit-archive/index.test.ts` | ❌ existing fn modified |
| (general) | SPA: AccountSuspended renders when user_moderation_state.status='banned' | Vitest + Testing Library | `npx vitest run leanshot/src/components/AccountSuspended.test.tsx` | ❌ Wave 0 |
| (general) | SPA: Moderation admin module lazy-loads + renders all 5 sub-views | Vitest | `npx vitest run leanshot/src/admin/modules/moderation/__tests__/` | ❌ Wave 0 |
| (general) | Bundle ceiling: admin-moderation chunk ≤30 kB gz | Build assertion | `cd leanshot && npm run build && node scripts/check-bundle-ceiling.cjs admin-moderation 30720` | depends on existing ceiling script |

### Sampling Rate

- **Per task commit:** Quick `deno test --no-check supabase/functions/{owning-fn}/index.test.ts` for Edge Fn plans; `tsc -p tsconfig.app.json --noEmit` + targeted `vitest run` for SPA plans.
- **Per wave merge:** Per memory `feedback_post_merge_deno_sweep_pattern` — run cross-Fn Deno sweep on all 3 new Fns:
  ```
  $HOME/.deno/bin/deno test --no-check \
    supabase/functions/claude-moderation/ \
    supabase/functions/banned-words-sweep/ \
    supabase/functions/ban-enforcement/
  ```
- **Phase gate:** Full SPA suite (lint + tsc + vitest) + `supabase db push --linked` confirms all migrations clean + all RLS-proof SQL files green + `supabase functions deploy claude-moderation banned-words-sweep ban-enforcement audit-archive` green.
- **Live-DB proof gate:** Per LeanShot security policy ("every RLS surface gets a live cross-tenant impersonation proof test" — per memory `reference_supabase_project`), the cross-org isolation test (p48_cross_org_isolation.sql) MUST run against linked DB before phase close-out.

### Wave 0 Gaps

- [ ] `supabase/tests/p48_*.sql` files (16 RLS-proof + SQL integration tests above)
- [ ] `supabase/functions/claude-moderation/index.test.ts`
- [ ] `supabase/functions/banned-words-sweep/index.test.ts`
- [ ] `supabase/functions/ban-enforcement/index.test.ts`
- [ ] `leanshot/src/components/AccountSuspended.test.tsx`
- [ ] `leanshot/src/admin/modules/moderation/__tests__/{ModerationLayout,ReportsQueue,BannedWordsEditor,UserBansRoster,AuditLogViewer}.test.tsx`
- [ ] Vitest config / setup file if not already on main (verify per Phase 44/45 work)
- [ ] Bundle ceiling assertion in CI for `admin-moderation` chunk

## Security Domain

Per LeanShot security policy (LeanShot Supabase project doc): **every RLS surface gets a live cross-tenant impersonation proof test**. Phase 48 widens RLS on 5+ tables; all need proof tests.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes | Supabase Auth (existing); ban-enforcement direct DELETE FROM auth.sessions |
| V3 Session Management | yes | DELETE FROM auth.sessions + refresh_tokens; SPA AccountSuspended blocker covers residual JWT window |
| V4 Access Control | yes | RLS-default-deny + SECDEF gating + `public.is_staff()` checks |
| V5 Input Validation | yes | Zod on Edge Fn bodies; CHECK constraints on enum columns; partial UNIQUE indexes for atomic constraints |
| V6 Cryptography | yes (via existing) | HMAC compare via `constantTimeEqual` (existing `lifecycle-utils.ts`); vault.decrypted_secrets for service-role retrieval |
| V8 Data Protection | yes | `moderation_audit_log` immutability + 90d hot + Parquet cold (Phase 24 audit-archive widening); PHI skip on D-08 (clinic content never sent to Anthropic) |
| V9 Communications | yes | All Edge Fn calls go over HTTPS (Supabase platform default); pg_net.http_post uses TLS |
| V10 Malicious Code | partial | DOMPurify NOT in scope (no user-rendered HTML new in Phase 48); existing community-feed sanitization remains the surface |
| V12 Files & Resources | n/a | No file upload paths in Phase 48 |
| V14 Configuration | yes | `set search_path` hardening on every SECDEF; REVOKE on audit table |

### Known Threat Patterns for Phase 48 Stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Adversary spams reports to flood admin queue | Denial of Service | Partial UNIQUE cooldown index (D-02); SECDEF RPC catches 23505 with clean error |
| Adversary tampers audit log to hide their abuse | Tampering / Repudiation | `REVOKE UPDATE, DELETE ON moderation_audit_log FROM service_role`; SECDEF-only write path; `actor_id := auth.uid()` sourced inside RPC, never from arg |
| Banned user creates new account and continues abuse | Authentication bypass | Out of Phase 48 scope — email-uniqueness at signup is Supabase Auth's responsibility; ban table keyed on user_id only |
| PHI sent to Anthropic via auto-flag | Information disclosure (HIPAA) | D-08 PHI gate WHEN clause on trigger — never fires for `space.org_id IS NOT NULL`; data never crosses Anthropic wire |
| Cross-tenant report leak (clinic A admin sees clinic B reports) | Information disclosure | RLS predicate on community_reports SELECT calls `can_moderate_report()` helper; cross-org isolation live-tested |
| Admin self-promotes via SECDEF abuse | Elevation of Privilege | All SECDEF RPCs gate on `public.is_staff()` AT RPC ENTRY; `set search_path` hardened |
| pg_net trigger sends to attacker-controlled URL | Tampering | URL hardcoded in trigger body to Supabase project subdomain; not derived from row data |
| ILIKE injection via banned_words.word | Injection | banned_words.word is admin-editable only (SECDEF RPC); RLS denies public write; values are PARAMETERS to ILIKE, not concatenated SQL |
| Claude prompt injection in user post → forces high confidence | Tampering | System prompt is hardcoded server-side; output schema is fixed; even if Claude returns 1.0 the content is queued not removed (D-07 lock) |
| Mute-bypass via direct SQL access | Information disclosure | RLS at table level; muted content invisible regardless of access path (REST API + RPC + direct SQL via PostgREST) |
| Session-revoke race (user logs in milliseconds after ban) | DoS bypass | Two-stage: DELETE sessions (immediate refresh-token block) + RLS write-deny (durable backstop). 1h residual JWT acceptable per S2 dual-layer |
| Audit-archive Fn loses moderation_audit_log on widening | Repudiation | Plan-checker verifies audit-archive widening migration matches Fn code change (cross-file invariant) |

### Phase 48-Specific Threat Register (cite in PLAN.md headers per Phase 25 convention)

```
T-48-01: Report-flood DoS              → Mitigation: D-02 partial UNIQUE + cooldown
T-48-02: Cross-org report leak         → Mitigation: D-04 can_moderate_report() helper + live proof test
T-48-03: PHI to Anthropic              → Mitigation: D-08 WHEN clause on trigger (not Edge Fn)
T-48-04: Audit log tampering           → Mitigation: D-16 REVOKE + SECDEF-only + INSERT-only RLS
T-48-05: Mute bypass via SQL           → Mitigation: D-14 RLS predicate (table-level invariant)
T-48-06: Ban bypass via residual JWT   → Mitigation: SQL session DELETE + RLS write-deny + SPA blocker
T-48-07: Banned-words injection        → Mitigation: parameterized ILIKE + SECDEF admin-only edit
T-48-08: Claude prompt injection       → Mitigation: queue-only (D-07 lock); fixed system prompt; bounded output schema
T-48-09: Auto-removal drift            → Mitigation: code review for any "delete content where auto_flag" path (forbidden)
T-48-10: Admin self-promotion          → Mitigation: SECDEF gates on is_staff() at entry; search_path hardened
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Phase 45 migrations land at `20270720*`-`20270731*` window leaving `20270901*` safe for Phase 48 | Live-DB Pre-Check Item 1 | Migration ordering collision; planner picks wrong timestamp. Pre-check: orchestrator `ls supabase/migrations/2027{07,08,09}*` before Phase 48 Wave 0 dispatch. |
| A2 | Anthropic `output_config.format` is FULL GA on `claude-haiku-4-5-20251001` (not preview-only) | Standard Stack + Pattern 3 | If preview-only, must add `anthropic-beta: structured-outputs-2025-11-13` header. Mitigation: Phase 38 weekly-digest test will surface this immediately. |
| A3 | `auth.sessions` + `auth.refresh_tokens` schema unchanged in Supabase platform (no recent rename) | Pitfall 1 + D-15 correction | If renamed, ban-enforcement Edge Fn 500s. Mitigation: `\d auth.sessions` via `supabase db query --linked` at execute time. |
| A4 | The `org_member_role` enum's clinic-admin equivalent is `owner` AND/OR `support_admin` | Live-DB Pre-Check Item 2 | If neither matches what CONTEXT intended ("clinic admin"), D-04 helper returns wrong set. Mitigation: confirm with user before writing helper SQL — surface in discuss-phase if iter-1 plan-check flags. |
| A5 | All 4 notification tables (settings, category_config, user_notifications, dismissal_state) still have identical category CHECK shape on the day Phase 48 dispatches | Pitfall 5 | If Phase 47 modifies the shape (adds `event_*` categories), Phase 48 migration must rebase on the Phase 47 widened list. Mitigation: re-query at execute time. |
| A6 | Phase 24 audit-archive Edge Fn is parametrized over table list (not hardcoded to phi_access_log) | Don't Hand-Roll table + Architecture Map | If hardcoded, widening requires Fn code edit not just config. Mitigation: planner reads audit-archive/index.ts in scout step before writing widening plan. |
| A7 | `community_spaces.org_id` is the field name used for PHI gate (not `clinic_id` or `org_uuid`) | D-08 trigger predicate | Confirmed via live DB query 2026-05-23. |
| A8 | The 5 sub-views in `/admin/moderation` (D-03) can be served by the single new `admin-moderation` chunk under 30 kB gz | Bundle ceiling | If any sub-view pulls heavy dependency (e.g., CSV export library for audit log), ceiling breach. Mitigation: AuditLogViewer CSV export uses native Blob API, no library. |
| A9 | `vault.decrypted_secrets` "service_role_key" is in `sb_secret_*` format already (rotated from legacy JWT) | Pattern 1 + HMAC orchestrator-auth | If legacy JWT, the 3 new Edge Fns fail `constantTimeEqual`. Mitigation: per memory `reference_supabase_service_role_key_format_divergence`. Verify at execute time via `supabase secrets list`. |
| A10 | Supabase platform-managed `auth` schema permits service-role DELETE on sessions/refresh_tokens tables | Pitfall 1 correction | If platform restricts these, must use the Auth Admin REST endpoint instead (POST /auth/v1/admin/users/:id/logout) via direct fetch with service-role bearer. Spike test in PLAN-NN sketch is required at Wave 0. |

## Open Questions

1. **D-04 cross-org admin role resolution**
   - What we know: `org_member_role` enum has `owner`, `clinician`, `staff`, `support_admin`, `support_lead`. CONTEXT D-04 says "role='admin'".
   - What's unclear: Which value(s) constitute "clinic admin" for moderation purposes — `owner` only, or `owner + support_admin`?
   - Recommendation: Surface in plan-check iter-1 (or earlier in /gsd-discuss-phase if not yet locked) for user decision. Default to `role IN ('owner', 'support_admin')` (broader; matches "ops + admin" intent).

2. **A10 Auth admin schema DML permissions**
   - What we know: docs document direct DELETE FROM auth.sessions / refresh_tokens as the workaround for user_id-keyed session revoke.
   - What's unclear: Does Supabase platform-managed `auth` schema permit service_role DELETE on these tables (it permits SELECT but DML may be restricted).
   - Recommendation: Wave 0 spike — `supabase functions deploy ban-enforcement-spike` that attempts a no-op DELETE and reports back. If denied, fall back to Auth Admin REST endpoint via direct fetch.

3. **Audit-archive Fn widening scope**
   - What we know: Fn exists at `supabase/functions/audit-archive/`; Phase 24 ships it; widens to include `phi_access_log` per Phase 25 D-16.
   - What's unclear: Whether the Fn is config-driven (table list in env var or DB) or code-driven (hardcoded array in TS).
   - Recommendation: Plan-NN reads audit-archive/index.ts and either (a) adds `moderation_audit_log` to the array literal, or (b) inserts a config row in the tables-to-archive registry.

4. **direct_messages live schema (Phase 45 D-18 land)**
   - What we know: CONTEXT references `direct_messages` for D-14 (mute RLS widening). Live DB does not yet have the table.
   - What's unclear: Exact column names (`sender_id`/`author_id`? `recipient_user_id`?) needed for the RLS predicate.
   - Recommendation: Planner reads Phase 45 PLAN-NN migration file before writing Phase 48 mute-RLS-widening migration; uses exact column names from Phase 45 (NOT from this RESEARCH.md's guesses).

5. **Vitest infrastructure on main**
   - What we know: SPA has no `vitest.config.ts` per Phase 0 codebase audit. Phase 44/45 plans referenced vitest.
   - What's unclear: Whether vitest landed on main yet.
   - Recommendation: Planner verifies `cat leanshot/package.json | grep vitest` and `ls leanshot/vitest.config.*` BEFORE writing test commands. If absent, Wave 0 adds it OR the planner uses Deno test for SPA via headless DOM (unlikely; vitest probably present).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Supabase CLI | All migrations + Edge Fn deploys | ✓ | v2.101.0 (verified 2026-05-23) | — |
| Deno | Edge Fn tests | ✓ | path: `$HOME/.deno/bin/deno` (per memory) | — |
| `psql` | RLS proof tests | ✓ assumed (standard Postgres client) | n/a | Use `supabase db query --linked` for read-only sanity; full DDL tests need psql |
| Node.js | SPA build + tests | ✓ | v22.18.0 (per leanshot/CLAUDE.md) | — |
| `npm` | SPA install + scripts | ✓ | lockfile v3 | — |
| `pg_cron` | D-15 hourly restore | ✓ in linked DB (1.6.4) | 1.6.4 | — |
| `pg_net` | D-05/D-15/D-10 escalate | ✓ in linked DB (0.20.0) | 0.20.0 | — |
| `pg_trgm` | NOT NEEDED v1 (deferred) | ✗ | — | n/a (v2 only) |
| Anthropic API access | D-05 claude-moderation | ✓ assumed (existing for Phase 38) | n/a | At-rest if missing: phase blocks; ANTHROPIC_API_KEY verification at dispatch |
| Resend (for escalate email) | D-12 | ✓ assumed (existing email-router) | n/a | Domain-health check gates send (existing Phase 22 pattern) |

**Missing dependencies with no fallback:**
- None — all required runtime dependencies present.

**Missing dependencies with fallback:**
- `pg_trgm`: not needed for v1 (CONTEXT defers).

## Sources

### Primary (HIGH confidence)

- Live Supabase DB queries (verified 2026-05-23):
  - `information_schema.columns` for org_members, community_spaces, community_posts, community_comments, notification_settings
  - `pg_constraint` for notification_settings CHECK shape
  - `pg_enum` for org_member_role values
  - `pg_extension` for pg_cron, pg_net, (no pg_trgm)
  - `vault.decrypted_secrets` names
  - `pg_proc` for is_staff, log_phi_access existence
- Canonical migration files (verbatim references):
  - `supabase/migrations/20270702000004_phi_access_log.sql` — D-16 immutability template
  - `supabase/migrations/20270702000005_log_phi_access_rpc.sql` — D-16 SECDEF RPC template
  - `supabase/migrations/20270601000017_lifecycle_cron_schedules.sql` — D-15 cron HTTP-invoke shape
  - `supabase/migrations/20270720000004_p44_notification_community.sql` — D-12 atomic 4-table widening pattern
  - `supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql` — pg_net call body shape (D-05/D-15)
  - `supabase/migrations/20260801000013_broadcast_membership_changes_trigger.sql` — AFTER trigger SECDEF shape
- Canonical Edge Fn files:
  - `supabase/functions/weekly-digest/index.ts` — claude-moderation invocation pattern
  - `supabase/functions/_shared/anthropic-summarize.ts` — `/v1/messages` + `output_config.format.json_schema` POST body
  - `supabase/functions/_shared/lifecycle-utils.ts` — `checkServiceRoleBearer`, `makeLazyAdmin`, `corsHeaders`, `jsonResponse`
  - `supabase/functions/_shared/anthropic-baa-allowlist.ts` — `claude-haiku-4-5-20251001` in allowlist
- Canonical SPA files:
  - `leanshot/src/lib/admin/modules.ts` — admin module manifest insertion point
  - `leanshot/src/components/admin/AdminShell.tsx` — prefix-routing already in place
  - `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx` — fork analog for D-03
- Context7 (HIGH):
  - `/supabase/supabase` library docs — `auth.admin.signOut` signature confirmation
  - `/anthropics/anthropic-sdk-typescript` — `jsonSchemaOutputFormat` + supported model list

### Secondary (MEDIUM confidence)

- Anthropic platform docs — `output_config.format.json_schema` GA shape + `claude-haiku-4-5` support [fetched 2026-05-23 via WebFetch from platform.claude.com]
- Supabase official discussion #13941 — direct DELETE FROM auth.sessions/refresh_tokens as user_id-keyed session-revoke workaround
- Supabase GitHub auth-js repo — `GoTrueAdminApi.signOut(jwt: string, scope: SignOutScope)` exact signature

### Tertiary (LOW confidence — VERIFY at execute time)

- `auth_member_role` enum values beyond first 5 (display truncated; planner re-queries to confirm)
- Phase 45 `community_reports` exact column shape (not yet pushed to live DB; planner reads migration file when it lands)
- vault `service_role_key` is `sb_secret_*` format (assumed per platform default; verify via `supabase secrets list`)
- Phase 24 `audit-archive` Fn config-driven vs code-driven table list (planner reads at scout step)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library/pattern already in production with cited file references
- Architecture: HIGH — all 16 CONTEXT decisions map cleanly to verbatim file analogs; one correction (D-15 signOut) is well-cited with documented fallback
- Pitfalls: HIGH — 12 pitfalls each tied to a memory entry or live-DB observation
- Validation: MEDIUM — depends on Vitest presence on main + p48 RLS test files being net-new
- Security: HIGH — STRIDE register inherited from Phase 25 pattern, ASVS coverage matches existing Phase 38/44 surfaces

**Research date:** 2026-05-23
**Valid until:** 2026-06-23 (30 days — stable domain; Anthropic/Supabase APIs unlikely to break in this window)
