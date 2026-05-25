---
phase: 56-ad-network
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20280401000001_ad_placements.sql
  - supabase/migrations/20280401000002_ad_advertiser_blocklist.sql
  - supabase/migrations/20280401000003_ad_revenue_facts.sql
  - supabase/migrations/20280401000004_ad_network_config_add_serving.sql
  - supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql
  - supabase/functions/ad-revenue-etl/index.ts
  - supabase/functions/ad-revenue-etl/index.test.ts
autonomous: true
requirements: [AD-05, AD-09, AD-12]
must_haves:
  truths:
    - "ad_placements table exists with per-placement admin config (surface, mode, network, freq_cap_per_session, ab_variant, enabled, embed_html, house_ad_slug)"
    - "ad_advertiser_blocklist table exists, seeded with competing GLP-1 brand domains, admin-editable"
    - "ad_revenue_facts table exists with per-network revenue rows (impressions, clicks, fill_rate, estimated_revenue_usd, ecpm_usd, rpm_usd, raw_payload jsonb) — NEW, distinct from the spend-side ad_revenue_normalized matview"
    - "ad_network_config CHECK constraint accepts 'admob' and 'adsense' (idempotent ALTER)"
    - "daily cron calls the ad-revenue-etl Edge Fn; get_ad_revenue_dashboard SECDEF RPC returns revenue rows to admins only"
    - "all new ad tables are admin-only via is_admin_at_least('admin')"
  artifacts:
    - path: "supabase/migrations/20280401000003_ad_revenue_facts.sql"
      provides: "ad_revenue_facts table + admin RLS"
      contains: "create table if not exists public.ad_revenue_facts"
    - path: "supabase/migrations/20280401000001_ad_placements.sql"
      provides: "ad_placements registry table"
      contains: "create table if not exists public.ad_placements"
    - path: "supabase/migrations/20280401000002_ad_advertiser_blocklist.sql"
      provides: "GLP-1 advertiser block-list + approved ad-network allowlist tables"
      contains: "ad_advertiser_blocklist"
    - path: "supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql"
      provides: "daily cron + get_ad_revenue_dashboard SECDEF RPC"
      contains: "get_ad_revenue_dashboard"
    - path: "supabase/functions/ad-revenue-etl/index.ts"
      provides: "daily revenue pull Edge Fn (stores raw_payload, graceful when APIs unauthorized)"
      exports: ["Deno.serve handler", "normalizeReportRow", "computeEcpmRpm"]
  key_links:
    - from: "supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql"
      to: "ad-revenue-etl Edge Fn"
      via: "cron.schedule net.http_post with vault service_role bearer"
      pattern: "functions/v1/ad-revenue-etl"
    - from: "supabase/functions/ad-revenue-etl/index.ts"
      to: "ad_revenue_facts"
      via: "upsert on (network, placement_id, report_date)"
      pattern: "ad_revenue_facts"
user_setup:
  - service: admob-adsense-reporting
    why: "Daily revenue ETL pulls AdMob + AdSense reporting APIs; credentials arrive with publisher approval (Phase 70)"
    env_vars:
      - name: ADMOB_REPORTING_CREDENTIALS
        source: "AdMob Console -> API access (post publisher approval — Phase 70)"
      - name: ADSENSE_REPORTING_CREDENTIALS
        source: "AdSense -> Account -> API access (post publisher approval — Phase 70)"
---

<objective>
Build the revenue-side ETL backend: the `ad_placements` registry table (AD-05), the GLP-1 `ad_advertiser_blocklist` + approved ad-network `ad_csp_allowlist` tables (AD-09 data layer), the NEW `ad_revenue_facts` table (AD-12), the idempotent ALTER extending `ad_network_config` to accept admob/adsense, the daily cron + `get_ad_revenue_dashboard` SECDEF RPC, and the `ad-revenue-etl` Edge Fn that pulls network reports and upserts revenue rows (graceful when reporting APIs are not yet authorized).

