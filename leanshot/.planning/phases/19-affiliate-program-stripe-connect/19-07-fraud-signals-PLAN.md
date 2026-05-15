---
phase: 19
plan: 7
type: execute
wave: 2
depends_on: [1, 2]
files_modified:
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000006_affiliate_click_baseline_mv.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000007_fraud_trigger_conversion.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000008_click_baseline_refresh_cron.sql
  - /Users/karstenhaldan/minisite/supabase/tests/flag_conversion_fraud.test.sql
  - /Users/karstenhaldan/minisite/supabase/tests/affiliate_click_baseline.test.sql
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.test.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/fingerprint.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/__tests__/fingerprint.test.ts
  - /Users/karstenhaldan/minisite/leanshot/package.json
  - /Users/karstenhaldan/minisite/leanshot/vite.config.ts
autonomous: true
requirements: [AFF-07, AFF-08]
tags: [postgres, trigger, matview, fingerprint, fraud, z-score]

must_haves:
  truths:
    - "INSERT into affiliate_conversions fires trg_flag_conversion_fraud; sets status='flagged' + fraud_signals jsonb when ANY of (IP /24 match, fingerprint match, non-public email-domain match) is true"
    - "affiliate_click_baseline materialized view computes mean+stddev of daily click counts per affiliate over 7-day rolling window; refreshed daily 01:00 UTC via pg_cron CONCURRENTLY"
    - "Z-score check on click insert flags clicks ≥ 3σ above the affiliate's own baseline (D-26)"
    - "ThumbmarkJS lazy-loaded only on /r/* + /signup routes; gzipped chunk ≤ 12 kB; ZERO impact on index chunk"
    - "Public email allowlist (gmail/yahoo/outlook/icloud/hotmail) exempts email-domain fraud signal (D-24)"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000007_fraud_trigger_conversion.sql"
      provides: "BEFORE INSERT trigger flag_conversion_fraud on affiliate_conversions (D-24/D-25)"
      contains: "set_masklen"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000006_affiliate_click_baseline_mv.sql"
      provides: "Materialized view + unique index for CONCURRENTLY refresh (D-26)"
      contains: "stddev_samp"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/fingerprint.ts"
      provides: "Lazy ThumbmarkJS wrapper — dynamic import() only, NEVER static"
      contains: "await import"
  key_links:
    - from: "stripe-webhook invoice.paid (Plan 19-04) INSERT into affiliate_conversions"
      to: "trg_flag_conversion_fraud"
      via: "BEFORE INSERT trigger"
      pattern: "trg_flag_conversion_fraud"
    - from: "affiliate-attribute Edge Function (Plan 19-02)"
      to: "affiliate_click_baseline materialized view"
      via: "SELECT mean_clicks, stddev_clicks WHERE affiliate_id = ..."
      pattern: "affiliate_click_baseline"
---

<objective>
Ship the fraud-signal layer: a BEFORE-INSERT trigger on `affiliate_conversions` (IP /24 + fingerprint + email-domain match per D-24/D-25), a materialized view computing Z-score baseline for click fraud (D-26), a daily pg_cron refresh, AND the client-side ThumbmarkJS fingerprint capture (lazy-loaded, bundle-safe). Also extends `affiliate-attribute` (Plan 19-02) to read the materialized view for live Z-score check on every /r/{code} hit.

Purpose: AFF-07 (conversion fraud) + AFF-08 (click fraud — raw-count Z-score only at v1.2). All fraud signals route to P22 ADMIN-06 admin queue (D-25 — no auto-reject).

**Iter-1 revisions (2026-05-15):**
- **D-38 / BL-8 scope-lock:** AFF-08 v1.2 ships ONLY the raw-count Z-score (this plan). The impression-to-click ratio anomaly detector is DEFERRED to v1.3. This plan has NO impression-baseline matview, NO ratio computation task. The `affiliate_impressions` table is created in Plan 19-01 (D-38) and populated in Plan 19-08 — both upstream of any v1.3 ratio detector. v1.3 will add a parallel `affiliate_impression_baseline` matview + a ratio Z-score check using historical impression data captured starting at v1.2 ship-date.
- **W-2 hedges resolved:** ThumbmarkJS package name corrected (`@thumbmarkjs/thumbmarkjs@^1.9.0`, NOT `@thumbmark/thumbmarkjs@^0.18`); API call locked to `new mod.Thumbmark().get()` with dual-shape return handling.