Purpose: Closes the unit-economics loop against Phase 33 ad-SPEND. The existing `ad_revenue_normalized` matview is a SPEND/CAC view — it does NOT hold revenue inflow. This plan creates the missing revenue facts table and the daily pull that feeds the admin revenue dashboard (56-05). The blocklist/allowlist tables back the CSP generator (56-04). All verifiable now without live ads: schema grep, RLS policy presence, RPC auth-guard, Edge Fn upsert against pure helpers + raw_payload fallback.
Output: 5 forward-dated migrations (past the 20280301000005 Phase 55 ceiling) + the ad-revenue-etl Edge Fn + Deno test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/56-ad-network/56-RESEARCH.md
@supabase/migrations/20270703000010_rls_deny_ad_tables.sql
@supabase/migrations/20270703000011_ad_etl_cron_schedules.sql

<interfaces>
<!-- Verified from codebase. -->

ad_network_config (Phase 33, migration 20270703000002): network text primary key check (network in ('meta','google','tiktok')).
THIS PHASE: idempotent DROP+ADD the CHECK to add 'admob','adsense' (Pitfall 2). Do NOT insert serving rows before the ALTER.

RLS helper (canonical): public.is_admin_at_least('admin'::public.admin_role) — used by ALL Phase 33 ad tables (verified 20270703000010). Use THIS for new-table RLS AND inside the SECDEF RPC guard.
NOTE: there is NO public.is_admin(uuid) single-arg helper in this codebase — the RESEARCH RPC example using is_admin(auth.uid()) is WRONG. Guard the SECDEF RPC with: if not public.is_admin_at_least('admin'::public.admin_role) then raise exception ... .

Migration timestamp ceiling: highest existing is 20280301000005 (Phase 55). New migrations MUST forward-date past it — use 2028040100000{1..5}.

Cron pattern (Phase 33 migration 11, SAFE — no inner $$): vault service_role bearer + hardcoded project URL https://ytnsipxxmzgaebkqmokp.supabase.co. Use a $$SELECT net.http_post(...)$$ body with NO inner DO block (Pitfall 5 — dollar-quote nesting). If a DO block is unavoidable use named tags $cron$...$body$.

Edge Fn auth: ad-spend crons use service-role bearer; mirror that. Project Edge Fns use Deno.serve() (NOT guarded by import.meta.main → Deno test top-level serve trap; export pure helpers separately and unit-test only those with --no-check so no port binds at import).

Default GLP-1 block-list seed (admin-editable): wegovy.com, ozempic.com, mounjaro.com, trulicity.com, saxenda.com, victoza.com, rybelsus.com.
Approved ad-network allowlist seed: pagead2.googlesyndication.com (AdSense, script-src), googleads.g.doubleclick.net (connect-src).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema migrations — placements, blocklist/allowlist, revenue_facts, network_config ALTER</name>
  <files>supabase/migrations/20280401000001_ad_placements.sql, supabase/migrations/20280401000002_ad_advertiser_blocklist.sql, supabase/migrations/20280401000003_ad_revenue_facts.sql, supabase/migrations/20280401000004_ad_network_config_add_serving.sql</files>
  <action>Create four forward-dated migrations (AD-05, AD-09 data, AD-12). (1) ad_placements: id uuid PK default gen_random_uuid(), key text unique not null, surface text not null, mode text not null check in ('embed-code','ad-platform','house-ads'), network text check in ('admob','adsense') null, freq_cap_per_session int not null default 3, ab_variant text null, enabled bool not null default false, embed_html text null, house_ad_slug text null, created_at/updated_at timestamptz default now(). (2) ad_advertiser_blocklist: id uuid PK, hostname text unique not null, reason text, created_at timestamptz default now() — seed the 7 GLP-1 brand domains via INSERT ... ON CONFLICT (hostname) DO NOTHING; ALSO create ad_csp_allowlist (id uuid PK, hostname text unique not null, directive text not null check in ('script-src','connect-src'), enabled bool not null default true) seeded with the approved ad-network hosts (pagead2.googlesyndication.com→script-src, googleads.g.doubleclick.net→connect-src) ON CONFLICT DO NOTHING. (3) ad_revenue_facts: per RESEARCH Pattern 4 — id uuid PK, network text not null check in ('admob','adsense'), placement_id uuid null, report_date date not null, impressions bigint not null default 0, clicks bigint not null default 0, fill_rate numeric(5,4), estimated_revenue_usd numeric(12,6) not null default 0, ecpm_usd numeric(12,6), rpm_usd numeric(12,6), raw_payload jsonb, etl_run_at timestamptz not null default now(), unique (network, placement_id, report_date). (4) idempotent ALTER of ad_network_config CHECK: alter table public.ad_network_config drop constraint if exists ad_network_config_network_check; alter table public.ad_network_config add constraint ad_network_config_network_check check (network in ('meta','google','tiktok','admob','adsense')); then INSERT admob+adsense config rows ON CONFLICT (network) DO NOTHING. Enable RLS on all THREE new tables (ad_placements, ad_advertiser_blocklist, ad_csp_allowlist, ad_revenue_facts) with is_admin_at_least('admin'::public.admin_role) for-all policies (mirror 20270703000010 verbatim — using + with check). Do NOT modify the existing ad_revenue_normalized matview.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -c "create table if not exists public.ad_revenue_facts" supabase/migrations/20280401000003_ad_revenue_facts.sql && grep -c "create table if not exists public.ad_placements" supabase/migrations/20280401000001_ad_placements.sql && grep -q "wegovy.com" supabase/migrations/20280401000002_ad_advertiser_blocklist.sql && grep -q "is_admin_at_least" supabase/migrations/20280401000003_ad_revenue_facts.sql && grep -Eq "admob', ?'adsense" supabase/migrations/20280401000004_ad_network_config_add_serving.sql && echo OK</automated>
  </verify>
  <done>All four migrations exist; ad_revenue_facts + ad_placements + ad_advertiser_blocklist + ad_csp_allowlist created with admin RLS; network_config CHECK altered idempotently to add admob/adsense; GLP-1 domains + approved hosts seeded. Forward-dated past 20280301000005.</done>