Output: 3 migration files + 2 SQL tests + extended affiliate-attribute + ThumbmarkJS wrapper + vite.config.ts manualChunks entry + package.json dep.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql
@/Users/karstenhaldan/minisite/supabase/migrations/20260512000002_anon_cleanup_pg_cron.sql
@/Users/karstenhaldan/minisite/leanshot/vite.config.ts

<interfaces>
RESEARCH §"Pattern 3: Fraud-signal trigger" (lines 452-517) — full plpgsql trigger function with `set_masklen(ip, 24) = set_masklen(...)`, fingerprint equality, email-domain split + allowlist exemption.
RESEARCH §"Pattern 4: Z-score materialized view" (lines 519-546) — full SQL for matview + unique index + pg_cron refresh.
PATTERNS.md §A.3 + §B.1 — affiliate-attribute extension for live Z-score lookup; cold-start cap already in Plan 19-02 Task 2.
CONTEXT D-24: public-email allowlist `['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com']`.
CONTEXT D-26: 3σ threshold; baseline = 7-day rolling daily count.
CONTEXT D-27: cold-start 500/day cap (already shipped in Plan 19-02 — DO NOT re-implement; only extend with Z-score after baseline accumulates).
RESEARCH Pitfall 5: REFRESH MATERIALIZED VIEW CONCURRENTLY requires UNIQUE index on view.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Ship fraud trigger + click baseline materialized view + pg_cron refresh</name>
  <files>/Users/karstenhaldan/minisite/supabase/migrations/20270101000006_affiliate_click_baseline_mv.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000007_fraud_trigger_conversion.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000008_click_baseline_refresh_cron.sql, /Users/karstenhaldan/minisite/supabase/tests/flag_conversion_fraud.test.sql, /Users/karstenhaldan/minisite/supabase/tests/affiliate_click_baseline.test.sql</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md (§"Pattern 3" lines 452-517 + §"Pattern 4" lines 519-546)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§A.3 fraud signals analog)
    /Users/karstenhaldan/minisite/supabase/migrations/20260512000002_anon_cleanup_pg_cron.sql (pg_cron + pg_net analog for HTTP callbacks; here we just refresh a matview)
    /Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql (SECURITY DEFINER trigger function with search_path — same shape)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-01-schema-rls-tier-effective-PLAN.md (column names in affiliate_clicks + affiliate_conversions tables — must match exactly)
  </read_first>
  <action>
Three migrations + 2 SQL test files. Migration timestamps continue the `20270101…` block.

**File 1 — `20270101000006_affiliate_click_baseline_mv.sql`** (per RESEARCH Pattern 4):
```
-- Phase 19 Plan 19-07 — Click-fraud baseline (D-26 Z-score).
-- Pitfall 5: REFRESH CONCURRENTLY requires a UNIQUE index on the view.
-- IMMUTABLE: date_trunc('day', timestamptz) is IMMUTABLE per Postgres 15.

create materialized view public.affiliate_click_baseline as
select
  affiliate_id,
  avg(daily_count)::numeric(10,2) as mean_clicks,
  stddev_samp(daily_count)::numeric(10,2) as stddev_clicks,
  max(d)::date as latest_baseline_date,
  count(*) as days_observed
from (
  select
    affiliate_id,
    date_trunc('day', created_at)::date as d,
    count(*) as daily_count
  from public.affiliate_clicks
  where created_at > now() - interval '7 days'
  group by affiliate_id, date_trunc('day', created_at)::date
) daily
group by affiliate_id;

create unique index idx_click_baseline_affiliate
  on public.affiliate_click_baseline(affiliate_id);

comment on materialized view public.affiliate_click_baseline is
  'AFF-08: 7-day rolling daily-click baseline per affiliate. Refresh CONCURRENTLY at 01:00 UTC.';

grant select on public.affiliate_click_baseline to authenticated, service_role;
```

**File 2 — `20270101000007_fraud_trigger_conversion.sql`** (per RESEARCH Pattern 3 + D-24/D-25):
- `create or replace function public.flag_conversion_fraud()` — `returns trigger language plpgsql security definer set search_path = public, extensions, pg_catalog`.
- Declares: `v_aff_ip inet`, `v_aff_fp text`, `v_aff_email text`, `v_user_ip inet`, `v_user_fp text`, `v_user_email text`, `v_public_domains text[] := array['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com']` (D-24), `v_user_domain text`, `v_aff_domain text`, `v_flagged boolean := false`, `v_signals jsonb := '[]'::jsonb`.
- SELECT affiliate's `ip_signup, fingerprint_signup, email` from `public.affiliates` WHERE `id = NEW.affiliate_id`.
- SELECT converter's signup metadata from `auth.users` (email column) and/or from `public.affiliate_clicks` (most recent ip+fingerprint for this user_id within last 30d) — fallback to NULL when not available.
- Signal a (IP /24): `if v_user_ip is not null and v_aff_ip is not null and set_masklen(v_user_ip, 24) = set_masklen(v_aff_ip, 24) then v_flagged := true; v_signals := v_signals || '"ip_24_match"'::jsonb; end if;`
- Signal b (fingerprint): `if v_user_fp is not null and v_user_fp = v_aff_fp then v_flagged := true; v_signals := v_signals || '"fingerprint_match"'::jsonb; end if;`
- Signal c (email-domain, with allowlist):
  ```
  v_user_domain := lower(split_part(v_user_email, '@', 2));
  v_aff_domain := lower(split_part(v_aff_email, '@', 2));
  if v_user_domain is not null and v_aff_domain is not null
     and v_user_domain = v_aff_domain
     and not (v_user_domain = any(v_public_domains)) then
    v_flagged := true;
    v_signals := v_signals || '"email_domain_match"'::jsonb;
  end if;
  ```
- On flag: `NEW.status := 'flagged'; NEW.fraud_signals := v_signals;` (BEFORE INSERT trigger — modifies the row going in).
- `return NEW;`
- Trigger: `create trigger trg_flag_conversion_fraud before insert on public.affiliate_conversions for each row execute function public.flag_conversion_fraud();`
- Grants: `revoke all on function public.flag_conversion_fraud() from public; grant execute on function public.flag_conversion_fraud() to service_role;`

**File 3 — `20270101000008_click_baseline_refresh_cron.sql`** (per RESEARCH Pattern 4 + analog from `20260512000002_anon_cleanup_pg_cron.sql`):
```
-- Refresh affiliate_click_baseline CONCURRENTLY daily at 01:00 UTC (D-26).
select cron.schedule(
  'affiliate-click-baseline-refresh',
  '0 1 * * *',
  $$ refresh materialized view concurrently public.affiliate_click_baseline; $$
);

-- Document the eventual cleanup if this phase is ever rolled back.
-- To unschedule: select cron.unschedule('affiliate-click-baseline-refresh');
```

**File 4 — `supabase/tests/flag_conversion_fraud.test.sql`** (SQL assertions in DO blocks; raise notice on success, exception on fail):
- T1: insert affiliate with ip='10.0.0.5', fingerprint='fp-abc', email='aff@example.com'.
- T2: insert affiliate_conversion for user with matching IP /24 (e.g. 10.0.0.99) → assert row has status='flagged' and fraud_signals @> '["ip_24_match"]'.
- T3: insert affiliate_conversion for user with matching fingerprint → status='flagged' and signal includes "fingerprint_match".
- T4: insert affiliate_conversion for user with matching non-public email-domain (e.g. company.io) → flagged with "email_domain_match".
- T5: insert affiliate_conversion for user with matching gmail.com domain → status='pending' (NOT flagged; allowlist exemption).
- T6: insert affiliate_conversion with all 3 signals matching → status='flagged' + fraud_signals contains all 3 entries.
- T7: insert affiliate_conversion with no matching signals → status='pending' (default).
- ROLLBACK at end (test uses BEGIN; ... ROLLBACK; pattern).