</task>

<task type="auto">
  <name>Task 2: Daily cron + get_ad_revenue_dashboard SECDEF RPC</name>
  <files>supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql</files>
  <action>Create the cron + RPC migration (AD-12, AD-06 data accessor). Register ad_revenue_etl_cron via cron.schedule('ad_revenue_etl_cron', '0 3 * * *', $$SELECT net.http_post(url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ad-revenue-etl', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)), body := '{}'::jsonb);$$) — single-statement body, NO inner DO/$$ block (Pitfall 5). Create get_ad_revenue_dashboard(p_start_date date default null, p_end_date date default null) returns table(network text, report_date date, impressions bigint, clicks bigint, fill_rate numeric, estimated_revenue_usd numeric, ecpm_usd numeric, rpm_usd numeric) language plpgsql security definer set search_path = pg_catalog, public, extensions; body: if not public.is_admin_at_least('admin'::public.admin_role) then raise exception 'unauthorized' using errcode = '42501'; end if; then return query select network, report_date, impressions, clicks, fill_rate, estimated_revenue_usd, ecpm_usd, rpm_usd from public.ad_revenue_facts where (p_start_date is null or report_date >= p_start_date) and (p_end_date is null or report_date <= p_end_date) order by report_date desc, network. Grant execute to authenticated. Use the is_admin_at_least guard (NOT is_admin(auth.uid()) — that helper does not exist here).</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "get_ad_revenue_dashboard" supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql && grep -q "ad_revenue_etl_cron" supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql && grep -q "is_admin_at_least" supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql && ! grep -q "is_admin(auth.uid())" supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql && echo OK</automated>
  </verify>
  <done>Cron registered with safe single-statement body; get_ad_revenue_dashboard SECDEF RPC guards on is_admin_at_least('admin') and reads ad_revenue_facts; no is_admin(auth.uid()) reference; grant present.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: ad-revenue-etl Edge Fn (graceful, raw_payload fallback)</name>
  <files>supabase/functions/ad-revenue-etl/index.ts, supabase/functions/ad-revenue-etl/index.test.ts</files>
  <behavior>
    - normalizeReportRow(network, rawRow) maps known fields (impressions, clicks, estimated_revenue_usd, fill_rate) and ALWAYS sets raw_payload to the full rawRow.
    - computeEcpmRpm(impressions, revenue) returns (revenue/impressions)*1000; returns 0 when impressions === 0 (no divide-by-zero).
    - The Fn returns a 200 summary { network: 'skipped: unauthorized' } per network when credentials are missing or the report API returns 401/403 (publisher approval pending — D-08), without throwing.
  </behavior>
  <action>Create the daily revenue-pull Edge Fn (AD-12). It authenticates the caller via service-role bearer (mirror ad-spend-cron auth), then for each network ('admob','adsense') attempts to fetch the reporting API using env creds (ADMOB_REPORTING_CREDENTIALS / ADSENSE_REPORTING_CREDENTIALS). Since publisher approval is pending (D-08), the fetch will be unauthorized in Phase 56 — handle gracefully: on missing creds or 401/403, log and skip that network without throwing, returning a 200 summary entry. When a report IS returned, call normalizeReportRow for each row and upsert into ad_revenue_facts on conflict (network, placement_id, report_date), ALWAYS storing the full API response in raw_payload jsonb (Open Q1 — field names unknown until approval). Export PURE helpers normalizeReportRow(network, rawRow) and computeEcpmRpm(impressions, revenue) at module top level (NOT inside the Deno.serve handler) so the Deno test exercises them without binding a port (Deno top-level serve trap). Write index.test.ts asserting the behavior cases above. Run the Deno test with --no-check.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "ad_revenue_facts" supabase/functions/ad-revenue-etl/index.ts && grep -q "raw_payload" supabase/functions/ad-revenue-etl/index.ts && $HOME/.deno/bin/deno test --no-check --allow-all supabase/functions/ad-revenue-etl/index.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>Edge Fn upserts revenue into ad_revenue_facts, always stores raw_payload, skips gracefully when reporting APIs unauthorized; pure helpers tested green via Deno (normalizeReportRow + computeEcpmRpm including divide-by-zero guard).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| cron → Edge Fn | service-role bearer authenticates the scheduled caller |
| admin client → ad_revenue_facts | RLS + SECDEF RPC gate revenue data to admins only |
| external reporting API → Edge Fn | untrusted/unauthorized response must not crash the ETL |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-56-04 | Spoofing | ad-revenue-etl Edge Fn | mitigate | service-role bearer from vault (mirror ad-spend-cron); reject non-bearer callers |
| T-56-05 | Information Disclosure | ad_revenue_facts | mitigate | enable RLS with is_admin_at_least('admin'); get_ad_revenue_dashboard raises 42501 for non-admins |
| T-56-06 | Denial of Service | reporting API fetch | mitigate | 401/403/missing-creds returns 200 skip summary, never throws — ETL stays up when publisher approval pending |
| T-56-07 | Tampering | get_ad_revenue_dashboard search_path | mitigate | set search_path = pg_catalog, public, extensions on the SECDEF function |
</threat_model>

<verification>
- Task verify commands above (schema grep, RPC guard grep, Deno helper test).
- `cd /Users/karstenhaldan/minisite && for f in supabase/migrations/2028040100000{1,2,3,4,5}_*.sql; do echo "$f"; done` — all 5 present and forward-dated.
- Migration push (`supabase db push --linked`) is a phase close-out concern; verification here is grep + Deno helper tests (live push deferred per project close-out pattern).
</verification>

<success_criteria>
The revenue-side schema exists (ad_placements, ad_advertiser_blocklist, ad_csp_allowlist, ad_revenue_facts), ad_network_config accepts admob/adsense, the daily cron + admin-guarded dashboard RPC are defined, and the ETL Edge Fn upserts revenue with raw_payload fallback and survives unauthorized reporting APIs — all proven without live publisher credentials.
</success_criteria>

<output>
Create `.planning/phases/56-ad-network/56-02-SUMMARY.md` when done. Record the ad_placements column names (so 56-01's rowToPlacementConfig + 56-05's dashboard map them verbatim), the get_ad_revenue_dashboard RPC signature, and the ad_csp_allowlist/ad_advertiser_blocklist column names (so 56-04's CSP generator queries them correctly). Note migration-push status for the phase CARRY-OVER push matrix.
</output>