**File 5 — `supabase/tests/affiliate_click_baseline.test.sql`**:
- T1: insert 50 click rows for affiliate_A over past 5 days; insert 0 click rows for affiliate_B.
- T2: `refresh materialized view public.affiliate_click_baseline;`
- T3: SELECT from `affiliate_click_baseline` WHERE `affiliate_id = A`; assert `mean_clicks ≈ 10`, `stddev_clicks > 0`, `days_observed = 5`.
- T4: assert no row exists for affiliate_B in the matview (no clicks → no rows in inner query → no group).
- T5: REFRESH CONCURRENTLY on the matview succeeds (proves unique index works).
- ROLLBACK.

**Constraints:**
- All trigger functions use `set search_path = public, extensions, pg_catalog` per [[reference-supabase-migration-gotchas]] (digest()/pgcrypto resolution).
- TEXT columns not enums (D-03).
- NO CREATE POLICY in this migration — RLS policies already shipped in Plan 19-01.
- Materialized view unique index is the load-bearing line for CONCURRENTLY refresh (Pitfall 5).
- DO NOT push migrations in this task — Plan 19-09 does the [BLOCKING] schema push.
- Commit with pathspec: `git commit -- supabase/migrations/2027010100000{6,7,8}_*.sql supabase/tests/flag_conversion_fraud.test.sql supabase/tests/affiliate_click_baseline.test.sql` per [[feedback-parallel-executor-git-isolation]].
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && supabase db reset --local && psql "$LOCAL_DB_URL" -f supabase/tests/flag_conversion_fraud.test.sql && psql "$LOCAL_DB_URL" -f supabase/tests/affiliate_click_baseline.test.sql</automated>
  </verify>
  <done>3 migrations apply cleanly; trigger flags conversions on 3 signal types respecting public-email allowlist; matview CONCURRENTLY refresh works; cron job scheduled; both SQL test files pass without exception.</done>
</task>

<task type="auto">
  <name>Task 2: Wire Z-score check into affiliate-attribute + add ThumbmarkJS lazy-loaded fingerprint capture</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.test.ts, /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/fingerprint.ts, /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/__tests__/fingerprint.test.ts, /Users/karstenhaldan/minisite/leanshot/package.json, /Users/karstenhaldan/minisite/leanshot/vite.config.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md (§"Supporting Stack" line 143 — ThumbmarkJS rationale; §"Pitfall 3" line 618 — bundle-safe lazy import)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§B.1 — affiliate-attribute Z-score extension; §D — fingerprint.ts lib helper)
    /Users/karstenhaldan/minisite/leanshot/vite.config.ts (existing manualChunks config — locate the rollupOptions block)
    /Users/karstenhaldan/minisite/leanshot/src/lib/sync-defer.ts (existing lazy-load pattern; reuse for ThumbmarkJS per Plan 19-07 = same idle-defer shape)
    /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts (existing handler from Plan 19-02 Task 2 — extending in place)
  </read_first>
  <action>
Extend Plan 19-02's affiliate-attribute with Z-score check + ship the client-side fingerprint capture lazy.

**File 1 — `package.json`** (modify dependencies):
- Add `@thumbmarkjs/thumbmarkjs` (version `^1.9.0`) — verified package name + version via GitHub package.json fetch during plan-checker iter-1 revision (W-2 hedge resolution). RESEARCH§Standard Stack cited `@thumbmark/thumbmarkjs@^0.18`, but the actual published package is `@thumbmarkjs/thumbmarkjs@^1.9.0`. Use the corrected coordinates.
- Run `npm install @thumbmarkjs/thumbmarkjs@^1.9.0 --save` (NOT devDependencies — runtime dependency for fraud signal capture).
- Verify post-install: `npm view @thumbmarkjs/thumbmarkjs version` matches (expect 1.9.x).

**File 2 — `leanshot/vite.config.ts`** (modify rollupOptions.output.manualChunks):
- Locate the existing `manualChunks` function or object inside `build.rollupOptions.output`.
- Add a rule: if the module id includes `'@thumbmarkjs/thumbmarkjs'` (note: `@thumbmarkjs` scope, not `@thumbmark`) → return chunk name `'fingerprint'`. This isolates ThumbmarkJS into its own ≤12 kB gz chunk loaded on demand.
- If manualChunks is currently a function, add the conditional at the top: `if (id.includes('@thumbmarkjs/thumbmarkjs')) return 'fingerprint';`
- DO NOT modify any other manualChunks rules (Phase 12 ceilings already locked).

**File 3 — `src/lib/affiliate/fingerprint.ts`** (lazy wrapper):
- Export `async function getFingerprint(): Promise<string | null>`. Use DYNAMIC import per Pitfall 3.
- API shape (W-2 hedge resolved by GitHub README fetch during iter-1 revision): the library exports a named class `Thumbmark`. Concrete implementation:
  ```
  const mod = await import('@thumbmarkjs/thumbmarkjs');
  const tm = new mod.Thumbmark();
  const result = await tm.get();
  return typeof result === 'string' ? result : (result?.thumbmark ?? null);
  ```
- The `tm.get()` return type may be `string` (legacy) OR `{ thumbmark: string; ... }` (current 1.9.x). Handle both via the conditional above. DO NOT add a runtime version-check; the fallthrough is sufficient.
- Wrap in try/catch — on failure return `null` (fingerprint is best-effort; users with blocked APIs / no-canvas browsers shouldn't break).
- Cache result in a module-level `let cached: string | null = null` so repeated calls don't re-fingerprint.
- Export second helper `async function getFingerprintForSubmit(): Promise<string | null>` — same as getFingerprint but tagged for usage at form submit (e.g. apply form, signup form). Same implementation today; future-proof for a different sampling depth.

**File 4 — `src/lib/affiliate/__tests__/fingerprint.test.ts`** (vitest):
- T1: `getFingerprint()` returns a string when ThumbmarkJS is mocked to resolve.
- T2: `getFingerprint()` returns null when ThumbmarkJS throws.
- T3: cached result returned on second call (verify mock called only once).
- T4: ThumbmarkJS module is imported via dynamic `import()` — check vite import-meta or rely on test-side mock verifying it wasn't statically imported at module load.

**File 5 — `supabase/functions/affiliate-attribute/index.ts` EXTEND** (Z-score check + fingerprint capture):
- After existing cold-start cap logic (Plan 19-02 Task 2 step 5), ADD a Z-score check:
  - SELECT mean_clicks, stddev_clicks, days_observed from `affiliate_click_baseline` WHERE affiliate_id = aff.id.
  - If `days_observed >= 7` (baseline accumulated past cold-start window):
    - Count today's clicks so far for this affiliate (similar query to cold-start cap but over today's date_trunc).
    - Compute `z_score = (today_count - mean_clicks) / NULLIF(stddev_clicks, 0)`.
    - If `z_score >= 3` → set `flagged = true`, `flag_reason = 'z_score_3sigma'` (D-26).
  - If `days_observed < 7` → skip Z-score check (cold-start cap from Plan 19-02 handles it; D-27).
- INSERT click row now uses combined `flag_reason` (already existing in Plan 19-02 schema — picks first non-null reason).
- Read fingerprint from request: extract from a custom request header (`X-LeanShot-Fingerprint`) OR a query param `?fp=...`. Validate as `/^[a-zA-Z0-9_-]{8,128}$/`. Pass through to `affiliate_clicks.fingerprint` column.

**File 6 — `supabase/functions/affiliate-attribute/index.test.ts` EXTEND** (add 3 tests):
- T7: matview baseline `mean=10, stddev=2, days_observed=10`; today's count=12 → z_score=1 < 3 → NOT flagged.
- T8: same baseline; today's count=20 → z_score=5 ≥ 3 → flagged with flag_reason='z_score_3sigma'.
- T9: baseline `days_observed=3` (cold-start) → Z-score check skipped; cold-start cap from Plan 19-02 still applies.

**Constraints:**
- ThumbmarkJS MUST be dynamic-imported (Pitfall 3 — never static import). The vite manualChunks rule makes the chunk discrete; the dynamic import ensures it's only fetched when needed.
- `src/lib/affiliate/fingerprint.ts` MUST NOT be imported by `App.tsx`, `main.tsx`, or `store.ts` ([[project-phase5-bundle-regression]] guardrail). The CI bundle-budget script enforces index ceiling.
- The Z-score extension reads from a MATERIALIZED VIEW — performance: indexed on `affiliate_id`, O(log N) lookup. Acceptable for the ~10ms latency budget of affiliate-attribute.
- Commit with pathspec on this task's files only; do NOT include sibling-plan files even if package.json was bumped for another reason.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm install && npm run test -- src/lib/affiliate/__tests__/fingerprint.test.ts --run && npm run build && du -b dist/assets/index-*.js.gz 2>/dev/null | head -1 | awk '{ if ($1 > 51200) { print "INDEX OVER 50KB GZ — FAIL"; exit 1 } else print "index OK: " $1 " bytes" }' && cd /Users/karstenhaldan/minisite && deno test supabase/functions/affiliate-attribute/index.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>ThumbmarkJS installed + lazy-chunked in vite; fingerprint.ts wraps it with caching + error handling; affiliate-attribute extended with Z-score check that gates on `days_observed >= 7`; index chunk ≤ 50 kB gz; 4 fingerprint vitest tests + 3 new Deno tests pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → fingerprint capture | Best-effort; user can disable canvas/WebGL APIs to defeat |
| /r/{code} request → Z-score lookup | Trusted server-side; matview refreshed daily so attacker can't manipulate baseline mid-day |
| affiliate_conversions INSERT → trigger | All inserts (service-role or otherwise) pass through trigger |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-07-S | Spoofing | Self-conversion by affiliate | mitigate | 3-signal trigger flags ANY single match (D-24); admin queue review (D-25) |
| T-19-07-T | Tampering | Affiliate proxies clicks through botnet to inflate stats | mitigate | Z-score 3σ flag (D-26); cold-start cap 500/day (D-27 from Plan 19-02); Referer host allowlist (D-28 from Plan 19-02) |
| T-19-07-T | Tampering | Affiliate disables fingerprint | accept | Fingerprint is one of 3 signals; IP /24 + email-domain still fire; ThumbmarkJS failure gracefully degrades to null |
| T-19-07-R | Repudiation | Affiliate disputes flag | mitigate | `fraud_signals` jsonb retains exact list of triggered signals for audit |
| T-19-07-I | Information Disclosure | Z-score data leaks affiliate's relative performance | accept | Z-score not exposed to client; matview is service-role + authenticated SELECT but partner dashboard doesn't query it directly |
| T-19-07-D | DoS | matview REFRESH blocks reads | mitigate | CONCURRENTLY refresh + UNIQUE index (Pitfall 5); daily off-peak schedule (01:00 UTC) |
| T-19-07-E | Elevation of Privilege | Allowlist bypass | mitigate | Allowlist domains hardcoded in trigger fn; SET search_path prevents schema-injection (V11) |
</threat_model>

<verification>
- 3 migrations apply cleanly; matview + trigger + cron all in place
- Two SQL tests pass (fraud signals + matview correctness)
- ThumbmarkJS lazy-chunked; index.gz ≤ 50 kB
- Z-score check in affiliate-attribute gated on `days_observed >= 7` (cold-start fallback)
- Public-email allowlist exempts gmail/yahoo/outlook/icloud/hotmail from email-domain signal
- 4 fingerprint vitest tests + 3 new affiliate-attribute Deno tests pass
</verification>

<success_criteria>
- BEFORE INSERT trigger on affiliate_conversions fires on every webhook insert (Plan 19-04) — sets `status='flagged'` + populates `fraud_signals` JSON
- Materialized view `affiliate_click_baseline` refreshes CONCURRENTLY every 01:00 UTC without blocking reads
- /r/{code} hits flag clicks when daily count ≥ mean + 3σ (z-score) AFTER 7-day baseline
- ThumbmarkJS chunk loads only when /r/* or /signup routes accessed; never in index chunk
- All fraud signals route to admin queue (D-25 — no auto-reject; Plan 19-06's PartnerActivityFeed shows "Pending review" badge on flagged rows)
</success_criteria>

<output>
After completion, create `19-07-SUMMARY.md`: trigger contract documented; matview refresh cadence; ThumbmarkJS bundle size measured (target ≤12 kB gz); index chunk delta; flag for Plan 19-09 [BLOCKING] task that 3 new migrations need pushing.
</output>
